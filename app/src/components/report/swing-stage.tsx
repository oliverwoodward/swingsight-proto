/**
 * SwingStage — the video with the synchronised skeleton overlay + fault highlight.
 *
 * Sync: expo-video's `timeUpdate` event is too coarse for a 60fps overlay, so a
 * requestAnimationFrame loop reads `player.currentTime` each frame and (on the JS thread,
 * using the canonical domain maths in coordinates.ts) interpolates the pose, projects it
 * to canvas pixels, resolves the fault segment, and writes the result into a Reanimated
 * SharedValue. Skia then assembles cheap SkPaths from those pre-projected coordinates on
 * the UI thread and repaints — so the heavy geometry stays in one place (the contract) and
 * the per-frame UI-thread work is just path assembly.
 *
 * No-drift guarantee: the stage is sized to the clip's exact aspect ratio, so expo-video's
 * contentFit="contain" letterboxing collapses to zero and computeContainFit confirms a
 * pure scale (offsets ≈ 0) — the skeleton can't slide off the body.
 *
 * The highlight is library-owned (resolveFaultHighlight) and confidence-gated: it degrades
 * to a soft region when the worker's fault confidence is low or the highlighted joints are
 * poorly seen on a given frame (spec §11.3 — never a crisp red line on uncertain points).
 */
