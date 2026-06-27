"""Internal data carriers passed between pipeline stages.

These are worker-internal (numpy-backed) and never serialised as-is. The public,
contract-shaped result is built by assemble.py, which mirrors domain/types.ts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class NormalizedClip:
    """The deterministic, normalised frame set the rest of the pipeline measures.

    `frames` are RGB ndarrays at the working (pose) resolution; `timestamps` are the
    REAL seconds-from-start of each frame (from container PTS), so tempo/timing are
    computed from true time even when the source is VFR. `playback_width/height` are
    the dimensions the normalised [0,1] keypoints map onto in the report (the
    playback clip), used by the app's contain-fit overlay math.
    """

    frames: list[np.ndarray]
    timestamps: np.ndarray  # (T,) float seconds from clip start
    source_fps: float
    target_fps: int
    playback_width: int
    playback_height: int
    # 1.0 when the clip was at/above the target rate; < 1.0 when processed sub-60fps.
    normalization_confidence: float
    fps_note: str

    @property
    def num_frames(self) -> int:
        return len(self.frames)


@dataclass
class PoseSeries:
    """Per-frame BlazePose output. Image landmarks are normalised [0,1] (overlay);
    world landmarks are 2.5D metres relative to the hips (orientation/phase only,
    never shown as measured angles)."""

    image: np.ndarray  # (T, 33, 3) -> x, y, visibility  (normalised image space)
    world: np.ndarray  # (T, 33, 3) -> x, y, z metres (2.5D)
    detected: np.ndarray  # (T,) bool — a pose was found this frame
    # Mean visibility of the body-core landmarks per frame, (T,), in [0,1].
    core_visibility: np.ndarray


@dataclass
class SwingEvents:
    """The 8 detected events. `frame_index` indexes the NormalizedClip frames;
    `t` is real seconds; `confidence` is event-localisation confidence."""

    # name -> {"frameIndex": int, "t": float, "confidence": float}
    events: dict[str, dict]
    # The 6–8 frame indices chosen as key frames (a subset/all of the 8 events).
    keyframe_indices: list[int]
    # Overall event-detection confidence in [0,1].
    detection_confidence: float


@dataclass
class MeasurementResult:
    """Everything the deterministic measurement layer produces, in contract shape
    (camelCase dicts). assemble.py builds this; main.py persists it. Determinism is
    asserted over the JSON of this object (excluding the playback bytes)."""

    status: str  # 'complete' | 'unreadable' | 'failed'
    keypoints_meta: Optional[dict] = None
    keypoint_frames: list[dict] = field(default_factory=list)  # KeypointFrame[]
    events: list[dict] = field(default_factory=list)  # SwingEvent[]
    keyframe_indices: list[int] = field(default_factory=list)
    metrics: list[dict] = field(default_factory=list)  # Metric[]
    faults: list[dict] = field(default_factory=list)  # FaultEvaluation[]
    primary_fault_id: Optional[str] = None
    # Top fired soft_only fault when there is no claim-eligible primary — a tentative
    # observation the coaching layer may hedge on, never a verdict.
    observation_fault_id: Optional[str] = None
    score: Optional[dict] = None  # SwingScore
    quality: dict = field(default_factory=dict)  # QualityReport
    fault_library_version: str = ""
    error_reason: Optional[str] = None
