"""Keyframe rendering (spec §8 step 10 — the downsized annotated JPEGs).

For each detected event we render its frame with the CV skeleton drawn on (the
"annotated-frames" technique the Phase-5 AI call relies on, and the report's event
bookmarks). One JPEG per event so swing_keyframes stays one row per event_name.

Drawing is deterministic (fixed colours, libjpeg) but keyframe BYTES are not part of
the measurement-layer determinism contract — only the measurement JSON is.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from ..determinism import TIME_DECIMALS, configure_opencv_single_thread, q
from ..domain import keypoints as K
from .detect_events import EVENT_ORDER
from .types import NormalizedClip, PoseSeries, SwingEvents

logger = logging.getLogger("swingsight.worker.keyframes")

_EDGE_COLOR = (60, 220, 120)  # BGR — green skeleton
_JOINT_COLOR = (80, 160, 255)  # BGR — amber joints
_VIS_MIN = 0.2
_JPEG_QUALITY = 80


@dataclass
class RenderedKeyframe:
    event_name: str
    frame_index: int
    t: float
    confidence: float
    jpeg: bytes


def _draw(frame_rgb: np.ndarray, landmarks: np.ndarray) -> bytes:
    import cv2

    configure_opencv_single_thread()
    img = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    h, w = img.shape[:2]
    pts = (landmarks[:, :2] * np.array([w, h])).astype(np.int32)
    vis = landmarks[:, 2]
    for a, b in K.SKELETON_EDGES:
        if vis[a] > _VIS_MIN and vis[b] > _VIS_MIN:
            cv2.line(img, tuple(pts[a]), tuple(pts[b]), _EDGE_COLOR, 2, cv2.LINE_AA)
    for a, b in K.SKELETON_EDGES:
        for j in (a, b):
            if vis[j] > _VIS_MIN:
                cv2.circle(img, tuple(pts[j]), 3, _JOINT_COLOR, -1, cv2.LINE_AA)
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), _JPEG_QUALITY])
    if not ok:
        raise RuntimeError("failed to JPEG-encode keyframe")
    return buf.tobytes()


def render_keyframes(
    clip: NormalizedClip, refined: PoseSeries, events: SwingEvents
) -> list[RenderedKeyframe]:
    out: list[RenderedKeyframe] = []
    for name in EVENT_ORDER:
        e = events.events[name]
        fi = int(np.clip(e["frameIndex"], 0, clip.num_frames - 1))
        jpeg = _draw(clip.frames[fi], refined.image[fi])
        out.append(
            RenderedKeyframe(
                event_name=name,
                frame_index=fi,
                t=q(float(e["t"]), TIME_DECIMALS),
                confidence=q(float(e["confidence"]), 4),
                jpeg=jpeg,
            )
        )
    logger.info("keyframes: rendered %d annotated event frames", len(out))
    return out
