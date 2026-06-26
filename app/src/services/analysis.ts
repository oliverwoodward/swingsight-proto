/**
 * AnalysisService (Phase 4) — the device's half of the orchestration loop.
 *
 * The flow, mirroring the spec's state machine (Stage 3 → Stage 7):
 *   1. insert a swing_analyses row (status `uploading`) under RLS (profile_id = auth.uid())
 *   2. mint a presigned R2 PUT via the `upload-url` Edge Function
 *   3. background-upload the raw clip straight to R2 (single-shot presigned PUT; resumable
 *      TUS/multipart is a later upgrade on the same S3 endpoint)
 *   4. flip the row to `queued` + set raw_object_key → the DB webhook fires the worker
 *   5. the report subscribes to the row over Realtime for the live status + results
 *
 * Everything secret (service-role key, R2 creds, Anthropic key) stays server-side; the
 * device only ever holds the anon key + the short-lived presigned URLs.
 *
 * Pure functions over an injected Supabase client (no React) so the runner hook and the
 * report can share them and they stay testable.
 */
import * as LegacyFS from 'expo-file-system/legacy';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import type {
  AnalysisStatus,
  CoachingResult,
  DrillRecheck,
  FaultEvaluation,
  Handedness,
  Keypoint,
  KeypointFrame,
  KeypointSeries,
  Metric,
  QualityReport,
  SwingEvent,
  SwingScore,
  SwingView,
} from '@/domain';

// ---------------------------------------------------------------------------
// Row shapes (PostgREST snake_case) + mappers to the camelCase domain contract
// ---------------------------------------------------------------------------

interface AnalysisRow {
  id: string;
  profile_id: string;
  view: SwingView;
  handedness: Handedness;
  status: AnalysisStatus;
  raw_object_key: string | null;
  playback_video_url: string | null;
  keypoints_meta: Omit<KeypointSeries, 'frames'> | null;
  faults: FaultEvaluation[] | null;
  primary_fault_id: string | null;
  score: SwingScore | null;
  coaching: CoachingResult | null;
  quality: QualityReport | null;
  fault_library_version: string;
  error_reason: string | null;
  created_at: string;
}

interface MetricRow {
  metric_key: string;
  label: string;
  value: number;
  unit: Metric['unit'];
  status: Metric['status'];
  reliability_tag: Metric['reliabilityTag'];
  confidence: number;
  ideal: number;
  friendly_min: number;
  friendly_max: number;
  in_range: boolean;
}

interface KeyframeRow {
  event_name: SwingEvent['name'];
  frame_index: number;
  t: number;
  confidence: number;
  frame_object_key: string | null;
}

interface KeypointRow {
  frame_index: number;
  t: number;
  landmarks: KeypointFrame['landmarks'];
}

/** The report's view of an analysis: the row's worker-owned fields, decoded. */
export interface AnalysisRecord {
  id: string;
  view: SwingView;
  handedness: Handedness;
  status: AnalysisStatus;
  playbackObjectKey: string | null;
  faults: FaultEvaluation[];
  primaryFaultId: string | null;
  score: SwingScore | null;
  coaching: CoachingResult | null;
  quality: QualityReport | null;
  keypointsMeta: Omit<KeypointSeries, 'frames'> | null;
  errorReason: string | null;
}

function mapAnalysis(row: AnalysisRow): AnalysisRecord {
  return {
    id: row.id,
    view: row.view,
    handedness: row.handedness,
    status: row.status,
    playbackObjectKey: row.playback_video_url,
    faults: row.faults ?? [],
    primaryFaultId: row.primary_fault_id,
    score: row.score,
    coaching: row.coaching,
    quality: row.quality,
    keypointsMeta: row.keypoints_meta,
    errorReason: row.error_reason,
  };
}

function mapMetric(r: MetricRow): Metric {
  return {
    key: r.metric_key,
    label: r.label,
    value: r.value,
    unit: r.unit,
    status: r.status,
    reliabilityTag: r.reliability_tag,
    confidence: r.confidence,
    ideal: r.ideal,
    friendlyRange: { min: r.friendly_min, max: r.friendly_max },
    inRange: r.in_range,
  };
}

function mapEvent(r: KeyframeRow): SwingEvent {
  return { name: r.event_name, frameIndex: r.frame_index, t: r.t, confidence: r.confidence };
}

// ---------------------------------------------------------------------------
// Upload pipeline
// ---------------------------------------------------------------------------

