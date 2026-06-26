"""The regression report — PURE comparison of the pipeline's output to coach labels.

Given the golden set and one prediction per swing (the deterministic measurement core's
primary fault + metrics), build the per-fault agreement rate, the overall primary-fault
agreement (spec §13.1's headline accuracy metric), the per-metric error, and the gate
verdict: does each claim-eligible fault still clear its documented bar?

This module does NO measurement and NO IO — it is a pure function of (golden set,
predictions), which is what makes the agreement maths unit-testable in isolation
(run_regression.py --self-test). The runner feeds it real predictions; the self-test
feeds it synthetic ones.

Definitions (kept deliberately simple and honest):
  - A swing "counts" toward agreement only if it is LABELLED (a human verdict) AND ran to
    'complete'. Pending / clip-missing / errored swings never inflate the rate.
  - Overall primary agreement = fraction of counted swings where the pipeline's primary
    fault equals the coach's verdict (a `no_fault` label agrees with a null prediction).
  - Per-fault agreement (the bar metric) is RECALL-style: among counted swings the coach
    labelled as fault F, how often did the pipeline also pick F? That is what "this fault
    rule is trustworthy enough to drive a visible claim" must clear.
  - A claim-eligible fault REGRESSES when it has >= bar.minLabelledSwings counted F-labels
    and its agreement is below bar.minAgreement. With too few labels the verdict is
    'insufficient_evidence' — honest, not a pass disguised as a pass.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from ..domain.fault_library import FAULT_LIBRARY, FAULT_LIBRARY_VERSION
from .manifest import GoldenSet, GoldenSwing

NO_FAULT_KEY = "(no_fault)"


@dataclass(frozen=True)
class SwingPrediction:
    """The pipeline's deterministic output for one golden swing (or why it didn't run)."""

    swing_id: str
    status: str  # 'complete' | 'unreadable' | 'clip_missing' | 'error'
    predicted_primary_fault_id: Optional[str] = None
    # metricKey -> {"value": float, "status": str}
    predicted_metrics: dict = field(default_factory=dict)
    open_gate_ids: tuple[str, ...] = ()
    error: Optional[str] = None

    @property
    def ran(self) -> bool:
        return self.status == "complete"


def primary_agreement(swing: GoldenSwing, pred: SwingPrediction) -> Optional[bool]:
    """Did the pipeline's primary fault match the coach verdict? None when the swing
    can't be scored (not labelled, or didn't run to complete)."""
    if not swing.is_labelled or not pred.ran:
        return None
    if swing.expected_no_fault:
        return pred.predicted_primary_fault_id is None
    return pred.predicted_primary_fault_id == swing.expected_primary_fault_id


def metric_errors(swing: GoldenSwing, pred: SwingPrediction) -> dict[str, float]:
    """|predicted - coach truth| per metric, only for metrics the coach gave a truth for
    and the pipeline measured with status 'ok'."""
    out: dict[str, float] = {}
    for key, truth in swing.metric_ground_truth.items():
        m = pred.predicted_metrics.get(key)
        if m is not None and m.get("status") == "ok" and isinstance(m.get("value"), (int, float)):
            out[key] = abs(float(m["value"]) - float(truth))
    return out


def _label_bucket(swing: GoldenSwing) -> Optional[str]:
    """Which per-fault bucket a labelled swing belongs to (its coach verdict)."""
    if not swing.is_labelled:
        return None
    return NO_FAULT_KEY if swing.expected_no_fault else swing.expected_primary_fault_id


def build_report(golden_set: GoldenSet, predictions: dict[str, SwingPrediction]) -> dict:
    """Assemble the full regression report (a plain dict, JSON-serialisable)."""
    by_id = {s.id: s for s in golden_set.swings}

    counted: list[GoldenSwing] = []  # labelled AND ran to complete
    agreed_overall = 0
    confusion: list[dict] = []
    pending_review: list[dict] = []
    metric_abs_errors: dict[str, list[float]] = {}
    run_status_counts: dict[str, int] = {}

    for sid, swing in by_id.items():
        pred = predictions.get(sid, SwingPrediction(sid, "error", error="no prediction"))
        run_status_counts[pred.status] = run_status_counts.get(pred.status, 0) + 1

        agree = primary_agreement(swing, pred)
        if agree is not None:
            counted.append(swing)
            if agree:
                agreed_overall += 1
            for k, err in metric_errors(swing, pred).items():
                metric_abs_errors.setdefault(k, []).append(err)
            confusion.append(
                {
                    "swingId": sid,
                    "view": swing.view,
                    "labelSource": swing.label_source,
                    "labeledBy": swing.labeled_by,
                    "expected": _label_bucket(swing),
                    "predicted": pred.predicted_primary_fault_id,
                    "agreed": bool(agree),
                }
            )

        if not swing.is_labelled:
            pending_review.append(
                {
                    "swingId": sid,
                    "view": swing.view,
                    "labelSource": swing.label_source,
                    "runStatus": pred.status,
                    "predictedPrimaryFaultId": pred.predicted_primary_fault_id,
                    "openGateIds": list(pred.open_gate_ids),
                    "metrics": pred.predicted_metrics,
                    "error": pred.error,
                    "notes": swing.notes,
                }
            )

    # --- Per-fault recall + bar verdict ------------------------------------
    per_fault: list[dict] = []
    any_regression = False
    for entry in FAULT_LIBRARY:
        bucket = [s for s in counted if _label_bucket(s) == entry.id]
        labelled_count = len(bucket)
        agreed_count = sum(
            1
            for s in bucket
            if predictions[s.id].predicted_primary_fault_id == entry.id
        )
        agreement = (agreed_count / labelled_count) if labelled_count else None
        bar = entry.validation.bar
        claim_eligible = entry.validation.drives_claim

        if labelled_count < bar.min_labelled_swings:
            clears = None
            status = "insufficient_evidence"
        else:
            clears = agreement is not None and agreement >= bar.min_agreement
            status = "ok" if clears else "REGRESSION"

        regression = bool(claim_eligible and status == "REGRESSION")
        any_regression = any_regression or regression

        per_fault.append(
            {
                "faultId": entry.id,
                "name": entry.name,
                "claimEligible": claim_eligible,
                "barMinAgreement": bar.min_agreement,
                "barMinLabelled": bar.min_labelled_swings,
                "labelledCount": labelled_count,
                "agreedCount": agreed_count,
                "agreement": agreement,
                "clearsBar": clears,
                "regression": regression,
                "status": status,
            }
        )

    # The "no fault" path (coach said there's no priority fault) — informational.
    no_fault_bucket = [s for s in counted if _label_bucket(s) == NO_FAULT_KEY]
    if no_fault_bucket:
        agreed_nf = sum(
            1 for s in no_fault_bucket if predictions[s.id].predicted_primary_fault_id is None
        )
        per_fault.append(
            {
                "faultId": NO_FAULT_KEY,
                "name": "No priority fault",
                "claimEligible": None,
                "barMinAgreement": None,
                "barMinLabelled": None,
                "labelledCount": len(no_fault_bucket),
                "agreedCount": agreed_nf,
                "agreement": agreed_nf / len(no_fault_bucket),
                "clearsBar": None,
                "regression": False,
                "status": "informational",
            }
        )

    per_metric_error = [
        {
            "metricKey": k,
            "n": len(v),
            "meanAbsError": sum(v) / len(v),
            "unit": (find_fault_metric_unit(k) or ""),
        }
        for k, v in sorted(metric_abs_errors.items())
    ]

    overall_agreement = (agreed_overall / len(counted)) if counted else None

    summary = {
        "goldenSetVersion": golden_set.version,
        "manifestFaultLibraryVersion": golden_set.fault_library_version,
        "currentFaultLibraryVersion": FAULT_LIBRARY_VERSION,
        "faultLibraryVersionMatch": golden_set.fault_library_version == FAULT_LIBRARY_VERSION,
        "totalSwings": len(by_id),
        "labelledSwings": len(golden_set.labelled),
        "pendingSwings": len(golden_set.pending),
        "countedSwings": len(counted),
        "overallPrimaryAgreement": overall_agreement,
        "runStatusCounts": run_status_counts,
    }

    return {
        "summary": summary,
        "perFault": per_fault,
        "perMetricError": per_metric_error,
        "confusion": confusion,
        "pendingReview": pending_review,
        "regression": any_regression,
        # The gate passes when no claim-eligible fault has dropped below its bar. (Too few
        # labels => insufficient_evidence, which is honest and does NOT fail the gate.)
        "ok": not any_regression,
    }


def find_fault_metric_unit(metric_key: str) -> Optional[str]:
    """The unit for a metric key (best-effort, for the error report)."""
    from ..domain.fault_library import METRIC_META

    meta = METRIC_META.get(metric_key)
    return meta.unit if meta else None