import { type MutableRefObject, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import {
  computeContainFit,
  type FaultEvaluation,
  findFault,
  type Handedness,
  interpolateFrame,
  LOW_CONFIDENCE,
  projectPoint,
  resolveFaultHighlight,
  type ResolvedHighlight,
  resolvedJointToPoint,
  SKELETON_EDGES,
  SKELETON_JOINTS,
  type SwingEvent,
  type KeypointSeries,
} from '@/domain';

// Per-joint visibility bands for what to draw and how brightly (mirrors the keyframe
// renderer's thresholds so the live overlay matches the bookmarked frames).
const VIS_BRIGHT = 0.5;
const VIS_DIM = 0.2;
const HILITE_VIS = 0.35;

interface OverlayFrame {
  lines: number[]; // bright skeleton edges  [x1,y1,x2,y2,...]
  dim: number[]; // low-confidence edges (dimmed)
  joints: number[]; // joint dots            [x,y,...]
  hiLine: number[]; // crisp fault polyline   [x1,y1,x2,y2,...]
  hiRing: number[]; // crisp single-joint ring [cx,cy,r]
  hiSoft: number[]; // degraded soft region    [cx,cy,r]
}

const EMPTY_FRAME: OverlayFrame = {
  lines: [],
  dim: [],
  joints: [],
  hiLine: [],
  hiRing: [],
  hiSoft: [],
};

// --- worklet path builders (UI thread): assemble SkPaths from pre-projected coords ---

function buildLines(a: number[]): SkPath {
  'worklet';
  const p = Skia.Path.Make();
  for (let i = 0; i + 3 < a.length; i += 4) {
    p.moveTo(a[i], a[i + 1]);
    p.lineTo(a[i + 2], a[i + 3]);
  }
  return p;
}

function buildDots(a: number[], r: number): SkPath {
  'worklet';
  const p = Skia.Path.Make();
  for (let i = 0; i + 1 < a.length; i += 2) p.addCircle(a[i], a[i + 1], r);
  return p;
}

function buildCircle(a: number[]): SkPath {
  'worklet';
  const p = Skia.Path.Make();
  if (a.length >= 3) p.addCircle(a[0], a[1], a[2]);
  return p;
}

// --- per-frame projection (JS thread, canonical domain maths) ---

function computeFrame(
  series: KeypointSeries,
  t: number,
  fit: ReturnType<typeof computeContainFit>,
  resolved: ResolvedHighlight | null,
  faultConfidence: number,
  tentative: boolean,
): OverlayFrame {
  const lm = interpolateFrame(series, t);
  if (!lm) return EMPTY_FRAME;

  const lines: number[] = [];
  const dim: number[] = [];
  const joints: number[] = [];

  for (const [a, b] of SKELETON_EDGES) {
    const pa = lm[a];
    const pb = lm[b];
    if (pa.visibility < VIS_DIM || pb.visibility < VIS_DIM) continue;
    const A = projectPoint(pa.x, pa.y, fit);
    const B = projectPoint(pb.x, pb.y, fit);
    const bright = pa.visibility >= VIS_BRIGHT && pb.visibility >= VIS_BRIGHT;
    (bright ? lines : dim).push(A.x, A.y, B.x, B.y);
  }
  for (const j of SKELETON_JOINTS) {
    if (lm[j].visibility >= VIS_BRIGHT) {
      const P = projectPoint(lm[j].x, lm[j].y, fit);
      joints.push(P.x, P.y);
    }
  }

  let hiLine: number[] = [];
  let hiRing: number[] = [];
  let hiSoft: number[] = [];

  if (resolved && t >= resolved.startT && t <= resolved.endT) {
    const pts = resolved.joints.map((jt) => {
      const k = resolvedJointToPoint(jt, lm);
      const P = projectPoint(k.x, k.y, fit);
      return { x: P.x, y: P.y, v: k.visibility };
    });
    const meanVis = pts.reduce((s, p) => s + p.v, 0) / Math.max(pts.length, 1);
    // A tentative (soft_only) fault never gets a crisp red line — it's a words-only
    // observation, so it always degrades to the soft region regardless of confidence.
    const crisp = !tentative && faultConfidence >= LOW_CONFIDENCE && meanVis >= HILITE_VIS;
    const span = Math.max(fit.drawWidth, fit.drawHeight);

    if (crisp && pts.length >= 2) {
      for (let i = 0; i < pts.length - 1; i++) {
        hiLine.push(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      }
    } else if (crisp && pts.length === 1) {
      hiRing = [pts[0].x, pts[0].y, span * 0.05];
    } else {
      // Degrade: soft region around the segment centroid (words-only is the floor).
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const spread = Math.max(24, ...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
      hiSoft = [cx, cy, spread + span * 0.04];
    }
  }

  return { lines, dim, joints, hiLine, hiRing, hiSoft };
}

// ---------------------------------------------------------------------------

export interface SwingStageProps {
  url: string;
  series: KeypointSeries;
  events: SwingEvent[];
  faults: FaultEvaluation[];
  handedness: Handedness;
  /** The coaching's chosen fault id (null when no fault was selected). */
  highlightFaultId: string | null;
  /** Shared current-time (seconds), written here, read by the PhaseScrubber. */
  time: SharedValue<number>;
  /** Filled with the player so the scrubber can seek. */
  playerRef: MutableRefObject<VideoPlayer | null>;
}

export function SwingStage({
  url,
  series,
  events,
  faults,
  handedness,
  highlightFaultId,
  time,
  playerRef,
}: SwingStageProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [playing, setPlaying] = useState(true);
  const frame = useSharedValue<OverlayFrame>(EMPTY_FRAME);

  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    playerRef.current = player;
    return () => {
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [player, playerRef]);

  // Resolve the library-owned highlight (segment + phase window) for the chosen fault.
  const entry = highlightFaultId ? findFault(highlightFaultId) : undefined;
  const resolved = entry ? resolveFaultHighlight(entry, handedness, events) : null;
  const evaluation = highlightFaultId
    ? faults.find((f) => f.faultId === highlightFaultId)
    : undefined;
  const faultConfidence = evaluation?.confidence ?? 0;
  // A soft_only (not claim-eligible) fault is a tentative observation → keep the overlay
  // soft, never a crisp line. Reads the eval's own structural flag, not a UI guess.
  const tentative = evaluation ? !evaluation.claimEligible : false;

  // The 60fps sync loop: read currentTime, project, publish to the SharedValue.
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    const fit = computeContainFit(series.videoWidth, series.videoHeight, size.w, size.h);
    let raf = 0;
    const loop = () => {
      const t = player.currentTime ?? 0;
      time.value = t;
      frame.value = computeFrame(series, t, fit, resolved, faultConfidence, tentative);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player, series, size.w, size.h, resolved, faultConfidence, tentative, time, frame]);

  const skeleton = useDerivedValue(() => buildLines(frame.value.lines), [frame]);
  const skeletonDim = useDerivedValue(() => buildLines(frame.value.dim), [frame]);
  const jointDots = useDerivedValue(() => buildDots(frame.value.joints, 3), [frame]);
  const hiLine = useDerivedValue(() => buildLines(frame.value.hiLine), [frame]);
  const hiRing = useDerivedValue(() => buildCircle(frame.value.hiRing), [frame]);
  const hiSoft = useDerivedValue(() => buildCircle(frame.value.hiSoft), [frame]);

  const aspect = series.videoWidth > 0 ? series.videoWidth / series.videoHeight : 9 / 16;

  const toggle = () => {
    if (playing) player.pause();
    else player.play();
    setPlaying((p) => !p);
  };

  return (
    <View
      style={[styles.stage, { aspectRatio: aspect }]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="contain"
        nativeControls={false}
      />

      {size.w > 0 ? (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path path={skeletonDim} style="stroke" strokeWidth={2} strokeCap="round" color={Brand.skeletonDim} />
          <Path path={skeleton} style="stroke" strokeWidth={2.5} strokeCap="round" color={Brand.skeleton} />
          <Path path={jointDots} style="fill" color={Brand.skeletonJoint} />
          {/* soft (degraded) region under, crisp highlight over */}
          <Path path={hiSoft} style="fill" color={withAlpha(Brand.highlight, 0.28)} />
          <Path path={hiRing} style="stroke" strokeWidth={5} color={Brand.highlight} />
          <Path path={hiLine} style="stroke" strokeWidth={5} strokeCap="round" strokeJoin="round" color={Brand.highlight} />
        </Canvas>
      ) : null}

      <Pressable style={StyleSheet.absoluteFill} onPress={toggle} accessibilityRole="button">
        {!playing ? (
          <View style={styles.playOverlay} pointerEvents="none">
            <ThemedText style={styles.playGlyph}>▶</ThemedText>
          </View>
        ) : null}
      </Pressable>
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
  stage: { width: '100%', backgroundColor: '#000', position: 'relative', overflow: 'hidden' },
  playOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  playGlyph: { color: '#fff', fontSize: 56, opacity: 0.9 },
});
