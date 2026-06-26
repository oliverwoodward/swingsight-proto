"""The deterministic measurement core (spec §8 step 10; PRD Phase 3 item 10).

`run_measurement` runs the whole measurement layer — ingest → pose → refine → events
→ quality gate → metrics → faults → score — and assembles the contract-shaped
MeasurementResult (camelCase, mirroring app/src/domain/types.ts). It performs NO IO
(no R2, no Supabase): it is a pure function of the playback clip bytes + view +
handedness, which is what makes determinism testable in isolation. main.py wraps it
with download/transcode/upload/write-back; run_local.py wraps it for the checkpoint.

If the quality gate trips, the result is `unreadable` with only the QualityReport —
no metrics, faults or score are fabricated.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np

from ..determinism import (
    COORD_DECIMALS,
    TIME_DECIMALS,
    q,
)
from ..domain.fault_library import FAULT_LIBRARY_VERSION
from . import detect_events, faults, ingest, metrics, pose, quality, refine, score
from .types import MeasurementResult, NormalizedClip, PoseSeries, SwingEvents

logger = logging.getLogger("swingsight.worker.assemble")


@dataclass
class PipelineRun:
    """Measurement result + the artefacts main.py needs for keyframe rendering."""

    result: MeasurementResult
    clip: NormalizedClip
    pose: PoseSeries  # refined
    events: Optional[SwingEvents]


def _keypoint_frames(refined: PoseSeries, clip: NormalizedClip) -> list[dict]:
    frames: list[dict] = []
    for i in range(clip.num_frames):
        landmarks = []
        for j in range(refined.image.shape[1]):
            x = float(np.clip(refined.image[i, j, 0], 0.0, 1.0))
            y = float(np.clip(refined.image[i, j, 1], 0.0, 1.0))
            v = float(np.clip(refined.image[i, j, 2], 0.0, 1.0))
            landmarks.append(
                {"x": q(x, COORD_DECIMALS), "y": q(y, COORD_DECIMALS), "visibility": q(v, COORD_DECIMALS)}
            )
        frames.append({"t": q(float(clip.timestamps[i]), TIME_DECIMALS), "landmarks": landmarks})
    return frames


def _events_list(events: SwingEvents) -> list[dict]:
    from .detect_events import EVENT_ORDER

    out = []
    for name in EVENT_ORDER:
        e = events.events[name]
        out.append(
            {
                "name": name,
                "frameIndex": int(e["frameIndex"]),
                "t": q(float(e["t"]), TIME_DECIMALS),
                "confidence": q(float(e["confidence"]), COORD_DECIMALS),
            }
        )
    return out


def _kept_fps(clip: NormalizedClip) -> float:
    n = clip.num_frames
    span = float(clip.timestamps[-1]) if n > 1 else 0.0
    return (n - 1) / span if span > 0 else float(clip.target_fps)


def run_measurement(
    playback_path: str,
    playback_width: int,
    playback_height: int,
    view: str,
    handedness: str,
    target_fps: int,
    pose_height: int,
    model_complexity: int,
    model_dir: str,
) -> PipelineRun:
    clip = ingest.load_normalized(
        playback_path, playback_width, playback_height, target_fps, pose_height
    )
    raw_pose = pose.estimate_pose(clip, model_complexity, model_dir)
    refined, _diag = refine.refine(raw_pose)
    events = detect_events.detect_events(refined, clip)

    quality_report = quality.assess_quality(refined, clip, events)
    if not quality_report["ok"]:
        result = MeasurementResult(
            status="unreadable",
            quality=quality_report,
            fault_library_version=FAULT_LIBRARY_VERSION,
        )
        return PipelineRun(result=result, clip=clip, pose=refined, events=events)

    metric_list, engine_conf = metrics.compute_metrics(refined, clip, events, view, handedness)
    fault_list, primary_id = faults.evaluate_faults(
        metric_list, engine_conf, refined, events, view, handedness
    )
    swing_score = score.compute_score(metric_list, engine_conf, events)

    keypoints_meta = {
        "topology": "blazepose33",
        "videoWidth": int(clip.playback_width),
        "videoHeight": int(clip.playback_height),
        "fps": q(_kept_fps(clip), 2),
    }

    result = MeasurementResult(
        status="complete",
        keypoints_meta=keypoints_meta,
        keypoint_frames=_keypoint_frames(refined, clip),
        events=_events_list(events),
        keyframe_indices=list(events.keyframe_indices),
        metrics=metric_list,
        faults=fault_list,
        primary_fault_id=primary_id,
        score=swing_score,
        quality=quality_report,
        fault_library_version=FAULT_LIBRARY_VERSION,
    )
    logger.info(
        "assemble: status=complete, %d frames, %d metrics, %d faults, primary=%s, score=%s",
        clip.num_frames, len(metric_list), len(fault_list), primary_id,
        swing_score.get("value") if not swing_score.get("withheld") else "withheld",
    )
    return PipelineRun(result=result, clip=clip, pose=refined, events=events)
