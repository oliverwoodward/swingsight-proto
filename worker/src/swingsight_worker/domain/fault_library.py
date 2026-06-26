"""The fault library + metric catalogue + drills.

Mirror of app/src/domain/faultLibrary.ts. This is reference DATA, not logic — the
worker reads thresholds, reliability tiers and friendly ranges from here so it can
never disagree with the app about what a gate is or what "good" looks like. Keep it
byte-faithful to the TS: same keys, same numbers, same FAULT_LIBRARY_VERSION.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from .events import SwingEventName

FAULT_LIBRARY_VERSION = "2026.06.0"

MetricUnit = Literal["deg", "cm", "ratio", "fraction", "seconds", "count"]
Reliability = Literal["reliable", "approximate", "excluded"]
SwingView = Literal["face_on", "dtl"]
BetterDirection = Literal["lower", "higher", "target"]
GateOperator = Literal["exceeds", "below", "outside", "magnitude_at_least"]


@dataclass(frozen=True)
class Range:
    min: float
    max: float


@dataclass(frozen=True)
class MetricMeta:
    key: str
    label: str
    unit: MetricUnit
    views: tuple[SwingView, ...]
    reliability_tag: Reliability
    better_direction: BetterDirection
    ideal: float
    friendly_range: Range
    plausible: Range


# Mirror of METRIC_META. Approximate metrics are surfaced as ranges, never degrees.
METRIC_META: dict[str, MetricMeta] = {
    "tempo_ratio": MetricMeta(
        "tempo_ratio", "Tempo (back:down)", "ratio", ("face_on", "dtl"),
        "reliable", "target", 3.0, Range(2.5, 3.5), Range(1.0, 6.0),
    ),
    "backswing_seconds": MetricMeta(
        "backswing_seconds", "Backswing time", "seconds", ("face_on", "dtl"),
        "reliable", "target", 0.85, Range(0.7, 1.0), Range(0.3, 2.0),
    ),
    "head_sway_cm": MetricMeta(
        "head_sway_cm", "Head sway", "cm", ("face_on",),
        "reliable", "lower", 0.0, Range(0.0, 5.0), Range(0.0, 30.0),
    ),
    "head_lift_cm": MetricMeta(
        "head_lift_cm", "Head lift", "cm", ("face_on",),
        "reliable", "lower", 0.0, Range(0.0, 4.0), Range(-10.0, 30.0),
    ),
    "lead_elbow_flexion_impact_deg": MetricMeta(
        "lead_elbow_flexion_impact_deg", "Lead-arm bend at impact", "deg", ("face_on",),
        "reliable", "lower", 0.0, Range(0.0, 20.0), Range(0.0, 90.0),
    ),
    "reverse_spine_deg": MetricMeta(
        "reverse_spine_deg", "Spine tilt at top", "deg", ("face_on",),
        "approximate", "lower", 0.0, Range(-8.0, 8.0), Range(-20.0, 45.0),
    ),
    "over_the_top_deg": MetricMeta(
        "over_the_top_deg", "Downswing path", "deg", ("dtl",),
        "approximate", "lower", 0.0, Range(-4.0, 4.0), Range(-30.0, 30.0),
    ),
    "early_extension_cm": MetricMeta(
        "early_extension_cm", "Hip thrust toward ball", "cm", ("dtl",),
        "reliable", "lower", 0.0, Range(0.0, 6.0), Range(-5.0, 30.0),
    ),
    "follow_through_completion": MetricMeta(
        "follow_through_completion", "Follow-through", "fraction", ("face_on", "dtl"),
        "reliable", "higher", 1.0, Range(0.85, 1.0), Range(0.0, 1.2),
    ),
    "balance_stability": MetricMeta(
        "balance_stability", "Balance", "fraction", ("face_on", "dtl"),
        "reliable", "higher", 1.0, Range(0.8, 1.0), Range(0.0, 1.0),
    ),
    "shoulder_turn_deg": MetricMeta(
        "shoulder_turn_deg", "Shoulder turn", "deg", ("face_on", "dtl"),
        "approximate", "target", 90.0, Range(80.0, 100.0), Range(30.0, 130.0),
    ),
    "x_factor_deg": MetricMeta(
        "x_factor_deg", "X-factor", "deg", ("dtl", "face_on"),
        "approximate", "target", 45.0, Range(35.0, 55.0), Range(0.0, 90.0),
    ),
}


@dataclass(frozen=True)
class Drill:
    id: str
    title: str
    steps: tuple[str, ...]
    target_metric_key: str
    improvement_direction: Literal["increase", "decrease"]


# Mirror of DRILLS. The AI selects from these (Phase 5), never invents one.
DRILLS: dict[str, Drill] = {
    "towel_extension": Drill(
        "towel_extension", "Towel-under-lead-arm extension",
        (
            "Tuck a small towel under your lead armpit at address.",
            "Make slow half-swings, keeping the towel pinned through impact.",
            "Feel the lead arm stay long and extend down the target line after the ball.",
        ),
        "lead_elbow_flexion_impact_deg", "decrease",
    ),
    "release_extension": Drill(
        "release_extension", "Two-tee extension gate",
        (
            "Place a tee just past the ball on the target line.",
            "Swing trying to brush the second tee with the clubhead after impact.",
            "This trains the arms to keep extending instead of folding up.",
        ),
        "lead_elbow_flexion_impact_deg", "decrease",
    ),
    "tilt_away_drill": Drill(
        "tilt_away_drill", "Tilt-away at the top",
        (
            "At address, feel your trail shoulder slightly lower than the lead.",
            "As you reach the top, keep your spine tilted away from the target.",
            "Avoid letting your upper body lean toward the target going back.",
        ),
        "reverse_spine_deg", "decrease",
    ),
    "wall_head_drill": Drill(
        "wall_head_drill", "Steady-head wall drill",
        (
            "Stand so the top of your head lightly touches a wall at address.",
            "Make slow swings keeping your head in contact with the wall to the top.",
            "Quiet the head; let the body turn around a stable center.",
        ),
        "head_sway_cm", "decrease",
    ),
    "pump_drill": Drill(
        "pump_drill", "Downswing pump drill",
        (
            "Take the club to the top, then pump the hands down toward your trail pocket.",
            "Repeat two pumps, then swing through, keeping the club on the inside path.",
            "Trains the downswing to drop under the plane instead of over the top.",
        ),
        "over_the_top_deg", "decrease",
    ),
    "headcover_gate": Drill(
        "headcover_gate", "Headcover outside gate",
        (
            "Place a headcover just outside the ball, along the target line.",
            "Swing without hitting the headcover on the way down.",
            "Forces an inside, shallower downswing path.",
        ),
        "over_the_top_deg", "decrease",
    ),
    "chair_drill": Drill(
        "chair_drill", "Glute-on-chair drill",
        (
            "Set a chair so your trail glute just touches it at address.",
            "Keep both glutes touching their reference through the downswing.",
            "Stops the hips from thrusting toward the ball (early extension).",
        ),
        "early_extension_cm", "decrease",
    ),
    "belt_buckle_back": Drill(
        "belt_buckle_back", "Hips-back through impact",
        (
            "Feel your trail hip move back and around, not toward the ball.",
            "Keep your belt buckle behind its address position into impact.",
            "Maintains posture and room for the arms to swing down.",
        ),
        "early_extension_cm", "decrease",
    ),
}


@dataclass(frozen=True)
class FaultGate:
    metric_key: str
    operator: GateOperator
    threshold: dict  # {min?, max?, value?}
    requires3d: bool
    min_keypoint_confidence: float


@dataclass(frozen=True)
class HighlightRule:
    joints: tuple[str, ...]
    phase_window: dict  # {"start": SwingEventName, "end": SwingEventName}


ClaimEligibility = Literal["drives_claim", "soft_only"]


@dataclass(frozen=True)
class ValidationBar:
    min_agreement: float
    min_labelled_swings: int


@dataclass(frozen=True)
class FaultValidation:
    """The validation gate (mirror of FaultValidation in types.ts; spec §13.1).

    A fault may only drive a *visible claim* (the crisp highlight, the report headline,
    an LLM-selectable open gate) once it has cleared its regression bar against coach
    labels. `soft_only` faults are still measured but excluded from the primary claim +
    the LLM open gates — enforced in faults.evaluate_faults / gating.pick_primary_fault /
    coaching._open_gate_ids, not left to the UI.
    """

    claim_eligibility: ClaimEligibility
    bar: ValidationBar
    basis: str

    @property
    def drives_claim(self) -> bool:
        return self.claim_eligibility == "drives_claim"


@dataclass(frozen=True)
class FaultLibraryEntry:
    id: str
    name: str
    views: tuple[SwingView, ...]
    severity_weight: float
    gate: FaultGate
    highlight: HighlightRule
    validation: FaultValidation
    explanation_hook: str
    headline_template: str
    why_template: str
    drill_ids: tuple[str, ...]
    ball_flight_hook: Optional[str] = None


# The 5 launch faults (mirror FAULT_LIBRARY). Same ids, thresholds, joints, windows.
FAULT_LIBRARY: tuple[FaultLibraryEntry, ...] = (
    FaultLibraryEntry(
        id="chicken_wing",
        name="Chicken wing",
        views=("face_on",),
        severity_weight=0.95,
        gate=FaultGate(
            "lead_elbow_flexion_impact_deg", "exceeds", {"min": 22}, False, 0.4
        ),
        highlight=HighlightRule(
            ("lead_shoulder", "lead_elbow", "lead_wrist"),
            {"start": "impact", "end": "mid_follow_through"},
        ),
        validation=FaultValidation(
            "drives_claim",
            ValidationBar(0.7, 5),
            "Driven by lead_elbow_flexion_impact_deg, a reliable lead-arm-bend measurement "
            "(spec §15.1). Claim-eligible on that reliable basis; the regression runner "
            "measures coach agreement and will demote it if it drops below the bar.",
        ),
        explanation_hook=(
            "The lead arm folds (elbow bends) through impact instead of extending, often "
            "because the body stops rotating or the hands work up rather than left. The "
            "effect is a loss of width and speed and inconsistent strike."
        ),
        ball_flight_hook=(
            "Tends to produce a weak, high, or pushed/leaked-right shot for a right-hander."
        ),
        headline_template="Your lead arm is folding through impact",
        why_template=(
            "Your lead elbow stays bent (about {value}°) past impact instead of extending. "
            "That loses width and speed and makes the strike inconsistent."
        ),
        drill_ids=("towel_extension", "release_extension"),
    ),
    FaultLibraryEntry(
        id="reverse_spine_angle",
        name="Reverse spine angle",
        views=("face_on",),
        severity_weight=0.8,
        gate=FaultGate("reverse_spine_deg", "exceeds", {"min": 8}, False, 0.4),
        highlight=HighlightRule(
            ("pelvis_mid", "shoulder_mid", "head"),
            {"start": "mid_backswing", "end": "top"},
        ),
        validation=FaultValidation(
            "soft_only",
            ValidationBar(0.7, 5),
            "Driven by reverse_spine_deg, an APPROXIMATE 2D spine-tilt proxy (spec §15.2) "
            "that reads degenerate on off-angle clips (PRD §7). Held to soft/words-only — "
            "excluded from the primary claim and the LLM open gates — until it clears the "
            "bar on coach-labelled face-on swings in the regression runner.",
        ),
        explanation_hook=(
            "The upper body leans toward the target at the top, reversing the spine tilt. "
            "It limits rotation, stresses the lower back, and makes a consistent downswing hard."
        ),
        ball_flight_hook="Often linked to fat/thin strikes and a loss of power.",
        headline_template="Your spine is tilting toward the target at the top",
        why_template=(
            "At the top your upper body leans toward the target (about {value}°) instead of "
            "staying tilted away. That cramps your turn and hurts the strike."
        ),
        drill_ids=("tilt_away_drill",),
    ),
    FaultLibraryEntry(
        id="excessive_head_movement",
        name="Excessive head movement",
        views=("face_on",),
        severity_weight=0.7,
        gate=FaultGate("head_sway_cm", "exceeds", {"min": 6}, False, 0.5),
        highlight=HighlightRule(("head",), {"start": "address", "end": "impact"}),
        validation=FaultValidation(
            "drives_claim",
            ValidationBar(0.7, 5),
            "Driven by head_sway_cm, a reliable 2D-displacement measurement (spec §15.1). "
            "Claim-eligible on that reliable basis; the regression runner measures coach "
            "agreement and will demote it if it drops below the bar.",
        ),
        explanation_hook=(
            "The head drifts laterally during the swing instead of staying over a stable "
            "center, which moves the low point and makes solid contact harder to repeat."
        ),
        ball_flight_hook="Contributes to inconsistent strike — thins and fats.",
        headline_template="Your head is moving off the ball",
        why_template=(
            "Your head sways about {value} cm during the swing. A steadier center makes "
            "the bottom of your swing more repeatable."
        ),
        drill_ids=("wall_head_drill",),
    ),
    FaultLibraryEntry(
        id="over_the_top",
        name="Over the top",
        views=("dtl",),
        severity_weight=0.9,
        gate=FaultGate("over_the_top_deg", "exceeds", {"min": 6}, False, 0.4),
        highlight=HighlightRule(
            ("trail_shoulder", "trail_elbow", "trail_wrist"),
            {"start": "top", "end": "mid_downswing"},
        ),
        validation=FaultValidation(
            "soft_only",
            ValidationBar(0.7, 5),
            "Driven by over_the_top_deg, an APPROXIMATE 2D hand-path-plane proxy (spec §15.2; "
            "a true plane needs club tracking, deferred). Held to soft/words-only — excluded "
            "from the primary claim and the LLM open gates — until it clears the bar on "
            "coach-labelled DTL swings in the regression runner.",
        ),
        explanation_hook=(
            "From the top the club and trail arm move out and over the plane, throwing the "
            "downswing path to the outside. It is the classic slice/pull pattern."
        ),
        ball_flight_hook="Typically a slice or a pull for a right-hander.",
        headline_template="Your downswing is coming over the top",
        why_template=(
            "Your hands and trail arm start out and over the plane on the way down "
            "(about {value}° steep). That sends the club across the ball."
        ),
        drill_ids=("pump_drill", "headcover_gate"),
    ),
    FaultLibraryEntry(
        id="early_extension",
        name="Early extension",
        views=("dtl",),
        severity_weight=0.85,
        gate=FaultGate("early_extension_cm", "exceeds", {"min": 6}, False, 0.4),
        highlight=HighlightRule(
            ("lead_hip", "pelvis_mid", "trail_hip"),
            {"start": "mid_downswing", "end": "impact"},
        ),
        validation=FaultValidation(
            "drives_claim",
            ValidationBar(0.7, 5),
            "Driven by early_extension_cm, a reliable 2D hip-displacement measurement "
            "(spec §15.1). Claim-eligible on that reliable basis; the regression runner "
            "measures coach agreement and will demote it if it drops below the bar.",
        ),
        explanation_hook=(
            "The hips thrust toward the ball in the downswing and the posture stands up, "
            "crowding the arms and forcing compensations to find the ball."
        ),
        ball_flight_hook="Leads to blocks, hooks, and inconsistent contact.",
        headline_template="Your hips are moving toward the ball",
        why_template=(
            "Your hips push toward the ball about {value} cm in the downswing and you stand "
            "up out of posture. Keeping your hips back gives the arms room."
        ),
        drill_ids=("chair_drill", "belt_buckle_back"),
    ),
)

_FAULTS_BY_ID = {f.id: f for f in FAULT_LIBRARY}


def find_fault(fault_id: str) -> Optional[FaultLibraryEntry]:
    return _FAULTS_BY_ID.get(fault_id)


def faults_for_view(view: str) -> list[FaultLibraryEntry]:
    return [f for f in FAULT_LIBRARY if view in f.views]
