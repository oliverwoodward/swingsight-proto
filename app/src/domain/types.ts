/**
 * SwingSight domain model — the single shared contract between the on-device app
 * and the cloud worker. The worker emits JSON that conforms to these shapes; the
 * report UI reads them. Keep this file framework-free (pure TypeScript) so it can
 * be mirrored 1:1 by the Python worker's output schema.
 *
 * Governing law: CV measures, the AI explains, the fault library localises.
 * Nothing the LLM returns is allowed to set joints, frames, or the score.
 */

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

/** Right- or left-handed golfer. Drives every directional decision. */
export type Handedness = 'RH' | 'LH';

/** The two supported camera views. Each is a separate analysis, never fused. */
export type SwingView = 'face_on' | 'dtl';

/** Lead arm/side vs trail arm/side, resolved from handedness at render time. */
export type Side = 'lead' | 'trail';

/** Reliability tier for a metric from a single phone camera (spec §15). */
export type Reliability = 'reliable' | 'approximate' | 'excluded';

/** Per-metric measurability outcome from the worker. */
export type MetricStatus = 'ok' | 'unmeasurable_view' | 'low_confidence' | 'implausible';

/** Comparison operators a fault gate can use against its driving metric. */
export type GateOperator = 'exceeds' | 'below' | 'outside' | 'magnitude_at_least';

/**
 * Lifecycle of a single analysis. `unreadable` is the input-quality gate tripping
 * (no person / partial body / multiple people / no detectable strike) — the report
 * shows re-record guidance rather than a fabricated analysis.
 */
export type AnalysisStatus =
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'complete'
  | 'failed'
  | 'unreadable';

/** The 8 canonical swing events (key frames), in temporal order. */
export type SwingEventName =
  | 'address'
  | 'toe_up'
  | 'mid_backswing'
  | 'top'
  | 'mid_downswing'
  | 'impact'
  | 'mid_follow_through'
  | 'finish';

// ---------------------------------------------------------------------------
// User profile
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  handedness: Handedness;
  /** The view the user most recently chose; remembered as the capture default. */
  preferredView: SwingView;
  /** ISO timestamp; analysis is blocked until consent is recorded. */
  consentAcceptedAt: string | null;
  /** Separate, opt-in consent for training use of swings (spec §13/§21). */
  trainingConsentAcceptedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Keypoints (per-frame pose), used to draw the skeleton overlay
// ---------------------------------------------------------------------------

/**
 * One landmark. Coordinates are normalised to [0,1] against the source video
 * frame (MediaPipe BlazePose image space), so they are resolution-independent.
 * `visibility` is BlazePose's per-landmark confidence in [0,1].
 */
export interface Keypoint {
  x: number;
  y: number;
  visibility: number;
}

/** A full pose for one frame: BlazePose's 33 landmarks plus a timestamp. */
export interface KeypointFrame {
  /** Seconds from the start of the (trimmed) clip. */
  t: number;
  /** BlazePose order; length 33. See domain/keypoints.ts for indices. */
  landmarks: Keypoint[];
}

export interface KeypointSeries {
  topology: 'blazepose33';
  /** Source frame dimensions the normalised coords were computed against. */
  videoWidth: number;
  videoHeight: number;
  fps: number;
  frames: KeypointFrame[];
}

// ---------------------------------------------------------------------------
// Swing events
// ---------------------------------------------------------------------------

export interface SwingEvent {
  name: SwingEventName;
  /** Index into KeypointSeries.frames. */
  frameIndex: number;
  /** Seconds from clip start (frameIndex / fps, or the true frame timestamp). */
  t: number;
  /** Event-localisation confidence in [0,1]. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface Metric {
  /** Stable key, e.g. 'tempo_ratio', 'lead_elbow_flexion_impact_deg'. */
  key: string;
  /** Human label for the report. */
  label: string;
  value: number;
  unit: 'deg' | 'cm' | 'ratio' | 'fraction' | 'seconds' | 'count';
  status: MetricStatus;
  reliabilityTag: Reliability;
  /** Worker confidence in this measurement, in [0,1]. */
  confidence: number;
  /** The "good" target value used for the friendly readout. */
  ideal: number;
  /** Friendly range shown to the user (never a precise degree for approximate metrics). */
  friendlyRange: { min: number; max: number };
  inRange: boolean;
}

// ---------------------------------------------------------------------------
// Fault library (data) + per-swing evaluations
// ---------------------------------------------------------------------------

