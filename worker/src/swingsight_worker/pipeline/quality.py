"""Input-quality gate (spec §8 step 9 + §11.4; PRD Phase 3 item 9).

A wrong, confident analysis costs more trust than an honest "we couldn't read that
swing." So before we trust any metric, we check the pose evidence for the documented
bad-input cases and, if one trips, return status `unreadable` with specific re-record
guidance — never a fabricated analysis. Checks (most fundamental first):

  no_person      — almost no frames had a detectable body.
  too_dark       — frames are very dark (and pose failed), the actionable cause.
  partial_body   — upper body seen but legs are out of frame (framing too close).
  multiple_people— the detected body teleports, suggesting more than one person
                   (best-effort; tuned conservative to avoid false positives).
  no_swing_detected — a person is there but no clear strike (a whiff / not a swing).
  too_blurry     — the still address frame is out of focus.

A pass returns ok=True with the mean keypoint confidence, which the score and faults
also consume.
"""

from __future__ import annotations

import logging

import numpy as np

from ..determinism import CONF_DECIMALS, configure_opencv_single_thread, q
from ..domain import keypoints as K
from .domain_const import FULL_BODY_LANDMARKS
from .types import NormalizedClip, PoseSeries, SwingEvents

logger = logging.getLogger("swingsight.worker.quality")

_GUIDANCE = {
    "no_person": "We couldn't find a golfer in the frame. Stand fully in view, about "
    "2–3 m from the phone, and record again.",
    "too_dark": "The video was too dark to read. Move to brighter, even lighting and "
    "record again.",
    "partial_body": "Some of your body was out of frame. Step back so your whole body — "
    "head to feet — is visible, then record again.",
    "multiple_people": "We saw more than one person moving in the frame. Record with "
    "just the golfer in view.",
    "no_swing_detected": "We couldn't detect a full swing. Record from address through "
    "to your finish so we can see the whole motion.",
    "too_blurry": "The video looked out of focus. Wipe the lens, tap to focus on the "
    "golfer, and record again.",
}


def _mean_brightness(frames: list[np.ndarray]) -> float:
    if not frames:
        return 0.0
    step = max(1, len(frames) // 12)
    sampled = frames[::step]
    return float(np.mean([f.mean() for f in sampled]))


def _address_sharpness(frames: list[np.ndarray], address_idx: int) -> float:
    import cv2

    configure_opencv_single_thread()
    i = int(np.clip(address_idx, 0, len(frames) - 1))
    gray = cv2.cvtColor(frames[i], cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _multiple_people(pose: PoseSeries, clip: NormalizedClip) -> bool:
    det = pose.detected
    center = 0.5 * (pose.image[:, K.LEFT_SHOULDER, :2] + pose.image[:, K.RIGHT_SHOULDER, :2])
    jumps = 0
    pairs = 0
    last = None
    for t in range(len(det)):
        if not det[t]:
            last = None
            continue
        if last is not None:
            pairs += 1
            if float(np.linalg.norm(center[t] - center[last])) > 0.35:
                jumps += 1
        last = t
    return pairs > 4 and (jumps / pairs) > 0.25


def assess_quality(
    pose: PoseSeries, clip: NormalizedClip, events: SwingEvents
) -> dict:
    n = clip.num_frames
    detected_frac = float(pose.detected.mean()) if n else 0.0
    mean_kp = (
        float(pose.core_visibility[pose.detected].mean()) if pose.detected.any() else 0.0
    )
    brightness = _mean_brightness(clip.frames)

    full_body_vis = (
        float(np.mean(pose.image[pose.detected][:, FULL_BODY_LANDMARKS, 2]))
        if pose.detected.any()
        else 0.0
    )
    upper_vis = (
        float(
            np.mean(
                pose.image[pose.detected][
                    :, [K.LEFT_SHOULDER, K.RIGHT_SHOULDER, K.LEFT_HIP, K.RIGHT_HIP], 2
                ]
            )
        )
        if pose.detected.any()
        else 0.0
    )

    reason: str | None = None
    if detected_frac < 0.3:
        reason = "too_dark" if brightness < 40 else "no_person"
    elif full_body_vis < 0.35 and upper_vis > 0.5:
        reason = "partial_body"
    elif _multiple_people(pose, clip):
        reason = "multiple_people"
    elif events.detection_confidence < 0.35:
        reason = "no_swing_detected"
    else:
        address_idx = events.events["address"]["frameIndex"]
        if _address_sharpness(clip.frames, address_idx) < 12.0:
            reason = "too_blurry"

    report: dict = {"ok": reason is None, "meanKeypointConfidence": q(mean_kp, CONF_DECIMALS)}
    if reason is not None:
        report["reason"] = reason
        report["guidance"] = _GUIDANCE[reason]
        logger.info(
            "quality: UNREADABLE (%s) detected_frac=%.2f brightness=%.0f full_body_vis=%.2f",
            reason, detected_frac, brightness, full_body_vis,
        )
    else:
        logger.info("quality: ok (meanKeypointConfidence=%.3f)", mean_kp)
    return report
