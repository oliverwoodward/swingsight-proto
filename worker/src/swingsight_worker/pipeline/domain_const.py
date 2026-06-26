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
