/**
 * Coordinate transforms for the skeleton overlay.
 *
 * Keypoints are normalised to [0,1] against the source video frame. The overlay
 * Canvas sits on top of the video, which is rendered with contentFit="contain"
 * (letterboxed, centered). To keep the skeleton glued to the body, this module
 * replicates that exact letterbox math — any mismatch makes the skeleton slide off.
 *
 * It also interpolates between sampled pose frames so the skeleton moves smoothly at
 * 60fps even though poses are sampled at the (possibly lower) analysis rate.
 */

import { BLAZEPOSE_LANDMARK_COUNT } from './keypoints';
import type { ResolvedJoint } from './highlight';
import type { Keypoint, KeypointFrame, KeypointSeries } from './types';

export interface ContainFit {
  scale: number;
  offsetX: number;
  offsetY: number;
  drawWidth: number;
  drawHeight: number;
}

/**
 * Compute how a source frame of (srcW × srcH) is laid out inside a (dstW × dstH)
 * box under contentFit="contain": scaled to fit, centered, letterboxed.
 */
export function computeContainFit(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): ContainFit {
  if (srcW <= 0 || srcH <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0, drawWidth: dstW, drawHeight: dstH };
  }
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const drawWidth = srcW * scale;
  const drawHeight = srcH * scale;
  return {
    scale,
    drawWidth,
    drawHeight,
    offsetX: (dstW - drawWidth) / 2,
    offsetY: (dstH - drawHeight) / 2,
  };
}

/** Project a normalised [0,1] source point to canvas coordinates. */
export function projectPoint(
  nx: number,
  ny: number,
  fit: ContainFit,
): { x: number; y: number } {
  return {
    x: fit.offsetX + nx * fit.drawWidth,
    y: fit.offsetY + ny * fit.drawHeight,
  };
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

function lerpKeypoint(a: Keypoint, b: Keypoint, f: number): Keypoint {
  return {
    x: lerp(a.x, b.x, f),
    y: lerp(a.y, b.y, f),
    // visibility takes the more conservative (lower) of the two while blending.
    visibility: Math.min(a.visibility, b.visibility),
  };
}

/**
 * Return an interpolated full-body pose (33 landmarks) at time `t` seconds. Clamps
 * to the first/last frame outside the captured range. Returns null if empty.
 */
export function interpolateFrame(series: KeypointSeries, t: number): Keypoint[] | null {
  const frames = series.frames;
  if (frames.length === 0) return null;
  if (t <= frames[0].t) return frames[0].landmarks;
  const last = frames[frames.length - 1];
  if (t >= last.t) return last.landmarks;

  // binary search for the bracketing pair
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a: KeypointFrame = frames[lo];
  const b: KeypointFrame = frames[hi];
  const span = b.t - a.t;
  const f = span > 0 ? (t - a.t) / span : 0;

  const out: Keypoint[] = new Array(BLAZEPOSE_LANDMARK_COUNT);
  for (let i = 0; i < BLAZEPOSE_LANDMARK_COUNT; i++) {
    out[i] = lerpKeypoint(a.landmarks[i], b.landmarks[i], f);
  }
  return out;
}

/**
 * Resolve a ResolvedJoint (landmark or synthesised midpoint) to a normalised point
 * with a combined visibility, from a full-body pose.
 */
export function resolvedJointToPoint(
  joint: ResolvedJoint,
  landmarks: Keypoint[],
): Keypoint {
  if (joint.kind === 'landmark') {
    return landmarks[joint.index];
  }
  const a = landmarks[joint.a];
  const b = landmarks[joint.b];
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}
