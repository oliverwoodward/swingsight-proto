"""The golden-set manifest: load + validate worker/validation/golden_set.json.

This is the committed source of truth for the validation set — a list of golden swings,
each with the coach's KNOWN-fault label (or marked explicitly as awaiting one). The loader
enforces an honesty guard so a fabricated or half-entered label can't slip in:

  - A `pending_coach_review` swing MUST NOT carry a label (no expected fault, not
    expected_no_fault) — it is explicitly awaiting human judgment.
  - A `coach` / `self_provisional` swing MUST name who labelled it AND carry exactly one
    real verdict (a known fault id, or expected_no_fault). A label without a labeller is
    rejected at load — you cannot commit a coach label nobody made.
  - `self_provisional` is the honest tier for a non-coach eyeball baseline: it counts
    toward agreement but is never presented as coach ground truth.

The clip bytes themselves are NOT committed (large, and may be personal data); each swing
references a clip by name/path that the runner resolves locally (see run_regression).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Optional

from ..domain.fault_library import find_fault

# Where a label came from. Only the first two count toward the agreement rate.
LABEL_SOURCES = ("coach", "self_provisional", "pending_coach_review")
_LABELLED_SOURCES = ("coach", "self_provisional")
_VIEWS = ("face_on", "dtl")
_HANDEDNESS = ("RH", "LH")


@dataclass(frozen=True)
class GoldenSwing:
    """One golden swing + its (possibly still-pending) coach label."""

    id: str
    clip: str  # filename or path; resolved locally by the runner
    view: str
    handedness: str
    label_source: str
    expected_primary_fault_id: Optional[str]
    expected_no_fault: bool
    metric_ground_truth: dict  # metricKey -> coach-estimated value (optional)
    labeled_by: Optional[str]
    labeled_at: Optional[str]
    notes: str

    @property
    def is_labelled(self) -> bool:
        """True only when a human has recorded a real verdict — the swings that count
        toward the agreement rate. Pending swings are run for review but never scored."""
        return self.label_source in _LABELLED_SOURCES and (
            self.expected_no_fault or self.expected_primary_fault_id is not None
        )


@dataclass(frozen=True)
class GoldenSet:
    version: str
    fault_library_version: str
    notes: str
    swings: tuple[GoldenSwing, ...]

    @property
    def labelled(self) -> tuple[GoldenSwing, ...]:
        return tuple(s for s in self.swings if s.is_labelled)

    @property
    def pending(self) -> tuple[GoldenSwing, ...]:
        return tuple(s for s in self.swings if not s.is_labelled)


class ManifestError(ValueError):
    """Raised when the golden set is malformed or violates the honesty guard."""


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise ManifestError(msg)


def _parse_swing(raw: dict, seen_ids: set[str]) -> GoldenSwing:
    sid = raw.get("id")
    _require(isinstance(sid, str) and sid != "", f"swing missing string id: {raw!r}")
    _require(sid not in seen_ids, f"duplicate swing id: {sid}")
    seen_ids.add(sid)

    clip = raw.get("clip")
    _require(isinstance(clip, str) and clip != "", f"swing {sid}: missing clip")

    view = raw.get("view")
    _require(view in _VIEWS, f"swing {sid}: view must be one of {_VIEWS}, got {view!r}")
    handedness = raw.get("handedness")
    _require(
        handedness in _HANDEDNESS,
        f"swing {sid}: handedness must be one of {_HANDEDNESS}, got {handedness!r}",
    )

    label_source = raw.get("labelSource")
    _require(
        label_source in LABEL_SOURCES,
        f"swing {sid}: labelSource must be one of {LABEL_SOURCES}, got {label_source!r}",
    )

    expected = raw.get("expectedPrimaryFaultId")
    expected_no_fault = bool(raw.get("expectedNoFault", False))
    labeled_by = raw.get("labeledBy")

    if expected is not None:
        _require(
            isinstance(expected, str) and find_fault(expected) is not None,
            f"swing {sid}: expectedPrimaryFaultId '{expected}' is not a known fault id",
        )

    # --- The honesty guard -------------------------------------------------
    if label_source == "pending_coach_review":
        # A pending swing is awaiting human judgment; it must not carry any verdict.
        _require(
            expected is None and not expected_no_fault,
            f"swing {sid}: pending_coach_review must carry NO label "
            f"(expectedPrimaryFaultId null, expectedNoFault false). Don't pre-fill it.",
        )
    else:  # coach / self_provisional — a real, attributable label is required.
        _require(
            isinstance(labeled_by, str) and labeled_by.strip() != "",
            f"swing {sid}: a '{label_source}' label must name labeledBy "
            f"(who made the judgment) — a label without a labeller is rejected.",
        )
        has_fault = expected is not None
        _require(
            has_fault != expected_no_fault,
            f"swing {sid}: a labelled swing needs EXACTLY ONE verdict — either "
            f"expectedPrimaryFaultId set OR expectedNoFault true (got fault={expected!r}, "
            f"noFault={expected_no_fault}).",
        )

    mgt_raw = raw.get("metricGroundTruth") or {}
    _require(isinstance(mgt_raw, dict), f"swing {sid}: metricGroundTruth must be an object")
    metric_ground_truth: dict = {}
    for k, v in mgt_raw.items():
        _require(
            isinstance(v, (int, float)),
            f"swing {sid}: metricGroundTruth[{k}] must be a number, got {v!r}",
        )
        metric_ground_truth[k] = float(v)

    return GoldenSwing(
        id=sid,
        clip=clip,
        view=view,
        handedness=handedness,
        label_source=label_source,
        expected_primary_fault_id=expected,
        expected_no_fault=expected_no_fault,
        metric_ground_truth=metric_ground_truth,
        labeled_by=labeled_by if isinstance(labeled_by, str) else None,
        labeled_at=raw.get("labeledAt") if isinstance(raw.get("labeledAt"), str) else None,
        notes=str(raw.get("notes") or ""),
    )


def load_golden_set(path: str) -> GoldenSet:
    """Parse + validate the golden set. Raises ManifestError on any malformed or
    dishonest entry (so a bad label fails loudly rather than corrupting the agreement
    rate)."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    _require(isinstance(data, dict), "golden set must be a JSON object")
    swings_raw = data.get("swings")
    _require(isinstance(swings_raw, list), "golden set: 'swings' must be a list")

    seen: set[str] = set()
    swings = tuple(_parse_swing(s, seen) for s in swings_raw)

    return GoldenSet(
        version=str(data.get("version") or "0"),
        fault_library_version=str(data.get("faultLibraryVersion") or ""),
        notes=str(data.get("notes") or ""),
        swings=swings,
    )
