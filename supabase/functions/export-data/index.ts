// export-data — the user-facing "export my data" action (spec §21 right to export).
//
// The device calls this with its anonymous-auth JWT. We read the caller's OWN data UNDER
// RLS (profile, every swing analysis + its metrics, events/keyframes, coaching, score, and
// drill rechecks) and return it as a single JSON bundle. For each finished swing we also
// mint a short-lived presigned R2 GET so the user can download the playback video too.
//
// Read-only and RLS-scoped: a client can only ever export its own data, and the R2 secret
// never leaves the function. Nothing is sent to any external service — the bundle is
// returned to the caller.

import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'npm:@supabase/supabase-js@2.108.2';
import { corsHeaders, json, preflight } from '../_shared/cors.ts';

const PLAYBACK_EXPIRY_SECONDS = 60 * 60; // 1 hour, matching playback-url

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function r2Endpoint(): string {
  const explicit = Deno.env.get('R2_ENDPOINT');
  if (explicit) return explicit.replace(/\/$/, '');
  return `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[key(r)] ??= []).push(r);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing Authorization' }, 401);

  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'invalid session' }, 401);

  // --- read the user's data (every select is RLS-scoped to auth.uid()) ---
  const [profileRes, analysesRes, metricsRes, keyframesRes, rechecksRes] = await Promise.all([
    supabase.from('profiles').select('*').maybeSingle(),
    supabase.from('swing_analyses').select('*').order('created_at', { ascending: true }),
    supabase.from('swing_metrics').select('*'),
    supabase.from('swing_keyframes').select('analysis_id, event_name, frame_index, t, confidence'),
    supabase.from('drill_recheck').select('*'),
  ]);

  for (const r of [profileRes, analysesRes, metricsRes, keyframesRes, rechecksRes]) {
    if (r.error) return json({ error: 'export read failed', detail: r.error.message }, 500);
  }

  const analyses = analysesRes.data ?? [];
  const metricsByAnalysis = groupBy(metricsRes.data ?? [], (m) => m.analysis_id as string);
  const keyframesByAnalysis = groupBy(keyframesRes.data ?? [], (k) => k.analysis_id as string);

  // --- presign a playback URL per finished swing (best-effort) ---
  const aws = new AwsClient({
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    region: 'auto',
    service: 's3',
  });
  const bucket = env('R2_BUCKET');
  const endpoint = r2Endpoint();

  async function presignPlayback(objectKey: string | null): Promise<string | null> {
    if (!objectKey) return null;
    try {
      const url = new URL(`${endpoint}/${bucket}/${objectKey}`);
      url.searchParams.set('X-Amz-Expires', String(PLAYBACK_EXPIRY_SECONDS));
      const signed = await aws.sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
      return signed.url;
    } catch {
      return null;
    }
  }

  const swings = await Promise.all(
    analyses.map(async (a) => ({
      id: a.id,
      view: a.view,
      handedness: a.handedness,
      status: a.status,
      createdAt: a.created_at,
      primaryFaultId: a.primary_fault_id,
      faults: a.faults,
      score: a.score,
      coaching: a.coaching,
      quality: a.quality,
      faultLibraryVersion: a.fault_library_version,
      metrics: metricsByAnalysis[a.id] ?? [],
      events: keyframesByAnalysis[a.id] ?? [],
      // A short-lived link to download the playback video (expires in 1h).
      playbackVideoUrl: await presignPlayback(a.playback_video_url),
    })),
  );

  const bundle = {
    exportedAt: new Date().toISOString(),
    schema: 'swingsight.export.v1',
    note:
      'Your SwingSight data. playbackVideoUrl links are short-lived (1 hour). Per spec §21, ' +
      'no identifiable account data (id/email) is ever sent to the coaching model — only ' +
      'metrics and annotated frames.',
    profile: profileRes.data ?? null,
    swings,
    drillRechecks: rechecksRes.data ?? [],
  };

  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="swingsight-export.json"',
    },
  });
});
