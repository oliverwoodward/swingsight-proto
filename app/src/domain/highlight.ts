/**
 * Highlight resolution. The fault library entry owns *what* segment is highlighted
 * (logical joints + phase window); this module turns that into concrete, drawable
 * points using handedness, and the detected events into a time window. The AI never
 * supplies a joint index or a frame number — this is the only path to the overlay.
 */

import { resolvePhaseWindow } from './events';
import { MIDPOINT_REFS, jointRefToIndex } from './keypoints';
import type {
  FaultLibraryEntry,
  Handedness,
  SkeletonJointRef,
  SwingEvent,
} from './types';

/** A point to draw: either a single landmark or the midpoint of two landmarks. */
export type ResolvedJoint =
  | { kind: 'landmark'; index: number }
  | { kind: 'midpoint'; a: number; b: number };

export function resolveJointRef(
  ref: SkeletonJointRef,
  handedness: Handedness,
): ResolvedJoint {
  const mid = MIDPOINT_REFS[ref];
  if (mid) return { kind: 'midpoint', a: mid[0], b: mid[1] };
  return { kind: 'landmark', index: jointRefToIndex(ref, handedness) };
}

export function resolveSegment(
  joints: SkeletonJointRef[],
  handedness: Handedness,
): ResolvedJoint[] {
  return joints.map((j) => resolveJointRef(j, handedness));
}

export interface ResolvedHighlight {
  faultId: string;
  joints: ResolvedJoint[];
  /** Time window (seconds) the highlight is active. */
  startT: number;
  endT: number;
  /** Frame window for the keypoint series. */
  startFrame: number;
  endFrame: number;
}

/**
 * Resolve a fault's highlight against a profile's handedness and the detected
 * events. Returns null when the phase-window events were not detected (degrade to
 * words-only in the UI).
 */
export function resolveFaultHighlight(
  entry: FaultLibraryEntry,
  handedness: Handedness,
  events: SwingEvent[],
): ResolvedHighlight | null {
  const window = resolvePhaseWindow(
    events,
    entry.highlight.phaseWindow.start,
    entry.highlight.phaseWindow.end,
  );
  if (!window) return null;
  return {
    faultId: entry.id,
    joints: resolveSegment(entry.highlight.joints, handedness),
    ...window,
  };
}
