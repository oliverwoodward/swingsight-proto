/**
 * The fault library — the curated, versioned heart of the measurement/interpretation
 * split (spec §14). It is the single source that:
 *   - gives the CV its detection gate (what is geometrically present),
 *   - constrains what the AI may select,
 *   - owns the overlay highlight rule (segment + phase window, handedness-aware),
 *   - and scaffolds the explanation the AI writes from.
 *
 * Start small (5 high-confidence, cleanly measurable faults), not forty-five. Every
 * fault here drives a visible claim on the user's own video and must clear the
 * validation layer before it ships.
 */

import type {
  Drill,
  FaultLibraryEntry,
  Reliability,
  SwingView,
} from './types';

export const FAULT_LIBRARY_VERSION = '2026.06.0';

// ---------------------------------------------------------------------------
// Metric catalogue (spec §15). Reliability tiers from a single phone camera.
// Approximate metrics are surfaced as ranges, never precise degrees.
// ---------------------------------------------------------------------------

export interface MetricMeta {
  key: string;
  label: string;
  unit: 'deg' | 'cm' | 'ratio' | 'fraction' | 'seconds' | 'count';
  views: SwingView[];
  reliabilityTag: Reliability;
  /** Direction of "good": lower value, higher value, or close-to-ideal. */
  betterDirection: 'lower' | 'higher' | 'target';
  ideal: number;
  friendlyRange: { min: number; max: number };
  /** Physically plausible range; values outside imply a measurement error. */
  plausible: { min: number; max: number };
}

export const METRIC_META: Record<string, MetricMeta> = {
  tempo_ratio: {
    key: 'tempo_ratio',
    label: 'Tempo (back:down)',
    unit: 'ratio',
    views: ['face_on', 'dtl'],
    reliabilityTag: 'reliable',
    betterDirection: 'target',
    ideal: 3.0,
    friendlyRange: { min: 2.5, max: 3.5 },
    plausible: { min: 1.0, max: 6.0 },
  },
  backswing_seconds: {
    key: 'backswing_seconds',
    label: 'Backswing time',
    unit: 'seconds',
    views: ['face_on', 'dtl'],
    reliabilityTag: 'reliable',
    betterDirection: 'target',
    ideal: 0.85,
    friendlyRange: { min: 0.7, max: 1.0 },
    plausible: { min: 0.3, max: 2.0 },
  },
  head_sway_cm: {
    key: 'head_sway_cm',
    label: 'Head sway',
    unit: 'cm',
    views: ['face_on'],
    reliabilityTag: 'reliable',
    betterDirection: 'lower',
    ideal: 0,
    friendlyRange: { min: 0, max: 5 },
    plausible: { min: 0, max: 30 },
  },
  head_lift_cm: {
    key: 'head_lift_cm',
    label: 'Head lift',
    unit: 'cm',
    views: ['face_on'],
    reliabilityTag: 'reliable',
    betterDirection: 'lower',
    ideal: 0,
    friendlyRange: { min: 0, max: 4 },
    plausible: { min: -10, max: 30 },
  },
  lead_elbow_flexion_impact_deg: {
    key: 'lead_elbow_flexion_impact_deg',
    label: 'Lead-arm bend at impact',
    unit: 'deg',
    views: ['face_on'],
    reliabilityTag: 'reliable',
    betterDirection: 'lower',
    ideal: 0,
    friendlyRange: { min: 0, max: 20 },
    plausible: { min: 0, max: 90 },
  },
  reverse_spine_deg: {
    key: 'reverse_spine_deg',
    label: 'Spine tilt at top',
    unit: 'deg',
    views: ['face_on'],
    reliabilityTag: 'approximate',
    betterDirection: 'lower',
    ideal: 0,
    friendlyRange: { min: -8, max: 8 },
    plausible: { min: -20, max: 45 },
  },
  over_the_top_deg: {
    key: 'over_the_top_deg',
    label: 'Downswing path',
    unit: 'deg',
    views: ['dtl'],
    reliabilityTag: 'approximate',
    betterDirection: 'lower',
    ideal: 0,
    friendlyRange: { min: -4, max: 4 },
    plausible: { min: -30, max: 30 },
  },
  early_extension_cm: {
    key: 'early_extension_cm',
    label: 'Hip thrust toward ball',
    unit: 'cm',
    views: ['dtl'],
    reliabilityTag: 'reliable',
    betterDirection: 'lower',
    ideal: 0,
    friendlyRange: { min: 0, max: 6 },
    plausible: { min: -5, max: 30 },
  },
  follow_through_completion: {
    key: 'follow_through_completion',
    label: 'Follow-through',
    unit: 'fraction',
    views: ['face_on', 'dtl'],
    reliabilityTag: 'reliable',
    betterDirection: 'higher',
    ideal: 1.0,
    friendlyRange: { min: 0.85, max: 1.0 },
    plausible: { min: 0, max: 1.2 },
  },
  balance_stability: {
    key: 'balance_stability',
    label: 'Balance',
    unit: 'fraction',
    views: ['face_on', 'dtl'],
    reliabilityTag: 'reliable',
    betterDirection: 'higher',
    ideal: 1.0,
    friendlyRange: { min: 0.8, max: 1.0 },
    plausible: { min: 0, max: 1.0 },
  },
  shoulder_turn_deg: {
    key: 'shoulder_turn_deg',
    label: 'Shoulder turn',
    unit: 'deg',
    views: ['face_on', 'dtl'],
    reliabilityTag: 'approximate',
    betterDirection: 'target',
    ideal: 90,
    friendlyRange: { min: 80, max: 100 },
    plausible: { min: 30, max: 130 },
  },
  x_factor_deg: {
    key: 'x_factor_deg',
    label: 'X-factor',
    unit: 'deg',
    views: ['dtl', 'face_on'],
    reliabilityTag: 'approximate',
    betterDirection: 'target',
    ideal: 45,
    friendlyRange: { min: 35, max: 55 },
    plausible: { min: 0, max: 90 },
  },
};

