"""Convenience landmark groupings derived from the domain BlazePose topology.

Kept here (not in the domain mirror) because these are worker-internal analysis
helpers, not part of the shared contract.
"""

from __future__ import annotations

from ..domain import keypoints as K

# Body-core landmarks used to judge "is a usable person in frame" and to weight
# per-frame visibility. Face detail and extremities are excluded.
CORE_LANDMARKS: tuple[int, ...] = (
    K.LEFT_SHOULDER,
    K.RIGHT_SHOULDER,
    K.LEFT_ELBOW,
    K.RIGHT_ELBOW,
    K.LEFT_WRIST,
    K.RIGHT_WRIST,
    K.LEFT_HIP,
    K.RIGHT_HIP,
    K.NOSE,
)

# Landmarks whose presence proves the WHOLE body is in frame (partial-body gate):
# shoulders + hips + knees + ankles. Missing lower body => framing cut the legs off.
FULL_BODY_LANDMARKS: tuple[int, ...] = (
    K.LEFT_SHOULDER,
    K.RIGHT_SHOULDER,
    K.LEFT_HIP,
    K.RIGHT_HIP,
    K.LEFT_KNEE,
    K.RIGHT_KNEE,
    K.LEFT_ANKLE,
    K.RIGHT_ANKLE,
)

# The two hands grip the same club; their image distance bounds plausibility and is
# used by the inversion / wrist-distance sanity checks in refine.py.
LEFT_WRIST = K.LEFT_WRIST
RIGHT_WRIST = K.RIGHT_WRIST


# --- Visibility calibration --------------------------------------------------
# Raw BlazePose `visibility` is NOT a [0,1] probability: a clearly-seen joint
# typically reads ≈0.5, not ≈1.0. Feeding that raw value into a confidence product
# (engine_conf, per-event conf, the fault driving-vis gate) treats "clearly present"
# as "half-confident", so a cleanly-filmed swing lands just under the 0.5 confidence
# gate and every metric blanks. `calibrate_visibility` remaps the raw value onto a
# calibrated [0,1] confidence: at/above CEIL the joint is "clearly present" (reads
# high), at/below FLOOR it is effectively unseen (reads ≈0), linear in between.
#
# This is a WORKER-INTERNAL confidence calibration, NOT a domain-mirror formula — the
# app reads the resulting `confidence`/`status` as opaque values and only compares to
# the shared LOW_CONFIDENCE = 0.5 gate (unchanged). It is applied ONLY where raw
# visibility feeds a confidence decision; the quality/"unreadable" gates and the
# overlay's per-frame brightness thresholds keep reading the RAW visibility, so the
# hard re-record floor and the skeleton rendering are untouched.
VIS_CAL_FLOOR = 0.15  # raw visibility at/below which a joint counts as unseen
VIS_CAL_CEIL = 0.55  # raw visibility at/above which a joint is "clearly present"


def calibrate_visibility(v: float) -> float:
    """Remap raw BlazePose visibility onto a calibrated [0,1] confidence.
    0.5 raw -> ~0.875, 0.3 -> ~0.375, <=0.15 -> 0, >=0.55 -> 1."""
    return max(0.0, min(1.0, (v - VIS_CAL_FLOOR) / (VIS_CAL_CEIL - VIS_CAL_FLOOR)))
