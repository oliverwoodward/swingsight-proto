/**
 * One past swing in the history list — thumbnail + view + the priority fault (or coaching
 * headline) + the deterministic score, tapping through to its full report. Honest about
 * non-complete swings (unreadable / failed) rather than hiding them. All data is the
 * worker's; nothing here is fabricated.
 */
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { HistoryThumb } from '@/components/history/history-thumb';
import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { findFault } from '@/domain';
import type { HistoryItem as HistoryItemRecord } from '@/services/analysis';

export function SwingHistoryCard({ item }: { item: HistoryItemRecord }) {
  const viewLabel = item.view === 'face_on' ? 'Face-on' : 'Down-the-line';
  const title = titleFor(item);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/report/${item.id}`)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <HistoryThumb
        analysisId={item.id}
        keypointsMeta={item.keypointsMeta}
        view={item.view}
        status={item.status}
      />
      <View style={styles.body}>
        <ThemedText style={styles.title} numberOfLines={2}>
          {title}
        </ThemedText>
        <ThemedText style={styles.meta}>
          {viewLabel} · {formatRelative(item.createdAt)}
        </ThemedText>
      </View>
      <ScoreChip item={item} />
    </Pressable>
  );
}

function titleFor(item: HistoryItemRecord): string {
  if (item.status === 'unreadable') return 'Couldn’t read that swing';
  if (item.status === 'failed') return 'Analysis didn’t finish';
  if (item.coaching?.headline) return item.coaching.headline;
  if (item.primaryFaultId) return findFault(item.primaryFaultId)?.name ?? 'Swing analysed';
  return 'No major fault — nice swing';
}

function ScoreChip({ item }: { item: HistoryItemRecord }) {
  if (item.status !== 'complete' || !item.score) {
    return (
      <View style={styles.chip}>
        <ThemedText style={styles.chipDash}>—</ThemedText>
      </View>
    );
  }
  if (item.score.withheld) {
    return (
      <View style={styles.chip}>
        <ThemedText style={styles.chipPaused}>Paused</ThemedText>
      </View>
    );
  }
  return (
    <View style={[styles.chip, styles.chipScore]}>
      <ThemedText style={styles.chipValue}>{Math.round(item.score.value)}</ThemedText>
    </View>
  );
}

// Compact relative time (no Intl/locale deps): "just now", "3h ago", "2d ago", else date.
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    padding: 10,
  },
  pressed: { opacity: 0.7 },
  body: { flex: 1, gap: 3 },
  title: { color: '#fff', fontSize: 15, fontWeight: '700', lineHeight: 20 },
  meta: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  chip: {
    minWidth: 44,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chipScore: { backgroundColor: Brand.accent },
  chipValue: { color: Brand.onAccent, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  chipPaused: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700' },
  chipDash: { color: 'rgba(255,255,255,0.4)', fontSize: 16, fontWeight: '700' },
});
