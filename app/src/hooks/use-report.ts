/**
 * Loads everything the report renders for one analysis and keeps it live.
 *
 * The measurement lands first (status `complete`); the coaching arrives a moment later as
 * a second Realtime UPDATE on the same row, and the drill-recheck (Phase 6) is written
 * just after that. So we subscribe and re-render when `coaching` fills, but only load the
 * heavy children (metrics / events / per-frame keypoints) and presign the playback clip
 * ONCE, guarded by a ref. The recheck row isn't Realtime-replicated, so we fetch it with a
 * short bounded retry after `complete` — and simply show no comparison if none ever lands
 * (a first-ever swing, or nothing comparable: never a fabricated one).
 */
import { useEffect, useRef, useState } from 'react';

import {
  type AnalysisRecord,
  fetchAnalysis,
  fetchDrillRecheck,
  fetchEvents,
  fetchKeypointSeries,
  fetchMetrics,
  requestPlaybackUrl,
  subscribeAnalysis,
} from '@/services/analysis';
import { getSupabase } from '@/services/supabase';
import type { DrillRecheck, KeypointSeries, Metric, SwingEvent } from '@/domain';

export interface ReportData {
  record: AnalysisRecord | null;
  metrics: Metric[];
  events: SwingEvent[];
  series: KeypointSeries | null;
  playbackUrl: string | null;
  recheck: DrillRecheck | null;
  loading: boolean;
  error: string | null;
}

// The worker writes the recheck just after `complete`; poll a few times so a freshly
// finished analysis still surfaces the comparison without waiting on a manual refresh.
const RECHECK_ATTEMPTS = 5;
const RECHECK_INTERVAL_MS = 1500;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useReport(id: string): ReportData {
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [events, setEvents] = useState<SwingEvent[]>([]);
  const [series, setSeries] = useState<KeypointSeries | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [recheck, setRecheck] = useState<DrillRecheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const childrenLoaded = useRef(false);
  const recheckStarted = useRef(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setError('Backend not configured.');
      setLoading(false);
      return;
    }

    let cancelled = false;

    // Look for the compare-to-last-time row; retry briefly because the worker writes it a
    // beat after `complete`. Stops on the first hit, or quietly after the last attempt.
    const loadRecheck = async () => {
      if (recheckStarted.current) return;
      recheckStarted.current = true;
      for (let attempt = 0; attempt < RECHECK_ATTEMPTS; attempt++) {
        try {
          const rc = await fetchDrillRecheck(supabase, id);
          if (cancelled) return;
          if (rc) {
            setRecheck(rc);
            return;
          }
        } catch {
          /* transient — try again or give up after the loop (no comparison shown) */
        }
        await wait(RECHECK_INTERVAL_MS);
        if (cancelled) return;
      }
    };

    const loadChildren = async (rec: AnalysisRecord) => {
      if (rec.status === 'complete') void loadRecheck();
      if (childrenLoaded.current || rec.status !== 'complete' || !rec.keypointsMeta) return;
      childrenLoaded.current = true;
      try {
        const [m, e, s, url] = await Promise.all([
          fetchMetrics(supabase, id),
          fetchEvents(supabase, id),
          fetchKeypointSeries(supabase, id, rec.keypointsMeta),
          requestPlaybackUrl(supabase, id).catch(() => null),
        ]);
        if (cancelled) return;
        setMetrics(m);
        setEvents(e);
        setSeries(s);
        setPlaybackUrl(url);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };

    const onRecord = (rec: AnalysisRecord) => {
      if (cancelled) return;
      setRecord(rec);
      void loadChildren(rec);
    };

    (async () => {
      try {
        const rec = await fetchAnalysis(supabase, id);
        if (cancelled) return;
        if (!rec) {
          setError('Analysis not found.');
        } else {
          onRecord(rec);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsub = subscribeAnalysis(supabase, id, onRecord);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [id]);

  return { record, metrics, events, series, playbackUrl, recheck, loading, error };
}
