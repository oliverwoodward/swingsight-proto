/**
 * Small derivations over the swing-history list, shared by Home + the History route so the
 * logic lives in one place.
 */
import type { HistoryItem } from '@/services/analysis';

/**
 * tempo_ratio values in chronological order (oldest → newest) for the trend sparkline.
 * History arrives newest-first and only `ok` tempo measurements carry a value, so this
 * filters then reverses — no fabricated points.
 */
export function tempoSeries(items: HistoryItem[]): number[] {
  const out: number[] = [];
  for (const item of items) {
    if (item.tempoRatio != null) out.push(item.tempoRatio);
  }
  return out.reverse();
}