export interface StartUploadInput {
  /** Client-minted id used as BOTH the row id and the R2 object name (keeps them aligned). */
  analysisId: string;
  profileId: string;
  view: SwingView;
  handedness: Handedness;
  /** Local file:// URI of the recorded clip. */
  fileUri: string;
  /** File extension without the dot. Default 'mov' (vision-camera records QuickTime). */
  ext?: string;
  /** MIME type the device PUTs with. Default video/quicktime. */
  contentType?: string;
}

/**
 * The most recent COMPLETE analysis for this profile + SAME view — the link the worker's
 * drill-recheck step compares against (Phase 6 / spec §12). Same view so the worker
 * compares like with like; the app only supplies the link, the worker re-measures the
 * value from CV. Best-effort: any error just means "no comparison this time" (never an
 * error to the user, never a fabricated comparison).
 */
export async function findPreviousAnalysisId(
  supabase: SupabaseClient,
  profileId: string,
  view: SwingView,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('swing_analyses')
      .select('id')
      .eq('profile_id', profileId)
      .eq('view', view)
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (error) return null;
    return data?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Insert the analysis row in `uploading` state, linking the previous same-view swing so
 * the worker can lead the report with a measured comparison. The link is the only thing
 * the device supplies for the recheck — the delta is recomputed server-side from CV.
 */
export async function insertAnalysis(
  supabase: SupabaseClient,
  input: Pick<StartUploadInput, 'analysisId' | 'profileId' | 'view' | 'handedness'>,
): Promise<void> {
  const previousAnalysisId = await findPreviousAnalysisId(supabase, input.profileId, input.view);
  const { error } = await supabase.from('swing_analyses').insert({
    id: input.analysisId,
    profile_id: input.profileId,
    view: input.view,
    handedness: input.handedness,
    status: 'uploading',
    previous_analysis_id: previousAnalysisId,
  });
  if (error) throw new Error(`insert analysis failed: ${error.message}`);
}

interface UploadUrlResponse {
  uploadUrl: string;
  objectKey: string;
  contentType: string;
  headers: Record<string, string>;
}

/** Mint a presigned R2 PUT for this analysis's raw clip. */
export async function requestUploadUrl(
  supabase: SupabaseClient,
  analysisId: string,
  ext: string,
  contentType: string,
): Promise<UploadUrlResponse> {
  const { data, error } = await supabase.functions.invoke<UploadUrlResponse>('upload-url', {
    body: { analysisId, ext, contentType },
  });
  if (error || !data) throw new Error(`upload-url failed: ${error?.message ?? 'no data'}`);
  return data;
}

/**
 * Background-upload the local clip to the presigned R2 URL (binary PUT). Reports
 * fractional progress [0,1]. The presigned URL signs only the host header, so sending
 * Content-Type does not break the signature.
 */
export async function uploadClip(
  uploadUrl: string,
  fileUri: string,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const task = LegacyFS.createUploadTask(
    uploadUrl,
    fileUri,
    {
      httpMethod: 'PUT',
      uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType },
    },
    (p) => {
      if (p.totalBytesExpectedToSend > 0) {
        onProgress?.(Math.min(1, p.totalBytesSent / p.totalBytesExpectedToSend));
      }
    },
  );
  const result = await task.uploadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`R2 PUT failed (status ${result?.status ?? 'none'})`);
  }
  onProgress?.(1);
}