// ---------------------------------------------------------------------------
// Drill catalogue (vetted). The AI selects from these, never invents one.
// ---------------------------------------------------------------------------

export const DRILLS: Record<string, Drill> = {
  towel_extension: {
    id: 'towel_extension',
    title: 'Towel-under-lead-arm extension',
    steps: [
      'Tuck a small towel under your lead armpit at address.',
      'Make slow half-swings, keeping the towel pinned through impact.',
      'Feel the lead arm stay long and extend down the target line after the ball.',
    ],
    targetMetricKey: 'lead_elbow_flexion_impact_deg',
    improvementDirection: 'decrease',
  },
  release_extension: {
    id: 'release_extension',
    title: 'Two-tee extension gate',
    steps: [
      'Place a tee just past the ball on the target line.',
      'Swing trying to brush the second tee with the clubhead after impact.',
      'This trains the arms to keep extending instead of folding up.',
    ],
    targetMetricKey: 'lead_elbow_flexion_impact_deg',
    improvementDirection: 'decrease',
  },
  tilt_away_drill: {
    id: 'tilt_away_drill',
    title: 'Tilt-away at the top',
    steps: [
      'At address, feel your trail shoulder slightly lower than the lead.',
      'As you reach the top, keep your spine tilted away from the target.',
      'Avoid letting your upper body lean toward the target going back.',
    ],
    targetMetricKey: 'reverse_spine_deg',
    improvementDirection: 'decrease',
  },
  wall_head_drill: {
    id: 'wall_head_drill',
    title: 'Steady-head wall drill',
    steps: [
      'Stand so the top of your head lightly touches a wall at address.',
      'Make slow swings keeping your head in contact with the wall to the top.',
      'Quiet the head; let the body turn around a stable center.',
    ],
    targetMetricKey: 'head_sway_cm',
    improvementDirection: 'decrease',
  },
  pump_drill: {
    id: 'pump_drill',
    title: 'Downswing pump drill',
    steps: [
      'Take the club to the top, then pump the hands down toward your trail pocket.',
      'Repeat two pumps, then swing through, keeping the club on the inside path.',
      'Trains the downswing to drop under the plane instead of over the top.',
    ],
    targetMetricKey: 'over_the_top_deg',
    improvementDirection: 'decrease',
  },
  headcover_gate: {
    id: 'headcover_gate',
    title: 'Headcover outside gate',
    steps: [
      'Place a headcover just outside the ball, along the target line.',
      'Swing without hitting the headcover on the way down.',
      'Forces an inside, shallower downswing path.',
    ],
    targetMetricKey: 'over_the_top_deg',
    improvementDirection: 'decrease',
  },
  chair_drill: {
    id: 'chair_drill',
    title: 'Glute-on-chair drill',
    steps: [
      'Set a chair so your trail glute just touches it at address.',
      'Keep both glutes touching their reference through the downswing.',
      'Stops the hips from thrusting toward the ball (early extension).',
    ],
    targetMetricKey: 'early_extension_cm',
    improvementDirection: 'decrease',
  },
  belt_buckle_back: {
    id: 'belt_buckle_back',
    title: 'Hips-back through impact',
    steps: [
      'Feel your trail hip move back and around, not toward the ball.',
      'Keep your belt buckle behind its address position into impact.',
      'Maintains posture and room for the arms to swing down.',
    ],
    targetMetricKey: 'early_extension_cm',
    improvementDirection: 'decrease',
  },
};

