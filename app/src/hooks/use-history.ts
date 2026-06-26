/**
 * Loads the profile's past swings (newest first) for the Home preview and the History
 * route — each item carries its tempo_ratio so the trend needs no separate query. RLS
 * scopes the read to the owner. `reload()` re-fetches (Home/History call it on focus so a
 * freshly-recorded swing appears without a manual refresh).
 */
import { useCallback, useEffect, useState } from 'react';

import { fetchSwingHistory, type HistoryItem } from '@/services/analysis';
import { getSupabase } from '@/services/supabase';

export interface HistoryData {
  items: HistoryItem[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useHistory(profileId: string | null, limit = 50): HistoryData {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !profileId) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchSwingHistory(supabase, profileId, limit)
      .then((rows) => {
        if (!cancelled) {
          setItems(rows);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, limit, nonce]);

  return { items, loading, error, reload };
}
