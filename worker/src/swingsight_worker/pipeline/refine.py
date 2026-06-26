"""Blur refinement (spec §8 step 6; PRD Phase 3 item 4).

Raw BlazePose keypoints jump off their smooth physical path on motion-blurred frames
(the downswing/impact, exactly where the chicken-wing highlight lives). We correct
that deterministically, in this fixed order:

  1. Left/right inversion fix — when the arms cross, the model can swap L/R limbs.
     Per frame, if swapping the L/R arm landmarks better matches the previous frame's
     trajectory, swap them. (GolfMate's inversion detector.)
  2. Spike rejection — replace single-frame outliers that depart from the linear
     interpolation of their neighbours by more than a generous threshold AND jump
     both in and back out. Generous so genuine fast motion (consistent direction)
     is untouched.
  3. Savitzky-Golay smoothing — a short window that removes jitter while preserving
     the peaks of the downswing (unlike a moving average, which would flatten tempo).

Tuning law (spec §8.7): kill outliers and jitter, NOT the real movement. Visibility
is never smoothed. World (2.5D) landmarks are left raw — launch metrics are 2D.
"""

from __future__ import annotations

import logging

import numpy as np

from ..domain import keypoints as K
from .types import PoseSeries

logger = logging.getLogger("swingsight.worker.refine")

# L/R landmark pairs that can get swapped when the arms cross.
_ARM_PAIRS: tuple[tuple[int, int], ...] = (
    (K.LEFT_ELBOW, K.RIGHT_ELBOW),
    (K.LEFT_WRIST, K.RIGHT_WRIST),
    (K.LEFT_PINKY, K.RIGHT_PINKY),
    (K.LEFT_INDEX, K.RIGHT_INDEX),
    (K.LEFT_THUMB, K.RIGHT_THUMB),
)

_SPIKE_TAU = 0.06  # normalised; a blip must depart >6% of the frame to be rejected
_SAVGOL_WINDOW = 7
_SAVGOL_POLY = 2


def _fix_inversions(xy: np.ndarray, detected: np.ndarray) -> int:
    """Greedy forward L/R de-swap on the arm landmarks. Returns #frames swapped."""
    swaps = 0
    last_valid: int | None = None
    for t in range(xy.shape[0]):
        if not detected[t]:
            continue
        if last_valid is None:
            last_valid = t
            continue
        prev = xy[last_valid]
        cur = xy[t]
        for li, ri in _ARM_PAIRS:
            straight = np.linalg.norm(cur[li] - prev[li]) + np.linalg.norm(cur[ri] - prev[ri])
            swapped = np.linalg.norm(cur[ri] - prev[li]) + np.linalg.norm(cur[li] - prev[ri])
            if swapped + 1e-9 < straight:
                cur[[li, ri]] = cur[[ri, li]]
                swaps += 1
        last_valid = t
    return swaps


def _reject_spikes(xy: np.ndarray, detected: np.ndarray) -> int:
    """Replace single-frame outliers with the neighbour interpolation."""
    fixed = 0
    n = xy.shape[0]
    for j in range(xy.shape[1]):
        for t in range(1, n - 1):
            if not (detected[t - 1] and detected[t] and detected[t + 1]):
                continue
            p0, p1, p2 = xy[t - 1, j], xy[t, j], xy[t + 1, j]
            interp = 0.5 * (p0 + p2)
            if (
                np.linalg.norm(p1 - interp) > _SPIKE_TAU
                and np.linalg.norm(p1 - p0) > _SPIKE_TAU
                and np.linalg.norm(p1 - p2) > _SPIKE_TAU
            ):
                xy[t, j] = interp
                fixed += 1
    return fixed


def _smooth(xy: np.ndarray) -> np.ndarray:
    from scipy.signal import savgol_filter

    n = xy.shape[0]
    window = _SAVGOL_WINDOW
    if n <= window or n <= _SAVGOL_POLY:
        return xy
    if window % 2 == 0:
        window += 1
    out = xy.copy()
    out[:, :, 0] = savgol_filter(xy[:, :, 0], window, _SAVGOL_POLY, axis=0)
    out[:, :, 1] = savgol_filter(xy[:, :, 1], window, _SAVGOL_POLY, axis=0)
    return out


def refine(pose: PoseSeries) -> tuple[PoseSeries, dict]:
    """Return a refined copy of the pose series + a small diagnostics dict."""
    xy = pose.image[:, :, :2].copy()  # (T,33,2)
    detected = pose.detected

    swaps = _fix_inversions(xy, detected)
    spikes = _reject_spikes(xy, detected)
    smoothed = _smooth(xy)

    refined_image = pose.image.copy()
    refined_image[:, :, :2] = smoothed  # visibility channel (index 2) untouched

    # Wrist-distance sanity: the two hands grip one club. A large mean separation on
    # frames where both are visible signals a noisy detection — surfaced as a
    # confidence input, never used to fabricate motion.
    both_vis = (pose.image[:, K.LEFT_WRIST, 2] > 0.3) & (pose.image[:, K.RIGHT_WRIST, 2] > 0.3)
    if both_vis.any():
        wrist_sep = float(
            np.median(
                np.linalg.norm(
                    refined_image[both_vis, K.LEFT_WRIST, :2]
                    - refined_image[both_vis, K.RIGHT_WRIST, :2],
                    axis=1,
                )
            )
        )
    else:
        wrist_sep = 0.0

    diagnostics = {
        "inversion_swaps": swaps,
        "spikes_fixed": spikes,
        "median_wrist_separation": wrist_sep,
    }
    logger.info(
        "refine: %d inversion swaps, %d spikes fixed, median wrist sep %.3f",
        swaps,
        spikes,
        wrist_sep,
    )
    refined = PoseSeries(
        image=refined_image,
        world=pose.world,
        detected=pose.detected,
        core_visibility=pose.core_visibility,
    )
    return refined, diagnostics
