/**
 * Drives one analysis end-to-end from the device side and exposes the live state machine
 * (`uploading → queued → processing → complete | unreadable | failed`) to the processing
 * screen. Insert → presign → background upload → queue, then track the worker's progress
 * over Realtime, with a slow poll as a backstop in case a Realtime event is missed.
 *
 * The whole run is keyed on `runKey`; `retry()` bumps it to start a fresh analysis (new
 * id, new upload) — the prior row is left in its terminal state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type AnalysisRecord,
  fetchAnalysis,
  insertAnalysis,
  markQueued,
  requestUploadUrl,
  subscribeAnalysis,
  uploadClip,
} from '@/services/analysis';
import { getSupabase } from '@/services/supabase';
import type { AnalysisStatus, Handedness, SwingView } from '@/domain';
import { createId } from '@/utils/id';

const TERMINAL: AnalysisStatus[] = ['complete', 'unreadable', 'failed'];

export interface AnalysisRunnerInput {
  profileId: string | null;
  fileUri: string;
  view: SwingView;
  handedness: Handedness;
  ext?: string;
  contentType?: string;
}

export interface AnalysisRunnerState {
  phase: AnalysisStatus;
  uploadProgress: number;
  record: AnalysisRecord | null;
  error: string | null;
  retry: () => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useAnalysisRunner(input: AnalysisRunnerInput): AnalysisRunnerState {
  const { profileId, fileUri, view, handedness, ext = 'mov', contentType = 'video/quicktime' } =
    input;

  const [runKey, setRunKey] = useState(0);
  const [phase, setPhase] = useState<AnalysisStatus>('uploading');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => getSupabase(), []);

  const retry = useCallback(() => setRunKey((k) => k + 1), []);

  useEffect(() => {
    if (!supabase || !profileId) {
      setError('Backend not configured — set EXPO_PUBLIC_SUPABASE_* and restart.');
      setPhase('failed');
      return;
    }

    let cancelled = false;
    let unsub: () => void = () => {};
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const analysisId = createId();
    setPhase('uploading');
    setUploadProgress(0);
    setError(null);
    setRecord(null);

    const clearPoll = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const onUpdate = (rec: AnalysisRecord) => {
      if (cancelled) return;
      setRecord(rec);
      setPhase(rec.status);
      if (TERMINAL.includes(rec.status)) clearPoll();
    };

    (async () => {
      try {
        await insertAnalysis(supabase, { analysisId, profileId, view, handedness });
        // Subscribe before queuing so we can't miss the worker's first transition.
        unsub = subscribeAnalysis(supabase, analysisId, onUpdate);

        const up = await requestUploadUrl(supabase, analysisId, ext, contentType);
        await uploadClip(up.uploadUrl, fileUri, up.contentType, (f) => {
          if (!cancelled) setUploadProgress(f);
        });
        await markQueued(supabase, analysisId, up.objectKey);
        if (!cancelled) setPhase('queued');

        // Backstop: Realtime is primary, but poll slowly so the screen can't get stuck
        // if a websocket event is dropped.
        pollTimer = setInterval(async () => {
          try {
            const rec = await fetchAnalysis(supabase, analysisId);
            if (rec) onUpdate(rec);
          } catch {
            /* transient — the next tick or a Realtime event will recover */
          }
        }, 4000);
      } catch (e) {
        if (!cancelled) {
          setError(message(e));
          setPhase('failed');
        }
      }
    })();

    return () => {
      cancelled = true;
      unsub();
      clearPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, supabase, profileId, fileUri, view, handedness, ext, contentType]);

  return { phase, uploadProgress, record, error, retry };
}
