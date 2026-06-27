"""Swing-event detection — kinematic heuristics (spec §8 step 4; PRD Phase 3 item 5).

Commercial-safe (no SwingNet/GolfDB weights). Works in the TIME domain off the
refined mid-wrist trajectory, using REAL frame timestamps so it is frame-rate robust:

  * top    = hands at their highest (min image-y) before the strike.
  * impact = peak mid-wrist speed after the top (the downswing strike).
  * address/finish = the swing brackets where motion starts/stops (stillness).
  * the four mid events are filled proportionally between those anchors.

Mid-wrist is a visibility-weighted blend of both wrists, so it survives one hand
being briefly occluded and is handedness-agnostic. Each event carries a confidence
that folds in pose visibility, peak prominence and whether the ordering held; low
confidence flows through to the fault confidence gate and the score.
"""

from __future__ import annotations

import logging

import numpy as np

from ..domain import keypoints as K
from .domain_const import calibrate_visibility
from .types import NormalizedClip, PoseSeries, SwingEvents

logger = logging.getLogger("swingsight.worker.events")

EVENT_ORDER = (
    "address",
    "toe_up",
    "mid_backswing",
    "top",
    "mid_downswing",
    "impact",
    "mid_follow_through",
    "finish",
)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _mid_wrist_px(pose: PoseSeries, w: int, h: int) -> np.ndarray:
    """Visibility-weighted mid-wrist track in pixel space, (T,2)."""
    lw = pose.image[:, K.LEFT_WRIST]
    rw = pose.image[:, K.RIGHT_WRIST]
    wl = np.clip(lw[:, 2:3], 1e-3, None)
    wr = np.clip(rw[:, 2:3], 1e-3, None)
    mid = (lw[:, :2] * wl + rw[:, :2] * wr) / (wl + wr)
    mid[:, 0] *= w
    mid[:, 1] *= h
    return mid


def _fill_mids(address: int, top: int, impact: int, finish: int) -> dict[str, int]:
    return {
        "address": address,
        "toe_up": int(round(address + 0.33 * (top - address))),
        "mid_backswing": int(round(address + 0.66 * (top - address))),
        "top": top,
        "mid_downswing": int(round((top + impact) / 2)),
        "impact": impact,
        "mid_follow_through": int(round((impact + finish) / 2)),
        "finish": finish,
    }


def detect_events(pose: PoseSeries, clip: NormalizedClip) -> SwingEvents:
    n = clip.num_frames
    times = clip.timestamps
    if n < 4:
        idx = _fill_mids(0, n // 2, int(n * 0.7), n - 1)
        return _assemble(idx, times, pose, 0.3)

    mid = _mid_wrist_px(pose, clip.playback_width, clip.playback_height)

    # Speed from real timestamps; guard against zero/huge dt on VFR seams.
    dt = np.diff(times)
    med_dt = float(np.median(dt[dt > 0])) if np.any(dt > 0) else 1.0 / clip.target_fps
    dt = np.where(dt > 0, dt, med_dt)
    step = np.linalg.norm(np.diff(mid, axis=0), axis=1)
    vel = np.zeros(n)
    vel[1:] = step / dt

    # Only trust frames with a detected person for the brackets.
    det = pose.detected
    vel_masked = np.where(det, vel, 0.0)
    y = mid[:, 1]
    y_masked = np.where(det, y, np.inf)

    # top = highest hands (min y) in the first 85% of the clip.
    search_top = max(2, int(0.85 * n))
    top = int(np.argmin(y_masked[:search_top]))

    # impact = peak speed after the top.
    seg = vel_masked[top:]
    impact = top + int(np.argmax(seg)) if seg.size else min(int(0.7 * n), n - 1)
    impact = int(_clamp(impact, top + 1, n - 1))

    vmax = float(vel_masked.max()) if vel_masked.max() > 0 else 1.0
    moving = np.where(vel_masked > 0.12 * vmax)[0]
    address = max(0, int(moving[0]) - 1) if moving.size else 0
    finish = min(n - 1, int(moving[-1]) + 1) if moving.size else n - 1

    ordering_ok = address < top < impact < finish
    if not ordering_ok:
        address, finish = 0, n - 1
        top = int(_clamp(top, 1, n - 3))
        impact = int(_clamp(impact, top + 1, n - 2))

    idx = _fill_mids(address, top, impact, finish)

    # Confidence: peak prominence × wrist visibility × ordering.
    med_vel = float(np.median(vel_masked[vel_masked > 0])) if np.any(vel_masked > 0) else 1.0
    prominence = _clamp((vmax / max(med_vel, 1e-6)) / 4.0, 0.0, 1.0)
    swing_slice = slice(max(0, address), min(n, finish + 1))
    wrist_vis = float(
        np.mean(
            [
                pose.image[swing_slice, K.LEFT_WRIST, 2],
                pose.image[swing_slice, K.RIGHT_WRIST, 2],
            ]
        )
    )
    detection_conf = _clamp(0.3 + 0.35 * prominence + 0.35 * wrist_vis, 0.0, 1.0)
    if not ordering_ok:
        detection_conf *= 0.6
    detection_conf *= clip.normalization_confidence

    logger.info(
        "events: address=%d top=%d impact=%d finish=%d (conf %.2f, prominence %.2f, wristvis %.2f)",
        address, top, impact, finish, detection_conf, prominence, wrist_vis,
    )
    return _assemble(idx, times, pose, detection_conf)


def _assemble(
    idx: dict[str, int], times: np.ndarray, pose: PoseSeries, detection_conf: float
) -> SwingEvents:
    # Directly-detected anchors are more trustworthy than interpolated mids.
    directness = {
        "address": 0.9, "toe_up": 0.8, "mid_backswing": 0.8, "top": 1.0,
        "mid_downswing": 0.8, "impact": 1.0, "mid_follow_through": 0.8, "finish": 0.9,
    }
    n = len(times)
    events: dict[str, dict] = {}
    for name in EVENT_ORDER:
        fi = int(_clamp(idx[name], 0, n - 1))
        wrist_vis = float(
            0.5 * (pose.image[fi, K.LEFT_WRIST, 2] + pose.image[fi, K.RIGHT_WRIST, 2])
        )
        # Calibrate the per-event wrist visibility (raw ≈0.5 = "clearly seen") so a
        # cleanly-filmed event isn't anchored at half-confidence. The detection_conf
        # base term above keeps RAW wrist_vis on purpose — it feeds the no_swing_detected
        # quality gate, whose threshold must not move.
        conf = _clamp(
            detection_conf * directness[name] * (0.5 + 0.5 * calibrate_visibility(wrist_vis)),
            0.0,
            1.0,
        )
        events[name] = {"frameIndex": fi, "t": float(times[fi]), "confidence": conf}

    keyframe_indices = sorted({events[name]["frameIndex"] for name in EVENT_ORDER})
    return SwingEvents(
        events=events,
        keyframe_indices=keyframe_indices,
        detection_confidence=detection_conf,
    )
