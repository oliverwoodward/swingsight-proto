/**
 * PhaseScrubber — a progress bar plus tappable bookmarks for the 8 swing events.
 *
 * The fill tracks the player via the shared `time` value (read on the UI thread, no
 * re-render); tapping an event seeks the player to that event's timestamp.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { EVENT_LABELS, type SwingEvent } from '@/domain';

interface PhaseScrubberProps {
  events: SwingEvent[];
  time: SharedValue<number>;
  /** Total clip duration in seconds (for positioning the fill). */
  duration: number;
  onSeek: (t: number) => void;
}

export function PhaseScrubber({ events, time, duration, onSeek }: PhaseScrubberProps) {
  const fillStyle = useAnimatedStyle(() => {
    const d = duration > 0 ? duration : 1;
    const pct = Math.max(0, Math.min(1, time.value / d)) * 100;
    return { width: `${pct}%` };
  });

  return (
    <View style={styles.root}>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, fillStyle]} />
        {events.map((e) => {
          const left = duration > 0 ? Math.max(0, Math.min(1, e.t / duration)) * 100 : 0;
          return <View key={`tick-${e.name}`} style={[styles.tick, { left: `${left}%` }]} />;
        })}
      </View>
      <View style={styles.labels}>
        {events.map((e) => (
          <Pressable
            key={`btn-${e.name}`}
            onPress={() => onSeek(e.t)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
          >
            <ThemedText style={styles.chipText}>{EVENT_LABELS[e.name]}</ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'visible',
    justifyContent: 'center',
  },
  fill: { position: 'absolute', left: 0, height: 6, borderRadius: 3, backgroundColor: Brand.accent },
  tick: {
    position: 'absolute',
    width: 2,
    height: 12,
    marginLeft: -1,
    top: -3,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipPressed: { opacity: 0.6 },
  chipText: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },
});