export interface FaultGate {
  /** The metric this fault is gated on. */
  metricKey: string;
  operator: GateOperator;
  threshold: { min?: number; max?: number; value?: number };
  /** Whether the gate needs 3D info (false for everything at launch). */
  requires3d: boolean;
  /** Minimum visibility on the driving joints for the gate to open. */
  minKeypointConfidence: number;
}

/**
 * Logical (handedness-agnostic) joint references. Resolved to concrete BlazePose
 * indices at render time via domain/highlight.ts so the data stays mirror-safe.
 */
export type SkeletonJointRef =
  | 'lead_shoulder'
  | 'lead_elbow'
  | 'lead_wrist'
  | 'lead_hip'
  | 'lead_knee'
  | 'lead_ankle'
  | 'trail_shoulder'
  | 'trail_elbow'
  | 'trail_wrist'
  | 'trail_hip'
  | 'trail_knee'
  | 'trail_ankle'
  | 'head'
  | 'pelvis_mid'
  | 'shoulder_mid';

/**
 * The fault library owns the highlight, not the AI. A joint chain (drawn as a
 * connected segment) across a phase window. Handedness selects which limb.
 */
export interface HighlightRule {
  /** Ordered joints forming the highlighted chain. */
  joints: SkeletonJointRef[];
  /** The event window the highlight is drawn across (inclusive). */
  phaseWindow: { start: SwingEventName; end: SwingEventName };
}

/**
 * The validation gate (spec §13.1 / §6: "every visible claim must pass the validation
 * layer"). A fault may only drive a *visible claim* — the crisp highlight, the report
 * headline, an LLM-selectable open gate — once it has cleared its regression bar against
 * coach-labelled ground truth. Until then it is `soft_only`: still measured and may be
 * surfaced softly, but never the primary claim. This is enforced structurally (the worker
 * excludes `soft_only` faults from `primaryFaultId` and from the LLM's open gates), not
 * left to UI discretion.
 */
export interface FaultValidation {
  /**
   * 'drives_claim' — claim-eligible (built on a reliable metric and/or cleared its bar).
   * 'soft_only'    — held back to a soft/words-only indicator until it clears the bar.
   */
  claimEligibility: 'drives_claim' | 'soft_only';
  /**
   * The bar this fault must clear (and keep clearing) to be claim-eligible: over at least
   * `minLabelledSwings` coach-labelled swings whose ground-truth primary fault is THIS
   * fault, the pipeline must agree at >= `minAgreement`. The regression runner reports the
   * measured agreement and fails if a claim-eligible fault drops below the bar.
   */
  bar: { minAgreement: number; minLabelledSwings: number };
  /** Honest, human-readable basis for the current status + the path to promotion. */
  basis: string;
}

export interface FaultLibraryEntry {
  id: string;
  name: string;
  views: SwingView[];
  severityWeight: number;
  gate: FaultGate;
  highlight: HighlightRule;
  /** Validation status — may this fault drive a visible claim yet? (spec §13.1) */
  validation: FaultValidation;
  /** Cause→effect scaffold the AI reasons within (not a fixed script). */
  explanationHook: string;
  /** Typical ball-flight tendency to optionally mention (phrased as a tendency). */
  ballFlightHook?: string;
  /** Deterministic copy used by the template-fallback coach. */
  headlineTemplate: string;
  whyTemplate: string;
  /** Vetted drills eligible for this fault (drill ids). */
  drillIds: string[];
}

export interface FaultEvaluation {
  faultId: string;
  metricKey: string;
  value: number;
  /** Did the deterministic gate open? */
  fired: boolean;
  /** How far past the threshold, normalised by the threshold band. */
  magnitude: number;
  severityBand: 'none' | 'mild' | 'moderate' | 'strong';
  /** engine confidence × driving-joint visibility, in [0,1]. */
  confidence: number;
  status: MetricStatus;
  /**
   * Whether this fault is claim-eligible (its library entry's
   * `validation.claimEligibility === 'drives_claim'`). A fired-but-not-claim-eligible
   * fault is recorded for transparency but can never become `primaryFaultId` or an LLM
   * open gate — see gating.pickPrimaryFault. (spec §13.1)
   */
  claimEligible: boolean;
  /** Frames the fault is evaluated across (for the overlay window). */
  frameWindow: { startFrame: number; endFrame: number };
}

