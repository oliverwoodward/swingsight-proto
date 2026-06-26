/**
 * Deterministic fault gating (spec §5.9). The cloud worker is the source of truth
 * for the FaultEvaluation it writes onto a SwingAnalysis, but the same logic lives
 * here so the app can reason about gates consistently and so it is unit-testable.
 *
 * A gate either opens or it does not; severity is a band, not an LLM judgement. The
 * AI may only ever select a fault whose gate is open.
 */

import { type MetricMeta } from './faultLibrary';
import type {
  FaultEvaluation,
  FaultGate,
  Metric,
  MetricStatus,
} from './types';

/** Confidence below this withholds a fault / softens the score. */
export const LOW_CONFIDENCE = 0.5;

/** Clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Is a measured value physically plausible for its metric? */
export function assessMetricStatus(value: number, meta: MetricMeta): MetricStatus {
  if (Number.isNaN(value)) return 'implausible';
  if (value < meta.plausible.min || value > meta.plausible.max) return 'implausible';
  return 'ok';
}

export function isInFriendlyRange(value: number, meta: MetricMeta): boolean {
  return value >= meta.friendlyRange.min && value <= meta.friendlyRange.max;
}

/**
 * Evaluate a gate's condition against a value. Returns whether it fired and a
 * normalised magnitude (0 at the threshold, growing past it), used for severity and
 * for prioritising between multiple open gates.
 */
export function evaluateGate(
  value: number,
  gate: FaultGate,
): { fired: boolean; magnitude: number } {
  const { operator, threshold } = gate;
  switch (operator) {
    case 'exceeds': {
      const t = threshold.min ?? 0;
      const fired = value > t;
      // normalise by the threshold's own scale so different metrics compare.
      const magnitude = fired ? (value - t) / Math.max(Math.abs(t), 1) : 0;
      return { fired, magnitude };
    }
    case 'below': {
      const t = threshold.max ?? 0;
      const fired = value < t;
      const magnitude = fired ? (t - value) / Math.max(Math.abs(t), 1) : 0;
      return { fired, magnitude };
    }
    case 'outside': {
      const lo = threshold.min ?? -Infinity;
      const hi = threshold.max ?? Infinity;
      const fired = value < lo || value > hi;
      const dist = value < lo ? lo - value : value > hi ? value - hi : 0;
      const scale = Math.max(Math.abs(lo), Math.abs(hi), 1);
      return { fired, magnitude: fired ? dist / scale : 0 };
    }
    case 'magnitude_at_least': {
      const t = threshold.value ?? 0;
      const fired = Math.abs(value) >= t;
      const magnitude = fired ? (Math.abs(value) - t) / Math.max(t, 1) : 0;
      return { fired, magnitude };
    }
    default: {
      const exhaustive: never = operator;
      return exhaustive;
    }
  }
}

export function severityBand(magnitude: number): FaultEvaluation['severityBand'] {
  if (magnitude <= 0) return 'none';
  if (magnitude < 0.4) return 'mild';
  if (magnitude < 1.0) return 'moderate';
  return 'strong';
}

/** Find a metric on an analysis by key. */
export function getMetric(metrics: Metric[], key: string): Metric | undefined {
  return metrics.find((m) => m.key === key);
}

/**
 * Among the evaluated faults, pick the priority fault: the highest
 * magnitude × severityWeight among gates that fired with adequate confidence AND are
 * claim-eligible (the validation gate — spec §13.1). A fired-but-`soft_only` fault is
 * recorded for transparency but never becomes the primary claim. Returns null when
 * nothing clears the bar (→ the AI has nothing to select; the report shows "no clear
 * priority fault" rather than highlighting a crude proxy).
 */
export function pickPrimaryFault(
  evaluations: FaultEvaluation[],
  severityWeightOf: (faultId: string) => number,
): FaultEvaluation | null {
  const eligible = evaluations.filter(
    (e) => e.fired && e.confidence >= LOW_CONFIDENCE && e.status === 'ok' && e.claimEligible,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, e) => {
    const score = e.magnitude * severityWeightOf(e.faultId);
    const bestScore = best.magnitude * severityWeightOf(best.faultId);
    return score > bestScore ? e : best;
  });
}

/**
 * Compose a metric's confidence from worker engine confidence × the metric's
 * reliability tier, used by both gating and the score's confidence gate.
 */
export function metricConfidence(engineConfidence: number, meta: MetricMeta): number {
  const reliabilityFactor =
    meta.reliabilityTag === 'reliable' ? 1.0 : meta.reliabilityTag === 'approximate' ? 0.7 : 0.0;
  return clamp(engineConfidence * reliabilityFactor, 0, 1);
}