/** Advance the row to `queued` with its raw object key — this fires the worker webhook. */
export async function markQueued(
  supabase: SupabaseClient,
  analysisId: string,
  objectKey: string,
): Promise<void> {
  const { error } = await supabase
    .from('swing_analyses')
    .update({ status: 'queued', raw_object_key: objectKey })
    .eq('id', analysisId);
  if (error) throw new Error(`queue analysis failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Reads + Realtime + playback presign (used by the processing + report screens)
// ---------------------------------------------------------------------------

export async function fetchAnalysis(
  supabase: SupabaseClient,
  analysisId: string,
): Promise<AnalysisRecord | null> {
  const { data, error } = await supabase
    .from('swing_analyses')
    .select('*')
    .eq('id', analysisId)
    .maybeSingle<AnalysisRow>();
  if (error) throw new Error(`fetch analysis failed: ${error.message}`);
  return data ? mapAnalysis(data) : null;
}

export async function fetchMetrics(
  supabase: SupabaseClient,
  analysisId: string,
): Promise<Metric[]> {
  const { data, error } = await supabase
    .from('swing_metrics')
    .select('*')
    .eq('analysis_id', analysisId);
  if (error) throw new Error(`fetch metrics failed: ${error.message}`);
  return (data as MetricRow[]).map(mapMetric);
}

export async function fetchEvents(
  supabase: SupabaseClient,
  analysisId: string,
): Promise<SwingEvent[]> {
  const { data, error } = await supabase
    .from('swing_keyframes')
    .select('*')
    .eq('analysis_id', analysisId)
    .order('frame_index');
  if (error) throw new Error(`fetch events failed: ${error.message}`);
  return (data as KeyframeRow[]).map(mapEvent);
}

/**
 * Fetch the full per-frame keypoint series for the overlay. One row per frame; we page
 * defensively past PostgREST's default cap so a long clip isn't silently truncated.
 */
export async function fetchKeypointSeries(
  supabase: SupabaseClient,
  analysisId: string,
  meta: Omit<KeypointSeries, 'frames'>,
): Promise<KeypointSeries> {
  const frames: KeypointFrame[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('swing_keypoints')
      .select('frame_index, t, landmarks')
      .eq('analysis_id', analysisId)
      .order('frame_index')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch keypoints failed: ${error.message}`);
    const rows = data as KeypointRow[];
    for (const r of rows) frames.push({ t: r.t, landmarks: r.landmarks });
    if (rows.length < PAGE) break;
  }
  return { ...meta, frames };
}

// ---------------------------------------------------------------------------
// Drill-recheck (Phase 6) — the deterministic compare-to-last-time row
// ---------------------------------------------------------------------------

interface DrillRecheckRow {
  drill_id: string;
  target_metric_key: string;
  previous_analysis_id: string;
  current_analysis_id: string;
  previous_value: number;
  current_value: number;
  delta: number;
  improved: boolean;
}

function mapRecheck(r: DrillRecheckRow): DrillRecheck {
  return {
    drillId: r.drill_id,
    targetMetricKey: r.target_metric_key,
    previousAnalysisId: r.previous_analysis_id,
    currentAnalysisId: r.current_analysis_id,
    previousValue: r.previous_value,
    currentValue: r.current_value,
    delta: r.delta,
    improved: r.improved,
  };
}

/**
 * The recheck comparison for THIS analysis, if the worker wrote one. Null when this is a
 * first-ever (or first same-view) swing, or no metric was comparable — the report then
 * shows the normal view with no fabricated comparison. The worker writes this a moment
 * after `complete` (it's not Realtime-replicated), so callers fetch it with a small retry.
 */
export async function fetchDrillRecheck(
  supabase: SupabaseClient,
  analysisId: string,
): Promise<DrillRecheck | null> {
  const { data, error } = await supabase
    .from('drill_recheck')
    .select('*')
    .eq('current_analysis_id', analysisId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<DrillRecheckRow>();
  if (error) throw new Error(`fetch recheck failed: ${error.message}`);
  return data ? mapRecheck(data) : null;
}

// ---------------------------------------------------------------------------
// History + trends (Phase 6) — past swings + tempo over time
// ---------------------------------------------------------------------------

interface HistoryRow {
  id: string;
  view: SwingView;
  status: AnalysisStatus;
  created_at: string;
  primary_fault_id: string | null;
  coaching: CoachingResult | null;
  score: SwingScore | null;
  keypoints_meta: Omit<KeypointSeries, 'frames'> | null;
}

/** One past swing, decoded for the history list + tempo trend. */
export interface HistoryItem {
  id: string;
  view: SwingView;
  status: AnalysisStatus;
  createdAt: string;
  primaryFaultId: string | null;
  coaching: CoachingResult | null;
  score: SwingScore | null;
  keypointsMeta: Omit<KeypointSeries, 'frames'> | null;
  /** tempo_ratio for this swing when measured `ok`, else null (excluded from the trend). */
  tempoRatio: number | null;
}

function mapHistory(r: HistoryRow, tempoRatio: number | null): HistoryItem {
  return {
    id: r.id,
    view: r.view,
    status: r.status,
    createdAt: r.created_at,
    primaryFaultId: r.primary_fault_id,
    coaching: r.coaching,
    score: r.score,
    keypointsMeta: r.keypoints_meta,
    tempoRatio,
  };
}

/** Terminal statuses worth showing in history (each tappable into its report). */
const HISTORY_STATUSES: AnalysisStatus[] = ['complete', 'unreadable', 'failed'];

/**
 * Past swings for this profile, newest first, each carrying its tempo_ratio for the
 * trend. RLS scopes both queries to the owner. Two unambiguous round-trips (rather than
 * relying on PostgREST embedded-filter semantics): the swings, then their tempo metric
 * batched over the returned ids.
 */
export async function fetchSwingHistory(
  supabase: SupabaseClient,
  profileId: string,
  limit = 50,
): Promise<HistoryItem[]> {
  const { data, error } = await supabase
    .from('swing_analyses')
    .select('id, view, status, created_at, primary_fault_id, coaching, score, keypoints_meta')
    .eq('profile_id', profileId)
    .in('status', HISTORY_STATUSES)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`fetch history failed: ${error.message}`);
  const rows = (data ?? []) as HistoryRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: tempoData } = await supabase
    .from('swing_metrics')
    .select('analysis_id, value, status')
    .in('analysis_id', ids)
    .eq('metric_key', 'tempo_ratio');
  const tempoByAnalysis = new Map<string, number>();
  for (const t of (tempoData ?? []) as {
    analysis_id: string;
    value: number;
    status: Metric['status'];
  }[]) {
    if (t.status === 'ok') tempoByAnalysis.set(t.analysis_id, t.value);
  }
  return rows.map((r) => mapHistory(r, tempoByAnalysis.get(r.id) ?? null));
}

