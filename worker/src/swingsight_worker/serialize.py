"""Canonical serialisation of the measurement layer.

This is the object the determinism contract is asserted over: the same clip must
serialise to byte-identical JSON across runs. Playback/keyframe IMAGE bytes are
deliberately excluded (they are images, not the measurement) — everything that drives
the report's numbers and overlay is included: keypoints, events, metrics, fault gates,
primary fault, score and the quality report.

Stable by construction: sorted keys, compact separators, ASCII, and every float was
already quantised by the pipeline (see determinism.q).
"""

from __future__ import annotations

import json

from .pipeline.types import MeasurementResult


def measurement_payload(result: MeasurementResult) -> dict:
    return {
        "status": result.status,
        "faultLibraryVersion": result.fault_library_version,
        "keypointsMeta": result.keypoints_meta,
        "events": result.events,
        "keyframeIndices": result.keyframe_indices,
        "metrics": result.metrics,
        "faults": result.faults,
        "primaryFaultId": result.primary_fault_id,
        "observationFaultId": result.observation_fault_id,
        "score": result.score,
        "quality": result.quality,
        "keypointFrames": result.keypoint_frames,
    }


def measurement_json(result: MeasurementResult) -> str:
    return json.dumps(
        measurement_payload(result),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
