"""Fault detection + gating (spec §8 step 8; PRD Phase 3 item 7).

For each library fault valid in this view, evaluate its deterministic gate against the
measured metric using the SAME logic as domain/gating.ts (evaluate_gate / severity_band
/ pick_primary_fault), then confidence-gate it on the visibility of its driving joints
across its phase window. The result is a FaultEvaluation per fault and a primary fault
id — the only fault the AI (Phase 5) will be allowed to select.

A gate that fires but whose driving joints are poorly seen is recorded as fired (the
app can still reason about it) but marked low-confidence so it cannot become primary —
this is "do not draw a crisp line on uncertain points" enforced at the measurement
layer, not the UI.
"""

from __future__ import annotations

import logging

import numpy as np

from ..determinism import CONF_DECIMALS, MAGNITUDE_DECIMALS, q
from ..domain import keypoints as K
from ..domain.fault_library import FAULT_LIBRARY, find_fault
from ..domain.gating import (
    LOW_CONFIDENCE,
    evaluate_gate,
    pick_primary_fault,
    severity_band,
)
from .types import PoseSeries, SwingEvents

logger = logging.getLogger("swingsight.worker.faults")


def _resolved_indices(ref: str, handedness: str) -> list[int]:
    if ref in K.MIDPOINT_REFS:
        a, b = K.MIDPOINT_REFS[ref]
        return [a, b]
    return [K.joint_ref_to_index(ref, handedness)]


def _driving_joint_visibility(
    pose: PoseSeries, joints: tuple[str, ...], handedness: str, lo: int, hi: int
) -> float:
    frames = range(max(0, lo), min(pose.image.shape[0], hi + 1))
    vals: list[float] = []
    for ref in joints:
        for idx in _resolved_indices(ref, handedness):
            for f in frames:
                vals.append(float(pose.image[f, idx, 2]))
    return float(np.mean(vals)) if vals else 0.0


def evaluate_faults(
    metrics: list[dict],
    engine_conf: dict[str, float],
    pose: PoseSeries,
    events: SwingEvents,
    view: str,
    handedness: str,
) -> tuple[list[dict], str | None]:
    by_key = {m["key"]: m for m in metrics}
    evaluations: list[dict] = []

    for entry in FAULT_LIBRARY:
        if view not in entry.views:
            continue
        metric = by_key.get(entry.gate.metric_key)
        if metric is None:
            continue  # metric not measurable in this view

        value = float(metric["value"])
        fired, magnitude = evaluate_gate(value, entry.gate)

        start = entry.highlight.phase_window["start"]
        end = entry.highlight.phase_window["end"]
        sf = events.events[start]["frameIndex"]
        ef = events.events[end]["frameIndex"]
        lo, hi = min(sf, ef), max(sf, ef)

        driving_vis = _driving_joint_visibility(pose, entry.highlight.joints, handedness, lo, hi)
        metric_conf = engine_conf.get(entry.gate.metric_key, metric["confidence"])
        confidence = max(0.0, min(1.0, min(metric_conf, driving_vis)))

        status = metric["status"]
        if driving_vis < entry.gate.min_keypoint_confidence:
            # Highlight joints not seen well enough to trust the gate → cannot be primary.
            status = "low_confidence"
            confidence = min(confidence, LOW_CONFIDENCE - 1e-6)

        evaluations.append(
            {
                "faultId": entry.id,
                "metricKey": entry.gate.metric_key,
                "value": metric["value"],
                "fired": bool(fired),
                "magnitude": q(magnitude, MAGNITUDE_DECIMALS),
                "severityBand": severity_band(magnitude) if fired else "none",
                "confidence": q(confidence, CONF_DECIMALS),
                "status": status,
                # The validation gate (spec §13.1): only claim-eligible faults may become
                # the primary claim / an LLM open gate. soft_only faults are recorded here
                # for transparency but filtered out by pick_primary_fault + coaching.
                "claimEligible": bool(entry.validation.drives_claim),
                "frameWindow": {"startFrame": int(lo), "endFrame": int(hi)},
            }
        )

    def severity_weight_of(fault_id: str) -> float:
        entry = find_fault(fault_id)
        return entry.severity_weight if entry else 0.0

    primary = pick_primary_fault(evaluations, severity_weight_of)
    primary_id = primary["faultId"] if primary else None
    logger.info(
        "faults: %d evaluated, %d fired, primary=%s",
        len(evaluations),
        sum(1 for e in evaluations if e["fired"]),
        primary_id,
    )
    return evaluations, primary_id