// ---------------------------------------------------------------------------
// The 5 launch faults (spec §14.1 suggested starting set).
// ---------------------------------------------------------------------------

export const FAULT_LIBRARY: FaultLibraryEntry[] = [
  {
    id: 'chicken_wing',
    name: 'Chicken wing',
    views: ['face_on'],
    severityWeight: 0.95,
    gate: {
      metricKey: 'lead_elbow_flexion_impact_deg',
      operator: 'exceeds',
      threshold: { min: 22 },
      requires3d: false,
      minKeypointConfidence: 0.4,
    },
    highlight: {
      joints: ['lead_shoulder', 'lead_elbow', 'lead_wrist'],
      phaseWindow: { start: 'impact', end: 'mid_follow_through' },
    },
    validation: {
      claimEligibility: 'drives_claim',
      bar: { minAgreement: 0.7, minLabelledSwings: 5 },
      basis:
        'Driven by lead_elbow_flexion_impact_deg, a reliable lead-arm-bend measurement ' +
        '(spec §15.1). Claim-eligible on that reliable basis; the regression runner now ' +
        'measures coach agreement and will demote it if it drops below the bar.',
    },
    explanationHook:
      'The lead arm folds (elbow bends) through impact instead of extending, often ' +
      'because the body stops rotating or the hands work up rather than left. The ' +
      'effect is a loss of width and speed and inconsistent strike.',
    ballFlightHook:
      'Tends to produce a weak, high, or pushed/leaked-right shot for a right-hander.',
    headlineTemplate: 'Your lead arm is folding through impact',
    whyTemplate:
      'Your lead elbow stays bent (about {value}°) past impact instead of extending. ' +
      'That loses width and speed and makes the strike inconsistent.',
    drillIds: ['towel_extension', 'release_extension'],
  },
  {
    id: 'reverse_spine_angle',
    name: 'Reverse spine angle',
    views: ['face_on'],
    severityWeight: 0.8,
    gate: {
      metricKey: 'reverse_spine_deg',
      operator: 'exceeds',
      threshold: { min: 8 },
      requires3d: false,
      minKeypointConfidence: 0.4,
    },
    highlight: {
      joints: ['pelvis_mid', 'shoulder_mid', 'head'],
      phaseWindow: { start: 'mid_backswing', end: 'top' },
    },
    validation: {
      claimEligibility: 'soft_only',
      bar: { minAgreement: 0.7, minLabelledSwings: 5 },
      basis:
        'Driven by reverse_spine_deg, an APPROXIMATE 2D spine-tilt proxy (spec §15.2) ' +
        'that reads degenerate on off-angle clips (PRD §7). Held to soft/words-only — ' +
        'excluded from the primary claim and the LLM open gates — until it clears the ' +
        'bar on coach-labelled face-on swings in the regression runner.',
    },
    explanationHook:
      'The upper body leans toward the target at the top, reversing the spine tilt. ' +
      'It limits rotation, stresses the lower back, and makes a consistent downswing hard.',
    ballFlightHook: 'Often linked to fat/thin strikes and a loss of power.',
    headlineTemplate: 'Your spine is tilting toward the target at the top',
    whyTemplate:
      'At the top your upper body leans toward the target (about {value}°) instead of ' +
      'staying tilted away. That cramps your turn and hurts the strike.',
    drillIds: ['tilt_away_drill'],
  },
  {
    id: 'excessive_head_movement',
    name: 'Excessive head movement',
    views: ['face_on'],
    severityWeight: 0.7,
    gate: {
      metricKey: 'head_sway_cm',
      operator: 'exceeds',
      threshold: { min: 6 },
      requires3d: false,
      minKeypointConfidence: 0.5,
    },
    highlight: {
      joints: ['head'],
      phaseWindow: { start: 'address', end: 'impact' },
    },
    validation: {
      claimEligibility: 'drives_claim',
      bar: { minAgreement: 0.7, minLabelledSwings: 5 },
      basis:
        'Driven by head_sway_cm, a reliable 2D-displacement measurement (spec §15.1). ' +
        'Claim-eligible on that reliable basis; the regression runner measures coach ' +
        'agreement and will demote it if it drops below the bar.',
    },
    explanationHook:
      'The head drifts laterally during the swing instead of staying over a stable ' +
      'center, which moves the low point and makes solid contact harder to repeat.',
    ballFlightHook: 'Contributes to inconsistent strike — thins and fats.',
    headlineTemplate: 'Your head is moving off the ball',
    whyTemplate:
      'Your head sways about {value} cm during the swing. A steadier center makes ' +
      'the bottom of your swing more repeatable.',
    drillIds: ['wall_head_drill'],
  },
  {
    id: 'over_the_top',
    name: 'Over the top',
    views: ['dtl'],
    severityWeight: 0.9,
    gate: {
      metricKey: 'over_the_top_deg',
      operator: 'exceeds',
      threshold: { min: 6 },
      requires3d: false,
      minKeypointConfidence: 0.4,
    },
    highlight: {
      joints: ['trail_shoulder', 'trail_elbow', 'trail_wrist'],
      phaseWindow: { start: 'top', end: 'mid_downswing' },
    },
    validation: {
      claimEligibility: 'soft_only',
      bar: { minAgreement: 0.7, minLabelledSwings: 5 },
      basis:
        'Driven by over_the_top_deg, an APPROXIMATE 2D hand-path-plane proxy (spec §15.2; ' +
        'a true plane needs club tracking, deferred). Held to soft/words-only — excluded ' +
        'from the primary claim and the LLM open gates — until it clears the bar on ' +
        'coach-labelled DTL swings in the regression runner.',
    },
    explanationHook:
      'From the top the club and trail arm move out and over the plane, throwing the ' +
      'downswing path to the outside. It is the classic slice/pull pattern.',
    ballFlightHook: 'Typically a slice or a pull for a right-hander.',
    headlineTemplate: 'Your downswing is coming over the top',
    whyTemplate:
      'Your hands and trail arm start out and over the plane on the way down ' +
      '(about {value}° steep). That sends the club across the ball.',
    drillIds: ['pump_drill', 'headcover_gate'],
  },
  {
    id: 'early_extension',
    name: 'Early extension',
    views: ['dtl'],
    severityWeight: 0.85,
    gate: {
      metricKey: 'early_extension_cm',
      operator: 'exceeds',
      threshold: { min: 6 },
      requires3d: false,
      minKeypointConfidence: 0.4,
    },
    highlight: {
      joints: ['lead_hip', 'pelvis_mid', 'trail_hip'],
      phaseWindow: { start: 'mid_downswing', end: 'impact' },
    },
    validation: {
      claimEligibility: 'drives_claim',
      bar: { minAgreement: 0.7, minLabelledSwings: 5 },
      basis:
        'Driven by early_extension_cm, a reliable 2D hip-displacement measurement ' +
        '(spec §15.1). Claim-eligible on that reliable basis; the regression runner ' +
        'measures coach agreement and will demote it if it drops below the bar.',
    },
    explanationHook:
      'The hips thrust toward the ball in the downswing and the posture stands up, ' +
      'crowding the arms and forcing compensations to find the ball.',
    ballFlightHook: 'Leads to blocks, hooks, and inconsistent contact.',
    headlineTemplate: 'Your hips are moving toward the ball',
    whyTemplate:
      'Your hips push toward the ball about {value} cm in the downswing and you stand ' +
      'up out of posture. Keeping your hips back gives the arms room.',
    drillIds: ['chair_drill', 'belt_buckle_back'],
  },
];

export function findFault(id: string): FaultLibraryEntry | undefined {
  return FAULT_LIBRARY.find((f) => f.id === id);
}

export function faultsForView(view: SwingView): FaultLibraryEntry[] {
  return FAULT_LIBRARY.filter((f) => f.views.includes(view));
}
