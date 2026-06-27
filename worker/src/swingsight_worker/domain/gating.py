"""Deterministic fault gating — the SAME logic as app/src/domain/gating.ts.

A gate either opens or it does not; severity is a band, not a judgement. The AI may
only ever select a fault whose gate is open. The app reasons about gates with the TS
version of this file; the worker is the source of truth that writes the
FaultEvaluation. They must agree, so every formula here mirrors gating.ts exactly —
do not "improve" one side without the other.
"""

from __future__ import annotations

import math
from typing import Callable, Literal, Optional

from .fault_library import FaultGate, MetricMeta

# Confidence below this withholds a fault / softens the score (mirror LOW_CONFIDENCE).
LOW_CONFIDENCE = 0.5

MetricStatus = Literal["ok", "unmeasurable_view", "low_confidence", "implausible"]
SeverityBand = Literal["none", "mild", "moderate", "strong"]


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def assess_metric_status(value: float, meta: MetricMeta) -> MetricStatus:
    """Is a measured value physically plausible for its metric? (mirror)."""
    if math.isnan(value):
        return "implausible"
    if value < meta.plausible.min or value > meta.plausible.max:
        return "implausible"
    return "ok"


def is_in_friendly_range(value: float, meta: MetricMeta) -> bool:
    return meta.friendly_range.min <= value <= meta.friendly_range.max


def evaluate_gate(value: float, gate: FaultGate) -> tuple[bool, float]:
    """Evaluate a gate against a value -> (fired, magnitude). magnitude is 0 at the
    threshold and grows past it, normalised by the threshold's own scale so different
    metrics compare. Mirror of evaluateGate (operator-for-operator)."""
    operator = gate.operator
    threshold = gate.threshold
    if operator == "exceeds":
        t = threshold.get("min", 0) or 0
        fired = value > t
        magnitude = (value - t) / max(abs(t), 1) if fired else 0.0
        return fired, magnitude
    if operator == "below":
        t = threshold.get("max", 0) or 0
        fired = value < t
        magnitude = (t - value) / max(abs(t), 1) if fired else 0.0
        return fired, magnitude
    if operator == "outside":
        lo = threshold.get("min", -math.inf)
        hi = threshold.get("max", math.inf)
        fired = value < lo or value > hi
        dist = (lo - value) if value < lo else (value - hi) if value > hi else 0.0
        scale = max(abs(lo) if lo != -math.inf else 0, abs(hi) if hi != math.inf else 0, 1)
        return fired, (dist / scale if fired else 0.0)
    if operator == "magnitude_at_least":
        t = threshold.get("value", 0) or 0
        fired = abs(value) >= t
        magnitude = (abs(value) - t) / max(t, 1) if fired else 0.0
        return fired, magnitude
    raise ValueError(f"unknown gate operator: {operator}")


def severity_band(magnitude: float) -> SeverityBand:
    """Mirror of severityBand: none/mild/moderate/strong by magnitude."""
    if magnitude <= 0:
        return "none"
    if magnitude < 0.4:
        return "mild"
    if magnitude < 1.0:
        return "moderate"
    return "strong"


def metric_confidence(engine_confidence: float, meta: MetricMeta) -> float:
    """Compose a metric's confidence from engine confidence × its reliability tier.
    Mirror of metricConfidence."""
    factor = (
        1.0
        if meta.reliability_tag == "reliable"
        else 0.7
        if meta.reliability_tag == "approximate"
        else 0.0
    )
    return clamp(engine_confidence * factor, 0.0, 1.0)


def pick_primary_fault(
    evaluations: list[dict],
    severity_weight_of: Callable[[str], float],
) -> Optional[dict]:
    """Among the evaluated faults, pick the priority fault: highest
    magnitude × severityWeight among gates that fired with adequate confidence, an 'ok'
    status, AND claim-eligible (the validation gate — spec §13.1; a fired-but-soft_only
    fault is recorded but never the primary claim). Returns None when nothing clears the
    bar. Mirror of pickPrimaryFault (the worker writes the result; the app reasons
    identically)."""
    eligible = [
        e
        for e in evaluations
        if e["fired"]
        and e["confidence"] >= LOW_CONFIDENCE
        and e["status"] == "ok"
        and e.get("claimEligible", True)
    ]
    if not eligible:
        return None
    best = eligible[0]
    best_score = best["magnitude"] * severity_weight_of(best["faultId"])
    for e in eligible[1:]:
        score = e["magnitude"] * severity_weight_of(e["faultId"])
        if score > best_score:
            best, best_score = e, score
    return best


def pick_observation_fault(
    evaluations: list[dict],
    severity_weight_of: Callable[[str], float],
) -> Optional[dict]:
    """Among the evaluated faults, pick the top TENTATIVE observation: same
    magnitude × severityWeight ranking as pick_primary_fault, but the INVERSE claim
    filter — a fired, adequately-confident, plausible fault that is NOT claim-eligible
    (a soft_only proxy). This is what the coaching layer may hedge on when no
    claim-eligible primary cleared the bar; it is never the primary claim. Returns None
    when nothing qualifies. Mirror of pickObservationFault."""
    eligible = [
        e
        for e in evaluations
        if e["fired"]
        and e["confidence"] >= LOW_CONFIDENCE
        and e["status"] == "ok"
        and not e.get("claimEligible", True)
    ]
    if not eligible:
        return None
    best = eligible[0]
    best_score = best["magnitude"] * severity_weight_of(best["faultId"])
    for e in eligible[1:]:
        score = e["magnitude"] * severity_weight_of(e["faultId"])
        if score > best_score:
            best, best_score = e, score
    return best
