"""The 8 canonical swing events + phase-window resolution.

Mirrors app/src/domain/events.ts. EVENT_ORDER must match SWING_EVENTS so the
report's phase scrubber and the fault-highlight windows line up with the worker.
"""

from __future__ import annotations

from typing import Literal, Optional

SwingEventName = Literal[
    "address",
    "toe_up",
    "mid_backswing",
    "top",
    "mid_downswing",
    "impact",
    "mid_follow_through",
    "finish",
]

SWING_EVENTS: tuple[SwingEventName, ...] = (
    "address",
    "toe_up",
    "mid_backswing",
    "top",
    "mid_downswing",
    "impact",
    "mid_follow_through",
    "finish",
)

EVENT_LABELS: dict[str, str] = {
    "address": "Address",
    "toe_up": "Toe-up",
    "mid_backswing": "Mid-backswing",
    "top": "Top",
    "mid_downswing": "Mid-downswing",
    "impact": "Impact",
    "mid_follow_through": "Mid-follow-through",
    "finish": "Finish",
}


def event_order(name: str) -> int:
    return SWING_EVENTS.index(name)  # type: ignore[arg-type]


def resolve_phase_window(
    events: dict[str, dict],
    start: str,
    end: str,
) -> Optional[dict]:
    """Resolve an inclusive [start,end] event window to time + frame ranges.

    `events` is keyed by event name -> {frameIndex, t, ...}. Returns None if
    either boundary event is missing (the app degrades to words-only).
    """
    a = events.get(start)
    b = events.get(end)
    if a is None or b is None:
        return None
    return {
        "startT": min(a["t"], b["t"]),
        "endT": max(a["t"], b["t"]),
        "startFrame": min(a["frameIndex"], b["frameIndex"]),
        "endFrame": max(a["frameIndex"], b["frameIndex"]),
    }
