/**
 * Direction-aware, honest wording for the drill-then-recheck comparison (Phase 6 / spec
 * §12). Governing law: the delta + verdict are DETERMINISTIC (computed by the worker from
 * CV); this only words them. No raw degrees for approximate metrics — those move as a
 * qualitative trend only (spec §15.2). Nothing here invents a number: every figure comes
 * straight from the worker's measured `DrillRecheck`.
 */
import { DRILLS, METRIC_META, type DrillRecheck, type MetricMeta } from '@/domain';

export type RecheckTone = 'improved' | 'same' | 'regressed';

export interface RecheckCopy {
  tone: RecheckTone;
  title: string;
  detail: string;
  drillTitle: string | null;
  /** Friendly previous→current readout — only for reliable metrics (null for approximate). */
  movement: { previous: string; current: string } | null;
}

// Below this magnitude of change a metric reads as "about the same" rather than better or
// worse — a per-unit floor so frame-level jitter doesn't masquerade as progress.
const CHANGE_EPS: Record<MetricMeta['unit'], number> = {
  deg: 2,
  cm: 1,
  ratio: 0.2,
  fraction: 0.04,
  seconds: 0.05,
  count: 1,
};

// Specific, encouraging phrasings for the launch metrics; generic fallback below.
const PHRASES: Record<string, Record<RecheckTone, string>> = {
  lead_elbow_flexion_impact_deg: {
    improved: 'Your lead arm is extending more through impact than last time.',
    regressed: 'Your lead arm is still folding through impact — let’s stick with the drill.',
    same: 'Your lead-arm extension is about the same as last time.',
  },
  head_sway_cm: {
    improved: 'Your head is steadier over the ball than last time.',
    regressed: 'Your head is still drifting off the ball — keep working the drill.',
    same: 'Your head movement is about the same as last time.',
  },
  reverse_spine_deg: {
    improved: 'Your spine tilt at the top is closer to neutral than last time.',
    regressed: 'Your spine is still tilting toward the target at the top — same drill, one focus.',
    same: 'Your spine tilt at the top is about the same as last time.',
  },
  over_the_top_deg: {
    improved: 'Your downswing is tracking more on-plane than last time.',
    regressed: 'Your downswing is still coming over the top — keep at the drill.',
    same: 'Your downswing path is about the same as last time.',
  },
  early_extension_cm: {
    improved: 'You’re holding your posture better through impact than last time.',
    regressed: 'Your hips are still pushing toward the ball — stay with the drill.',
    same: 'Your hip movement through impact is about the same as last time.',
  },
};

const TITLES: Record<RecheckTone, string> = {
  improved: 'You’re improving',
  regressed: 'Let’s keep at it',
  same: 'Holding steady',
};

function formatValue(v: number, unit: MetricMeta['unit']): string {
  switch (unit) {
    case 'deg':
      return `${Math.round(v)}°`;
    case 'cm':
      return `${Math.round(v)} cm`;
    case 'ratio':
      return `${v.toFixed(1)}:1`;
    case 'fraction':
      return `${Math.round(v * 100)}%`;
    case 'seconds':
      return `${v.toFixed(2)}s`;
    case 'count':
      return `${Math.round(v)}`;
    default:
      return `${v}`;
  }
}

function genericDetail(label: string, tone: RecheckTone): string {
  switch (tone) {
    case 'improved':
      return `Your ${label.toLowerCase()} moved the right way since last time.`;
    case 'regressed':
      return `Your ${label.toLowerCase()} moved the wrong way — let’s stick with the drill.`;
    default:
      return `Your ${label.toLowerCase()} is about the same as last time.`;
  }
}

/**
 * Turn a measured `DrillRecheck` into report copy. `improved` is the worker's
 * direction-aware verdict; we add a "same" band so a tiny change doesn't read as progress.
 */
export function describeRecheck(recheck: DrillRecheck): RecheckCopy {
  const meta = METRIC_META[recheck.targetMetricKey];
  const drill = DRILLS[recheck.drillId];
  const drillTitle = drill ? drill.title : null;

  // Unknown metric (shouldn't happen — worker + app share the catalogue): degrade safely.
  if (!meta) {
    const tone: RecheckTone = recheck.improved ? 'improved' : 'same';
    return {
      tone,
      title: TITLES[tone],
      detail: genericDetail('that move', tone),
      drillTitle,
      movement: null,
    };
  }

  const magnitude = Math.abs(recheck.delta);
  const meaningful = magnitude >= (CHANGE_EPS[meta.unit] ?? 0);
  const tone: RecheckTone = !meaningful ? 'same' : recheck.improved ? 'improved' : 'regressed';

  const detail = PHRASES[recheck.targetMetricKey]?.[tone] ?? genericDetail(meta.label, tone);

  // Reliable metrics may show the raw before→after numbers; approximate ones stay
  // qualitative (friendly ranges only, never a precise degree).
  const movement =
    meta.reliabilityTag === 'reliable'
      ? {
          previous: formatValue(recheck.previousValue, meta.unit),
          current: formatValue(recheck.currentValue, meta.unit),
        }
      : null;

  return { tone, title: TITLES[tone], detail, drillTitle, movement };
}
