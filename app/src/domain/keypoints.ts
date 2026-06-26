/**
 * MediaPipe BlazePose topology (33 landmarks). The cloud worker runs BlazePose and
 * emits landmarks in exactly this order, so the overlay indexes them directly.
 *
 * This file is the single source of truth for the lead/trail limb mapping. A wrong
 * map here highlights the wrong arm on the user's own video — the most visible
 * failure mode — so it is unit-tested and used everywhere (never re-derived inline).
 */

import type { Handedness, SkeletonJointRef } from './types';

/** BlazePose 33-landmark indices. */
export const BlazePose = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export const BLAZEPOSE_LANDMARK_COUNT = 33;

/**
 * Connections drawn for the stick-figure overlay. A curated subset of BlazePose's
 * POSE_CONNECTIONS that reads cleanly on a swing (torso + limbs, no dense face).
 */
export const SKELETON_EDGES: ReadonlyArray<readonly [number, number]> = [
  // torso
  [BlazePose.LEFT_SHOULDER, BlazePose.RIGHT_SHOULDER],
  [BlazePose.LEFT_SHOULDER, BlazePose.LEFT_HIP],
  [BlazePose.RIGHT_SHOULDER, BlazePose.RIGHT_HIP],
  [BlazePose.LEFT_HIP, BlazePose.RIGHT_HIP],
  // left arm
  [BlazePose.LEFT_SHOULDER, BlazePose.LEFT_ELBOW],
  [BlazePose.LEFT_ELBOW, BlazePose.LEFT_WRIST],
  // right arm
  [BlazePose.RIGHT_SHOULDER, BlazePose.RIGHT_ELBOW],
  [BlazePose.RIGHT_ELBOW, BlazePose.RIGHT_WRIST],
  // left leg
  [BlazePose.LEFT_HIP, BlazePose.LEFT_KNEE],
  [BlazePose.LEFT_KNEE, BlazePose.LEFT_ANKLE],
  [BlazePose.LEFT_ANKLE, BlazePose.LEFT_FOOT_INDEX],
  // right leg
  [BlazePose.RIGHT_HIP, BlazePose.RIGHT_KNEE],
  [BlazePose.RIGHT_KNEE, BlazePose.RIGHT_ANKLE],
  [BlazePose.RIGHT_ANKLE, BlazePose.RIGHT_FOOT_INDEX],
  // head to shoulders (light)
  [BlazePose.NOSE, BlazePose.LEFT_SHOULDER],
  [BlazePose.NOSE, BlazePose.RIGHT_SHOULDER],
];

/** Joints drawn as filled circles in the overlay (the meaningful body joints). */
export const SKELETON_JOINTS: readonly number[] = [
  BlazePose.NOSE,
  BlazePose.LEFT_SHOULDER,
  BlazePose.RIGHT_SHOULDER,
  BlazePose.LEFT_ELBOW,
  BlazePose.RIGHT_ELBOW,
  BlazePose.LEFT_WRIST,
  BlazePose.RIGHT_WRIST,
  BlazePose.LEFT_HIP,
  BlazePose.RIGHT_HIP,
  BlazePose.LEFT_KNEE,
  BlazePose.RIGHT_KNEE,
  BlazePose.LEFT_ANKLE,
  BlazePose.RIGHT_ANKLE,
];

/**
 * For a right-handed golfer the LEAD side is the LEFT body side; for a left-handed
 * golfer it is the RIGHT. This is the only place that decision is encoded.
 */
function leadIsLeft(handedness: Handedness): boolean {
  return handedness === 'RH';
}

/** Single-landmark logical refs → concrete BlazePose index, given handedness. */
export function jointRefToIndex(ref: SkeletonJointRef, handedness: Handedness): number {
  const leadLeft = leadIsLeft(handedness);
  switch (ref) {
    case 'lead_shoulder':
      return leadLeft ? BlazePose.LEFT_SHOULDER : BlazePose.RIGHT_SHOULDER;
    case 'trail_shoulder':
      return leadLeft ? BlazePose.RIGHT_SHOULDER : BlazePose.LEFT_SHOULDER;
    case 'lead_elbow':
      return leadLeft ? BlazePose.LEFT_ELBOW : BlazePose.RIGHT_ELBOW;
    case 'trail_elbow':
      return leadLeft ? BlazePose.RIGHT_ELBOW : BlazePose.LEFT_ELBOW;
    case 'lead_wrist':
      return leadLeft ? BlazePose.LEFT_WRIST : BlazePose.RIGHT_WRIST;
    case 'trail_wrist':
      return leadLeft ? BlazePose.RIGHT_WRIST : BlazePose.LEFT_WRIST;
    case 'lead_hip':
      return leadLeft ? BlazePose.LEFT_HIP : BlazePose.RIGHT_HIP;
    case 'trail_hip':
      return leadLeft ? BlazePose.RIGHT_HIP : BlazePose.LEFT_HIP;
    case 'lead_knee':
      return leadLeft ? BlazePose.LEFT_KNEE : BlazePose.RIGHT_KNEE;
    case 'trail_knee':
      return leadLeft ? BlazePose.RIGHT_KNEE : BlazePose.LEFT_KNEE;
    case 'lead_ankle':
      return leadLeft ? BlazePose.LEFT_ANKLE : BlazePose.RIGHT_ANKLE;
    case 'trail_ankle':
      return leadLeft ? BlazePose.RIGHT_ANKLE : BlazePose.LEFT_ANKLE;
    case 'head':
      return BlazePose.NOSE;
    // Midpoints are synthesised by callers; default to a sensible anchor.
    case 'pelvis_mid':
      return BlazePose.LEFT_HIP;
    case 'shoulder_mid':
      return BlazePose.LEFT_SHOULDER;
    default: {
      const exhaustive: never = ref;
      return exhaustive;
    }
  }
}

/** Midpoint refs that must be synthesised from two landmarks rather than indexed. */
export const MIDPOINT_REFS: Partial<Record<SkeletonJointRef, [number, number]>> = {
  pelvis_mid: [BlazePose.LEFT_HIP, BlazePose.RIGHT_HIP],
  shoulder_mid: [BlazePose.LEFT_SHOULDER, BlazePose.RIGHT_SHOULDER],
};