// ---------------------------------------------------------------------------
// Drills + coaching
// ---------------------------------------------------------------------------

export interface Drill {
  id: string;
  title: string;
  steps: string[];
  /** The metric a recheck should move, and which direction is improvement. */
  targetMetricKey: string;
  improvementDirection: 'increase' | 'decrease';
}

/**
 * The interpretation layer's output. Source is 'llm' normally, 'template' when the
 * LLM call failed or returned out-of-schema. The LLM never sets a score, joint, or
 * frame — those come from the measurement layer only.
 */
export interface CoachingResult {
  source: 'llm' | 'template';
  chosenFaultId: string | null;
  headline: string;
  why: string;
  /**
   * How the one selected fault knocks on through the rest of the swing — grounded only in
   * the measured metrics (language only; no fabricated numbers). Absent on the no-fault
   * template.
   */
  chain?: string;
  ballFlightNote?: string;
  drillId: string | null;
  /**
   * True when the selected fault is a `soft_only` proxy surfaced as a TENTATIVE
   * observation (no claim-eligible primary fired). The report frames it as something to
   * keep an eye on, not a verdict, and the overlay stays soft. (spec §13.1)
   */
  tentative?: boolean;
  /** Advisory only; never gates the highlight or the score. */
  llmConfidence?: number;
}

// ---------------------------------------------------------------------------
// Deterministic score (consistency / progress, vs the user's own baseline)
// ---------------------------------------------------------------------------

export interface ScoreContribution {
  metricKey: string;
  label: string;
  /** Signed contribution to the headline number, for the "tap to see why" view. */
  points: number;
}

export interface SwingScore {
  /** 0–100, computed deterministically from metrics. Never from the LLM. */
  value: number;
  /** Worker confidence in the score; below the gate the UI withholds/softens it. */
  confidence: number;
  /** When true, the UI shows the fault + drill but hides/softens the number. */
  withheld: boolean;
  /** The metrics that drove the number, surfaced on tap. */
  contributions: ScoreContribution[];
}

// ---------------------------------------------------------------------------
// Input-quality gate
// ---------------------------------------------------------------------------

export type QualityReason =
  | 'no_person'
  | 'partial_body'
  | 'multiple_people'
  | 'no_swing_detected'
  | 'too_dark'
  | 'too_blurry';

export interface QualityReport {
  ok: boolean;
  reason?: QualityReason;
  /** Mean keypoint visibility across the analysed frames, in [0,1]. */
  meanKeypointConfidence: number;
  /** Friendly, specific re-record guidance shown when ok === false. */
  guidance?: string;
}

// ---------------------------------------------------------------------------
// The top-level analysis aggregate + the realtime status update
// ---------------------------------------------------------------------------

export interface SwingAnalysis {
  id: string;
  profileId: string;
  view: SwingView;
  /** Snapshot of handedness at capture time. */
  handedness: Handedness;
  status: AnalysisStatus;
  createdAt: string;
  /** Populated once complete. */
  playbackVideoUrl: string | null;
  keypoints: KeypointSeries | null;
  events: SwingEvent[];
  metrics: Metric[];
  faults: FaultEvaluation[];
  primaryFaultId: string | null;
  /**
   * Top fired `soft_only` fault when no claim-eligible primary cleared the bar — a
   * tentative observation the coaching layer may hedge on, never a verdict. Distinct from
   * `primaryFaultId` so the hard-vs-soft distinction stays explicit. (spec §13.1)
   */
  observationFaultId: string | null;
  score: SwingScore | null;
  coaching: CoachingResult | null;
  quality: QualityReport;
  faultLibraryVersion: string;
  /** Present when status === 'failed'. */
  errorReason?: string;
}

export interface AnalysisStatusUpdate {
  id: string;
  status: AnalysisStatus;
  /** 0–1 progress hint for the progress UI (e.g. upload %, stage %). */
  progress?: number;
  /** Optional human stage label ("measuring tempo…"). */
  stage?: string;
}

// ---------------------------------------------------------------------------
// Drill-then-recheck loop
// ---------------------------------------------------------------------------

export interface DrillRecheck {
  drillId: string;
  targetMetricKey: string;
  previousAnalysisId: string;
  currentAnalysisId: string;
  previousValue: number;
  currentValue: number;
  delta: number;
  /** Direction-aware: did the targeted metric move the right way? */
  improved: boolean;
}