/**
 * A single pose frame for a history thumbnail (the worker's measured skeleton at a
 * representative swing event — `top` if available, else any keyframe). One small row,
 * no R2 round-trip; the thumbnail is drawn from the keypoints we already store. Returns
 * the landmarks + the source frame dims (for contain-fit), or null if unavailable.
 */
export async function fetchPoseThumbnail(
  supabase: SupabaseClient,
  analysisId: string,
  meta: Pick<KeypointSeries, 'videoWidth' | 'videoHeight'>,
): Promise<{ landmarks: Keypoint[]; videoWidth: number; videoHeight: number } | null> {
  // Prefer a visually swing-like frame; fall back through the event list to any keyframe.
  const PREFERRED: SwingEvent['name'][] = ['top', 'mid_downswing', 'impact', 'mid_backswing', 'address'];
  const { data: kfData, error: kfErr } = await supabase
    .from('swing_keyframes')
    .select('event_name, frame_index')
    .eq('analysis_id', analysisId);
  if (kfErr || !kfData || kfData.length === 0) return null;
  const byEvent = new Map<string, number>();
  for (const k of kfData as { event_name: string; frame_index: number }[]) {
    byEvent.set(k.event_name, k.frame_index);
  }
  let frameIndex: number | undefined;
  for (const ev of PREFERRED) {
    if (byEvent.has(ev)) {
      frameIndex = byEvent.get(ev);
      break;
    }
  }
  if (frameIndex == null) frameIndex = (kfData as { frame_index: number }[])[0].frame_index;

  const { data: kpData, error: kpErr } = await supabase
    .from('swing_keypoints')
    .select('landmarks')
    .eq('analysis_id', analysisId)
    .eq('frame_index', frameIndex)
    .limit(1)
    .maybeSingle<{ landmarks: Keypoint[] }>();
  if (kpErr || !kpData) return null;
  return {
    landmarks: kpData.landmarks,
    videoWidth: meta.videoWidth,
    videoHeight: meta.videoHeight,
  };
}

/** Mint a short-lived presigned GET for the playback clip (private R2 object key). */
export async function requestPlaybackUrl(
  supabase: SupabaseClient,
  analysisId: string,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>('playback-url', {
    body: { analysisId },
  });
  if (error || !data?.url) throw new Error(`playback-url failed: ${error?.message ?? 'no url'}`);
  return data.url;
}

/**
 * Subscribe to row UPDATEs over Realtime. Fires for every worker write — the status
 * transitions AND the later `coaching` fill — so the report stays live. Returns an
 * unsubscribe function.
 */
export function subscribeAnalysis(
  supabase: SupabaseClient,
  analysisId: string,
  onUpdate: (record: AnalysisRecord) => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`analysis:${analysisId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'swing_analyses', filter: `id=eq.${analysisId}` },
      (payload) => onUpdate(mapAnalysis(payload.new as AnalysisRow)),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
