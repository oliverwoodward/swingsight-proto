import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import type { Handedness, SwingView } from '@/domain';

type FramingOverlayProps = {
  view: SwingView;
  handedness: Handedness;
};

/**
 * The live capture guide (spec Stage 4 / §2.1): an alignment frame, a distance
 * guide, and a lighting/background setup hint.
 *
 * The hint is honest *setup guidance*, not a fabricated live pass/fail — a real
 * automated low-light / busy-background warning needs frame access (vision-camera
 * frame processors) and is deferred. The authoritative input-quality gate (no
 * person / partial body / too dark / no strike) is measured by the worker
 * (spec §5/§8) and surfaced as graceful re-record guidance in Phase 4.
 *
 * Rendered non-interactive so the record button and view switcher stay tappable.
 */
export function FramingOverlay({ view, handedness }: FramingOverlayProps) {
  const lead = handedness === 'RH' ? 'left' : 'right';
  const distance =
    view === 'face_on'
      ? 'Phone upright, ~3–4m in front of you. Fit your whole body head-to-club.'
      : `Phone upright, ~3–4m behind you along your target line, on your ${lead} side.`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Top hint: things to check before recording. */}
      <View style={styles.topHint}>
        <ThemedText style={styles.hintTitle}>Before you swing</ThemedText>
        <ThemedText style={styles.hintText}>
          Even lighting · plain background · whole body in frame
        </ThemedText>
      </View>

      {/* Center alignment frame with corner brackets. */}
      <View style={styles.frameWrap}>
        <View style={styles.frame}>
          <Corner style={styles.tl} />
          <Corner style={styles.tr} />
          <Corner style={styles.bl} />
          <Corner style={styles.br} />
          <ThemedText style={styles.frameCaption}>
            {view === 'face_on' ? 'Face the camera' : 'Stand side-on'}
          </ThemedText>
        </View>
      </View>

      {/* Bottom distance guide, sits above the record controls. */}
      <View style={styles.bottomHint}>
        <ThemedText style={styles.distance}>{distance}</ThemedText>
      </View>
    </View>
  );
}

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />;
}

const CORNER = 28;
const THICK = 3;

const styles = StyleSheet.create({
  topHint: {
    position: 'absolute',
    top: 88,
    left: 20,
    right: 20,
    alignItems: 'center',
    gap: 2,
    backgroundColor: Brand.scrim,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  hintTitle: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
  hintText: { color: 'rgba(255,255,255,0.82)', fontSize: 13 },

  frameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: '74%',
    height: '64%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 12,
  },
  frameCaption: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: Brand.scrim,
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: 'rgba(255,255,255,0.92)',
  },
  tl: { top: 0, left: 0, borderTopWidth: THICK, borderLeftWidth: THICK, borderTopLeftRadius: 8 },
  tr: { top: 0, right: 0, borderTopWidth: THICK, borderRightWidth: THICK, borderTopRightRadius: 8 },
  bl: {
    bottom: 0,
    left: 0,
    borderBottomWidth: THICK,
    borderLeftWidth: THICK,
    borderBottomLeftRadius: 8,
  },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: THICK,
    borderRightWidth: THICK,
    borderBottomRightRadius: 8,
  },

  bottomHint: {
    position: 'absolute',
    bottom: 150,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  distance: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    textAlign: 'center',
    backgroundColor: Brand.scrim,
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
