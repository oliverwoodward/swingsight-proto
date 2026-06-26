"""Phase 6 — the drill-then-recheck loop (spec §12 Stage 9).

Governing law: **CV measures. The AI explains. The fault library localises.** The recheck
comparison is a DETERMINISTIC measured delta — the previous vs current value of the
tracked fault's gate metric — never anything the LLM produces. The LLM is not consulted
here at all; the report may word the comparison, but the number/verdict is computed from
the measurement layer.

Structurally isolated, exactly like coaching.py: this runs as a SEPARATE step in
process.py AFTER write_complete, and is NOT imported by serialize.py / assemble.py /
run_local.py. It depends on a PRIOR analysis (an external input), so folding it into the
byte-identical measurement payload would break `scripts/determinism_check.sh`. It writes
only the `drill_recheck` table.

How a recheck is decided (all deterministic):
  - The previous analysis's chosen fault is the anchor: `coaching.chosenFaultId` if a
    fault was chosen (LLM or template), else the deterministic `primary_fault_id`.
  - That fault's prescribed drill (previous `coaching.drillId`, else the fault's first
    eligible drill) names the tracked metric (every drill's `target_metric_key` IS its
    fault's `gate.metric_key`) and the direction that counts as improvement
    (`drill.improvement_direction`).
  - previousValue = the previous analysis's measured value of that metric (status `ok`).
  - currentValue  = THIS analysis's measured value of the same metric (status `ok`).
  - delta = current − previous; `improved` is direction-aware.

Never fabricates: if the prior analysis is missing / not complete / a different
profile or view, or either endpoint isn't an `ok` measurement, NOTHING is written and the
report falls back to the normal (non-recheck) view. (We compare like with like — same view
— so the metric is meaningful; the worker re-measures the current value from CV, so the
app only ever supplies the link, never a value.)
"""

from __future__ import annotations

import logging
from typing import Optional

from .domain.fault_library import DRILLS, find_fault
from .pipeline.types import MeasurementResult
from . import writeback

logger = logging.getLogger("swingsight.worker.recheck")


def _round(v: float) -> float:
    # A few decimals is plenty — both operands are already quantised by the measurement
    # layer; this just trims float subtraction noise.
    return round(float(v), 4)


def _current_ok_metric_value(result: MeasurementResult, key: str) -> Optional[float]:
    for m in result.metrics:
        if m["key"] == key and m["status"] == "ok":
            return float(m["value"])
    return None


def _previous_ok_metric_value(client, previous_analysis_id: str, key: str) -> Optional[float]:
    resp = (
        client.table("swing_metrics")
        .select("value,status")
        .eq("analysis_id", previous_analysis_id)
        .eq("metric_key", key)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows or rows[0].get("status") != "ok":
        return None
    return float(rows[0]["value"])


def _improved(delta: float, direction: str) -> bool:
    # 'decrease' -> a lower value is better; 'increase' -> higher is better.
    return delta > 0 if direction == "increase" else delta < 0


def compute_recheck(
    client,
    *,
    analysis_id: str,
    profile_id: str,
    view: str,
    result: MeasurementResult,
    previous_analysis_id: str,
) -> Optional[dict]:
    """Build the DrillRecheck row dict, or None when there's nothing honest to compare."""
    # 1. Read the previous analysis (service role; we re-verify ownership + view below).
    prev = (
        client.table("swing_analyses")
        .select("id,profile_id,view,status,primary_fault_id,coaching")
        .eq("id", previous_analysis_id)
        .limit(1)
        .execute()
    )
    prows = prev.data or []
    if not prows:
        logger.info("recheck: previous analysis %s not found -> skip", previous_analysis_id)
        return None
    prev_row = prows[0]

    # 2. Compare like with like: same owner, same view, and the prior run completed.
    if prev_row.get("status") != "complete":
        logger.info(
            "recheck: previous %s not complete (%s) -> skip",
            previous_analysis_id, prev_row.get("status"),
        )
        return None
    if prev_row.get("profile_id") != profile_id or prev_row.get("view") != view:
        logger.info("recheck: previous %s profile/view mismatch -> skip", previous_analysis_id)
        return None

    # 3. The previous chosen fault: coaching.chosenFaultId (LLM/template), else the
    #    deterministic primary. No fault flagged last time -> nothing to recheck.
    coaching = prev_row.get("coaching") or {}
    chosen_fault_id = coaching.get("chosenFaultId") or prev_row.get("primary_fault_id")
    if not chosen_fault_id:
        logger.info("recheck: previous %s flagged no fault -> skip", previous_analysis_id)
        return None
    entry = find_fault(chosen_fault_id)
    if entry is None:
        logger.info("recheck: previous fault '%s' not in library -> skip", chosen_fault_id)
        return None

    # 4. The prescribed drill names the tracked metric + the improvement direction.
    drill_id = coaching.get("drillId")
    if drill_id not in DRILLS:
        drill_id = entry.drill_ids[0] if entry.drill_ids else None
    if not drill_id or drill_id not in DRILLS:
        logger.info("recheck: no valid drill for fault '%s' -> skip", chosen_fault_id)
        return None
    drill = DRILLS[drill_id]
    target_metric_key = drill.target_metric_key

    # 5. Both endpoints must be real, comparable measurements (status ok).
    previous_value = _previous_ok_metric_value(client, previous_analysis_id, target_metric_key)
    current_value = _current_ok_metric_value(result, target_metric_key)
    if previous_value is None or current_value is None:
        logger.info(
            "recheck: metric '%s' not comparable (prev=%s cur=%s) -> skip",
            target_metric_key, previous_value, current_value,
        )
        return None

    # 6. Deterministic delta + direction-aware improvement.
    delta = _round(current_value - previous_value)
    row = {
        "profile_id": profile_id,
        "drill_id": drill_id,
        "target_metric_key": target_metric_key,
        "previous_analysis_id": previous_analysis_id,
        "current_analysis_id": analysis_id,
        "previous_value": _round(previous_value),
        "current_value": _round(current_value),
        "delta": delta,
        "improved": _improved(delta, drill.improvement_direction),
    }
    logger.info(
        "recheck: %s vs %s metric=%s prev=%s cur=%s delta=%s improved=%s",
        analysis_id, previous_analysis_id, target_metric_key,
        row["previous_value"], row["current_value"], delta, row["improved"],
    )
    return row


def compute_and_write_recheck(
    client,
    *,
    analysis_id: str,
    profile_id: str,
    view: str,
    result: MeasurementResult,
    previous_analysis_id: str,
) -> Optional[dict]:
    """Compute the recheck and persist it. Returns the written row, or None if there was
    nothing comparable. Never raises a fabricated comparison — only writes real deltas."""
    row = compute_recheck(
        client,
        analysis_id=analysis_id,
        profile_id=profile_id,
        view=view,
        result=result,
        previous_analysis_id=previous_analysis_id,
    )
    if row is None:
        return None
    writeback.write_drill_recheck(client, row)
    return row
