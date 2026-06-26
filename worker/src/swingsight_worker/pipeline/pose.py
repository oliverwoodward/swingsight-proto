"""Pose estimation — MediaPipe BlazePose via the Tasks API (spec §8 step 3;
PRD Phase 3 item 3).

Emits per-frame 2D image landmarks (normalised, for the overlay), 2.5D world
landmarks (orientation/phase only — never shown as measured angles), and per-landmark
visibility. BlazePose is Apache-2.0, 33 landmarks including the wrists golf needs.

We use the Tasks `PoseLandmarker` (the supported, cross-platform API; the legacy
`solutions` module is absent from current wheels) in IMAGE running mode — every frame
is detected independently with NO cross-frame tracking state, so the series is
reproducible and free of tracking drift. Our own deterministic smoothing (refine.py)
supplies temporal coherence. CPU only, single-threaded (see determinism.py).

The `.task` model is bundled in the image (download at build time) and referenced by
path — no network at runtime. Model size maps from `model_complexity`:
0=Lite, 1=Full (default, fits the latency budget), 2=Heavy.
"""

from __future__ import annotations

import logging
import os

import numpy as np

from ..determinism import configure_opencv_single_thread
from .domain_const import CORE_LANDMARKS
from .types import NormalizedClip, PoseSeries

logger = logging.getLogger("swingsight.worker.pose")

_LANDMARK_COUNT = 33
_MODEL_BY_COMPLEXITY = {
    0: "pose_landmarker_lite.task",
    1: "pose_landmarker_full.task",
    2: "pose_landmarker_heavy.task",
}


def resolve_model_path(model_complexity: int, model_dir: str) -> str:
    name = _MODEL_BY_COMPLEXITY.get(model_complexity, _MODEL_BY_COMPLEXITY[1])
    path = os.path.join(model_dir, name)
    if not os.path.isfile(path):
        raise RuntimeError(
            f"BlazePose model not found at {path}. Bundle it in the image / set "
            f"POSE_MODEL_DIR. Download: https://storage.googleapis.com/mediapipe-models/"
            f"pose_landmarker/{name.removesuffix('.task').replace('pose_landmarker_','pose_landmarker_')}/"
            f"float16/latest/{name}"
        )
    return path


def estimate_pose(clip: NormalizedClip, model_complexity: int, model_dir: str) -> PoseSeries:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    configure_opencv_single_thread()
    model_path = resolve_model_path(model_complexity, model_dir)

    n = clip.num_frames
    image = np.zeros((n, _LANDMARK_COUNT, 3), dtype=np.float64)
    world = np.zeros((n, _LANDMARK_COUNT, 3), dtype=np.float64)
    detected = np.zeros((n,), dtype=bool)
    core_vis = np.zeros((n,), dtype=np.float64)

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.IMAGE,  # independent per-frame → deterministic
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_segmentation_masks=False,
    )
    landmarker = vision.PoseLandmarker.create_from_options(options)
    try:
        for i, frame in enumerate(clip.frames):
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame))
            result = landmarker.detect(mp_image)
            if not result.pose_landmarks:
                continue
            detected[i] = True
            for j, lm in enumerate(result.pose_landmarks[0]):
                image[i, j, 0] = lm.x
                image[i, j, 1] = lm.y
                image[i, j, 2] = lm.visibility
            if result.pose_world_landmarks:
                for j, wlm in enumerate(result.pose_world_landmarks[0]):
                    world[i, j, 0] = wlm.x
                    world[i, j, 1] = wlm.y
                    world[i, j, 2] = wlm.z
            core_vis[i] = float(np.mean([image[i, k, 2] for k in CORE_LANDMARKS]))
    finally:
        landmarker.close()

    logger.info(
        "pose: %d/%d frames with a detected person (mean core visibility %.3f)",
        int(detected.sum()),
        n,
        float(core_vis[detected].mean()) if detected.any() else 0.0,
    )
    return PoseSeries(image=image, world=world, detected=detected, core_visibility=core_vis)
