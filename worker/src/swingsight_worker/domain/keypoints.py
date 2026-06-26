"""BlazePose-33 topology + the single-source handedness lead/trail map.

Mirrors app/src/domain/keypoints.ts exactly. A wrong map here highlights the wrong
arm on the user's own video — the most visible failure mode — so the lead/trail
decision is encoded in exactly one place (`lead_is_left`) and used everywhere.
"""

from __future__ import annotations

from typing import Literal

Handedness = Literal["RH", "LH"]

# BlazePose 33-landmark indices (mirror of the BlazePose const in keypoints.ts).
NOSE = 0
LEFT_EYE_INNER = 1
LEFT_EYE = 2
LEFT_EYE_OUTER = 3
RIGHT_EYE_INNER = 4
RIGHT_EYE = 5
RIGHT_EYE_OUTER = 6
LEFT_EAR = 7
RIGHT_EAR = 8
MOUTH_LEFT = 9
MOUTH_RIGHT = 10
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_PINKY = 17
RIGHT_PINKY = 18
LEFT_INDEX = 19
RIGHT_INDEX = 20
LEFT_THUMB = 21
RIGHT_THUMB = 22
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_KNEE = 25
RIGHT_KNEE = 26
LEFT_ANKLE = 27
RIGHT_ANKLE = 28
LEFT_HEEL = 29
RIGHT_HEEL = 30
LEFT_FOOT_INDEX = 31
RIGHT_FOOT_INDEX = 32

BLAZEPOSE_LANDMARK_COUNT = 33

# Curated stick-figure connections (mirror SKELETON_EDGES in keypoints.ts). Used by
# the keyframe-annotation drawing so the JPEGs match the app's overlay topology.
SKELETON_EDGES: tuple[tuple[int, int], ...] = (
    (LEFT_SHOULDER, RIGHT_SHOULDER),
    (LEFT_SHOULDER, LEFT_HIP),
    (RIGHT_SHOULDER, RIGHT_HIP),
    (LEFT_HIP, RIGHT_HIP),
    (LEFT_SHOULDER, LEFT_ELBOW),
    (LEFT_ELBOW, LEFT_WRIST),
    (RIGHT_SHOULDER, RIGHT_ELBOW),
    (RIGHT_ELBOW, RIGHT_WRIST),
    (LEFT_HIP, LEFT_KNEE),
    (LEFT_KNEE, LEFT_ANKLE),
    (LEFT_ANKLE, LEFT_FOOT_INDEX),
    (RIGHT_HIP, RIGHT_KNEE),
    (RIGHT_KNEE, RIGHT_ANKLE),
    (RIGHT_ANKLE, RIGHT_FOOT_INDEX),
    (NOSE, LEFT_SHOULDER),
    (NOSE, RIGHT_SHOULDER),
)

# Logical joint refs (mirror SkeletonJointRef). Resolved to concrete indices below.
SkeletonJointRef = Literal[
    "lead_shoulder",
    "lead_elbow",
    "lead_wrist",
    "lead_hip",
    "lead_knee",
    "lead_ankle",
    "trail_shoulder",
    "trail_elbow",
    "trail_wrist",
    "trail_hip",
    "trail_knee",
    "trail_ankle",
    "head",
    "pelvis_mid",
    "shoulder_mid",
]


def lead_is_left(handedness: Handedness) -> bool:
    """For a right-handed golfer the LEAD side is the LEFT body side; for a
    left-hander it is the RIGHT. The only place this decision is encoded."""
    return handedness == "RH"


def joint_ref_to_index(ref: SkeletonJointRef, handedness: Handedness) -> int:
    """Single-landmark logical ref -> concrete BlazePose index (mirror of
    jointRefToIndex). Midpoint refs default to a sensible anchor; callers that
    need the true midpoint use MIDPOINT_REFS."""
    lead_left = lead_is_left(handedness)
    table: dict[str, int] = {
        "lead_shoulder": LEFT_SHOULDER if lead_left else RIGHT_SHOULDER,
        "trail_shoulder": RIGHT_SHOULDER if lead_left else LEFT_SHOULDER,
        "lead_elbow": LEFT_ELBOW if lead_left else RIGHT_ELBOW,
        "trail_elbow": RIGHT_ELBOW if lead_left else LEFT_ELBOW,
        "lead_wrist": LEFT_WRIST if lead_left else RIGHT_WRIST,
        "trail_wrist": RIGHT_WRIST if lead_left else LEFT_WRIST,
        "lead_hip": LEFT_HIP if lead_left else RIGHT_HIP,
        "trail_hip": RIGHT_HIP if lead_left else LEFT_HIP,
        "lead_knee": LEFT_KNEE if lead_left else RIGHT_KNEE,
        "trail_knee": RIGHT_KNEE if lead_left else LEFT_KNEE,
        "lead_ankle": LEFT_ANKLE if lead_left else RIGHT_ANKLE,
        "trail_ankle": RIGHT_ANKLE if lead_left else LEFT_ANKLE,
        "head": NOSE,
        "pelvis_mid": LEFT_HIP,
        "shoulder_mid": LEFT_SHOULDER,
    }
    return table[ref]


# Midpoint refs that must be synthesised from two landmarks (mirror MIDPOINT_REFS).
MIDPOINT_REFS: dict[str, tuple[int, int]] = {
    "pelvis_mid": (LEFT_HIP, RIGHT_HIP),
    "shoulder_mid": (LEFT_SHOULDER, RIGHT_SHOULDER),
}
