"""Deterministic swing score (spec §2 rule 3; PRD Phase 3 item 8).

A 0–100 score computed ONLY from the measured metrics — never the LLM (an LLM score
drifts between calls; that inconsistency is a documented trust-killer). Each scoreable
metric contributes a signed push around a neutral 50 based on how close it sits to its
friendly range, weighted by its reliability tier × measurement confidence. The whole
score is confidence-gated: when the weighted confidence is low (poor visibility, bad
fps) or too few metrics are usable, it is withheld so the UI softens/hides the number
and leads with the fault + drill instead.

Same metrics in → same score out. The contributions power the "tap to see why" view.
"""

from __future__ import annotations

import logging

from ..determinism import q
from ..domain.fault_library import METRIC_META
from ..domain.gating import LOW_CONFIDENCE, metric_confidence
from .types import SwingEvents

logger = logging.getLogger("swingsight.worker.score")

_MIN_SCOREABLE = 3


def _goodness(value: float, meta) -> float:
    """How close to ideal, in [0,1]; 1.0 inside the friendly range, decaying as the
    value departs it by up to one range-width."""
    lo, hi = meta.friendly_range.min, meta.friendly_range.max
    span = max(hi - lo, 1e-6)
    if meta.better_direction == "lower":
        d = max(0.0, value - hi)
    elif meta.better_direction == "higher":
        d = max(0.0, lo - value)
    else:  # target
        d = (lo - value) if value < lo else (value - hi) if value > hi else 0.0
    return max(0.0, min(1.0, 1.0 - d / span))


def compute_score(
    metrics: list[dict], engine_conf: dict[str, float], events: SwingEvents
) -> dict:
    contributions: list[dict] = []
    weighted_g = 0.0
    weighted_conf = 0.0
    total_w = 0.0
    scoreable = 0

    for m in metrics:
        if m["status"] != "ok":
            continue
        # Score only from RELIABLE-tier metrics. Approximate 2D projections (turn,
        # X-factor, plane) are soft indicators shown as ranges (spec §15) — they must
        # not move the headline number, and a degenerate projection must not tank it.
        if m["reliabilityTag"] != "reliable":
            continue
        meta = METRIC_META[m["key"]]
        conf = engine_conf.get(m["key"], m["confidence"])
        w = metric_confidence(conf, meta)  # reliability tier × confidence
        if w <= 0:
            continue
        g = _goodness(float(m["value"]), meta)
        weighted_g += w * g
        weighted_conf += w * conf
        total_w += w
        scoreable += 1
        # Signed points around the neutral 50 (sum of points = value - 50).
        contributions.append(
            {"metricKey": m["key"], "label": m["label"], "_w": w, "_g": g}
        )

    if total_w <= 0 or scoreable < _MIN_SCOREABLE:
        logger.info("score: withheld (scoreable=%d, total_w=%.3f)", scoreable, total_w)
        return {
            "value": 50,
            "confidence": 0.0,
            "withheld": True,
            "contributions": [],
        }

    value = 100.0 * (weighted_g / total_w)
    confidence = weighted_conf / total_w
    withheld = confidence < LOW_CONFIDENCE

    final_contribs = []
    for c in contributions:
        w_norm = c["_w"] / total_w
        points = w_norm * (c["_g"] * 100.0 - 50.0)
        final_contribs.append(
            {"metricKey": c["metricKey"], "label": c["label"], "points": q(points, 2)}
        )
    final_contribs.sort(key=lambda c: abs(c["points"]), reverse=True)

    logger.info(
        "score: %.1f (confidence %.2f, withheld=%s, %d metrics)",
        value, confidence, withheld, scoreable,
    )
    return {
        "value": int(round(value)),
        "confidence": q(confidence, 4),
        "withheld": bool(withheld),
        "contributions": final_contribs,
    }
