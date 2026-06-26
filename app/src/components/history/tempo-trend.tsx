/**
 * Tempo-over-time trend (Phase 6 / spec §11.2 item 7) — a small Skia sparkline of
 * tempo_ratio across the profile's swings, oldest → newest, so progress is visible. The
 * friendly target band (METRIC_META.tempo_ratio) is shaded behind the line; the latest
 * swing is emphasised. Pure measured data — no points are drawn for swings where tempo
 * wasn't an `ok` measurement (the parent filters those out).
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Path, Rect, Skia } from '@shopify/react-native-skia';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { METRIC_META } from '@/domain';

const HEIGHT = 132;
const PAD_X = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

export interface TempoTrendProps {
  /** tempo_ratio values in chronological order (oldest first), measured `ok` only. */
  values: number[];
}

export function TempoTrend({ values }: TempoTrendProps) {
  const [width, setWidth] = useState(0);
  const meta = METRIC_META.tempo_ratio;

  const geom = useMemo(() => {
    if (width === 0 || values.length < 2) return null;

    const innerW = width - PAD_X * 2;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;

    // Scale to fit the data AND the target band, with a little headroom.
    const lo = Math.min(meta.friendlyRange.min, ...values);
    const hi = Math.max(meta.friendlyRange.max, ...values);
    const pad = Math.max(0.2, (hi - lo) * 0.12);
    const yMin = lo - pad;
    const yMax = hi + pad;
    const span = yMax - yMin || 1;

    const xAt = (i: number) => PAD_X + (i / (values.length - 1)) * innerW;
    const yAt = (v: number) => PAD_TOP + (1 - (v - yMin) / span) * innerH;

    const line = Skia.Path.Make();
    values.forEach((v, i) => {
      const x = xAt(i);
      const y = yAt(v);
      if (i === 0) line.moveTo(x, y);
      else line.lineTo(x, y);
    });

    const dots = values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));

    // The shaded target band + the ideal line.
    const bandTop = yAt(meta.friendlyRange.max);
    const bandBottom = yAt(meta.friendlyRange.min);
    const idealY = yAt(meta.ideal);
    const ideal = Skia.Path.Make();
    ideal.moveTo(PAD_X, idealY);
    ideal.lineTo(width - PAD_X, idealY);

    return { line, dots, bandTop, bandHeight: bandBottom - bandTop, ideal };
  }, [width, values, meta]);

  const latest = values.length > 0 ? values[values.length - 1] : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <ThemedText style={styles.title}>Tempo trend</ThemedText>
        <ThemedText style={styles.caption}>
          {latest != null ? `latest ${latest.toFixed(1)}:1 · target 3:1` : 'target 3:1'}
        </ThemedText>
      </View>

      <View style={styles.canvasBox} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {geom ? (
          <Canvas style={StyleSheet.absoluteFill}>
            <Rect
              x={PAD_X}
              y={geom.bandTop}
              width={Math.max(0, width - PAD_X * 2)}
              height={Math.max(0, geom.bandHeight)}
              color={withAlpha(Brand.success, 0.14)}
            />
            <Path path={geom.ideal} style="stroke" strokeWidth={1} color={withAlpha(Brand.success, 0.5)} />
            <Path
              path={geom.line}
              style="stroke"
              strokeWidth={2.5}
              strokeJoin="round"
              strokeCap="round"
              color={Brand.accent}
            />
            {geom.dots.map((d, i) => {
              const isLatest = i === geom.dots.length - 1;
              const p = Skia.Path.Make();
              p.addCircle(d.x, d.y, isLatest ? 5 : 3);
              return (
                <Path key={i} path={p} style="fill" color={isLatest ? '#fff' : Brand.accent} />
              );
            })}
          </Canvas>
        ) : (
          <View style={styles.empty}>
            <ThemedText style={styles.emptyText}>
              Record a couple of swings to see your tempo trend.
            </ThemedText>
          </View>
        )}
      </View>
    </View>
  );
}

/** Skia accepts #RRGGBBAA — append an alpha byte to a #RRGGBB brand colour. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 14,
  },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 15, fontWeight: '800' },
  caption: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontVariant: ['tabular-nums'] },
  canvasBox: { height: HEIGHT, marginTop: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center' },
});
