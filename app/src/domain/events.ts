/**
 * The 8 canonical swing events (key frames), in temporal order, plus small helpers
 * for resolving a phase window to a time/frame range. Mirrors the worker's
 * EVENT_ORDER so the report's phase scrubber and the fault-highlight windows line up.
 */

import type { SwingEvent, SwingEventName } from './types';

export const SWING_EVENTS: readonly SwingEventName[] = [
  'address',
  'toe_up',
  'mid_backswing',
  'top',
  'mid_downswing',
  'impact',
  'mid_follow_through',
  'finish',
] as const;

export const EVENT_LABELS: Record<SwingEventName, string> = {
  address: 'Address',
  toe_up: 'Toe-up',
  mid_backswing: 'Mid-backswing',
  top: 'Top',
  mid_downswing: 'Mid-downswing',
  impact: 'Impact',
  mid_follow_through: 'Mid-follow-through',
  finish: 'Finish',
};

export function eventOrder(name: SwingEventName): number {
  return SWING_EVENTS.indexOf(name);
}

export function findEvent(
  events: SwingEvent[],
  name: SwingEventName,
): SwingEvent | undefined {
  return events.find((e) => e.name === name);
}

/**
 * Resolve an inclusive [start,end] event window to time and frame ranges using the
 * detected events. Returns null if either boundary event was not detected.
 */
export function resolvePhaseWindow(
  events: SwingEvent[],
  start: SwingEventName,
  end: SwingEventName,
): { startT: number; endT: number; startFrame: number; endFrame: number } | null {
  const a = findEvent(events, start);
  const b = findEvent(events, end);
  if (!a || !b) return null;
  return {
    startT: Math.min(a.t, b.t),
    endT: Math.max(a.t, b.t),
    startFrame: Math.min(a.frameIndex, b.frameIndex),
    endFrame: Math.max(a.frameIndex, b.frameIndex),
  };
}
