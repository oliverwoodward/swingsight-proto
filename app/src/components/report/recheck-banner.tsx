/**
 * The drill-then-recheck banner (Phase 6 / spec §12) — the report LEADS with this when a
 * comparison to the last same-view swing exists. The verdict + numbers are the worker's
 * deterministic `DrillRecheck`; this only presents them. Direction-aware and honest: an
 * "improved" reading is celebrated, "regressed"/"same" are stated plainly and point back
 * to the drill. Approximate metrics show no raw figures (a qualitative trend only).
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import type { DrillRecheck } from '@/domain';
import { describeRecheck, type RecheckTone } from '@/utils/recheck-copy';

const TONE_COLOR: Record<RecheckTone, string> = {
  improved: Brand.success,
  regressed: Brand.highlight,
  same: 'rgba(255,255,255,0.55)',
};

const TONE_GLYPH: Record<RecheckTone, string> = {
  improved: '▲',
  regressed: '▼',
  same: '＝',
};

export function RecheckBanner({ recheck }: { recheck: DrillRecheck }) {
  const copy = describeRecheck(recheck);
  const color = TONE_COLOR[copy.tone];

  return (
    <View style={[styles.card, { borderColor: color }]}>
      <View style={styles.headerRow}>
        <View style={[styles.glyphChip, { backgroundColor: color }]}>
          <ThemedText style={styles.glyph}>{TONE_GLYPH[copy.tone]}</ThemedText>
        </View>
        <ThemedText style={styles.kicker}>Since last time</ThemedText>
      </View>

      <ThemedText style={[styles.title, { color }]}>{copy.title}</ThemedText>
      <ThemedText style={styles.detail}>{copy.detail}</ThemedText>

      {copy.movement ? (
        <View style={styles.movementRow}>
          <ThemedText style={styles.movementLabel}>Last</ThemedText>
          <ThemedText style={styles.movementPrev}>{copy.movement.previous}</ThemedText>
          <ThemedText style={[styles.movementArrow, { color }]}>→</ThemedText>
          <ThemedText style={[styles.movementNow, { color }]}>{copy.movement.current}</ThemedText>
          <ThemedText style={styles.movementLabel}>now</ThemedText>
        </View>
      ) : null}

      {copy.drillTitle ? (
        <ThemedText style={styles.drillNote}>
          {copy.tone === 'improved' ? 'Keep at it: ' : 'Same drill: '}
          <ThemedText style={styles.drillTitle}>{copy.drillTitle}</ThemedText>
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 18,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 16,
    gap: 6,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  glyphChip: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: '#0B0C0E', fontSize: 12, fontWeight: '900' },
  kicker: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },

  title: { fontSize: 20, fontWeight: '900' },
  detail: { color: 'rgba(255,255,255,0.85)', fontSize: 15, lineHeight: 22 },

  movementRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  movementLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '600' },
  movementPrev: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  movementArrow: { fontSize: 15, fontWeight: '900' },
  movementNow: { fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },

  drillNote: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 2 },
  drillTitle: { color: '#fff', fontWeight: '700' },
});
