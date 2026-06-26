import { CommonResolutions } from 'react-native-vision-camera';

/**
 * Capture pipeline settings. One consistent profile across devices (PRD §4):
 * 1080p / 60fps. The worker normalises whatever really lands (VFR, sub-60fps)
 * in Phase 3 — these are the *targets* we ask the camera to hit.
 */
export const CAPTURE = {
  /** Target frame rate. 60fps ≈ 16.7ms resolution — ample for amateur tempo. */
  targetFps: 60,
  /** Target capture resolution (portrait 1080×1920). */
  targetResolution: CommonResolutions.FHD_16_9,
  /** Pre-record countdown, seconds. Gives the golfer time to get set. */
  countdownSeconds: 3,
  /** Hard cap on a single recording, seconds. A swing + a little runway. */
  maxDurationSeconds: 8,
} as const;
