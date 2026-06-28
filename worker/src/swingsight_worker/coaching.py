"""The interpretation layer (spec §9 Stage 6) — the ONE non-deterministic step.

Governing law: **CV measures. The AI explains. The fault library localises.** This
module turns the already-measured swing into encouraging, plain-language coaching. It
runs AFTER the deterministic measurement has been written (process.py), writes only the
`coaching` jsonb column, and is deliberately kept OUT of serialize.measurement_json and
run_local.py so the Phase-3 determinism checkpoint stays byte-identical.

What the LLM is allowed to do (and what is enforced here, not just asked of it):
  - It may SELECT one fault, but ONLY from the open gates the CV opened (the fired,
    adequately-confident FaultEvaluations — the same `eligible` set as
    gating.pick_primary_fault). A chosen fault outside that set is rejected.
  - It writes ONLY language: a headline, a root-cause "why", an optional ball-flight
    tendency, and a drill chosen from the fault's own vetted drill list.
  - Any score / joint index / frame number it might emit is impossible to express in the
    schema and is therefore discarded by construction.

Every failure path — no API key, API error, out-of-schema output, low model confidence,
a fault outside the open gates — degrades to a DETERMINISTIC TEMPLATE built from the
gated primary fault's headlineTemplate/whyTemplate (with the measured {value} filled) and
the first of its drills. The product always reaches "measured, explained simply"; the
score shown to the user is always the worker's deterministic SwingScore, never the LLM's.

The provider is config, not code (settings.coaching_provider / coaching_model), so the
model can be A/B'd or swapped without touching the report.
"""

from __future__ import annotations

import base64
import logging
from typing import Optional

from pydantic import BaseModel, Field

from .config import Settings
from .domain.fault_library import DRILLS, FAULT_LIBRARY, find_fault
from .domain.gating import LOW_CONFIDENCE
from .pipeline.types import MeasurementResult

logger = logging.getLogger("swingsight.worker.coaching")

# Below this self-reported model confidence we don't trust the LLM's selection and fall
# back to the deterministic template for the same (CV-chosen) primary fault.
MIN_LLM_CONFIDENCE = 0.4

# Cap the model's output so a runaway generation can't bloat cost/latency.
_MAX_TOKENS = 600
_MAX_HEADLINE = 140
_MAX_WHY = 600
_MAX_CHAIN = 600
_MAX_BALL_FLIGHT = 240


# ---------------------------------------------------------------------------
# The constrained output schema. The LLM can ONLY express language + a selection;
# it has no field for a score, a joint, or a frame, so it cannot emit one.
# ---------------------------------------------------------------------------


class LlmCoaching(BaseModel):
    """What the model is allowed to return (validated at the tool-call layer)."""

    chosen_fault_id: str = Field(
        description="The id of the single priority fault — MUST be one of the open gates."
    )
    headline: str = Field(description="One short sentence: the one thing to work on.")
    why: str = Field(
        description="1-3 sentences, root cause to effect, plain and encouraging."
    )
    chain: Optional[str] = Field(
        default=None,
        description="2-4 short sentences: how the ONE selected fault links to the OTHER "
        "things THIS swing's measurements show, across the swing phases. Language only, "
        "grounded ONLY in the provided measurements — invent no numbers and name no second "
        "fault as a diagnosis.",
    )
    drill_id: str = Field(
        description="One drill id from the chosen fault's eligible drills."
    )
    ball_flight_note: Optional[str] = Field(
        default=None,
        description="Optional typical shot tendency, phrased as a tendency. Null if not useful.",
    )
    confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="0-1 confidence that this is the right priority fault and explanation.",
    )


class LlmObservations(BaseModel):
    """OBSERVATIONS mode — NO catalogued fault fired, so there is nothing to diagnose. The
    model gives a hedged, encouraging read of what the measurements + the annotated frames
    actually show. It still may NOT assert a catalogued fault as confirmed, and has no field
    for a score / joint / frame, so it cannot emit one."""

    headline: str = Field(description="One short, encouraging sentence summarising the swing.")
    summary: str = Field(description="1-2 plain, encouraging sentences: the overall read.")
    observations: list[str] = Field(
        default_factory=list,
        description="1-3 short, HEDGED watch-outs. Each must be grounded in a measurement that "
        "is outside its ideal range OR in something clearly visible in the frames (say which). "
        "Describe the ACTUAL direction of the deviation; never assert a catalogued fault.",
    )
    whats_working: Optional[str] = Field(
        default=None,
        description="One short sentence on what looks good (a metric that is in range).",
    )
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# Frozen system prompt (built once from the fault library + drills so it can never
# drift from the contract, and is byte-stable for prompt caching).
# ---------------------------------------------------------------------------


def _build_system_prompt() -> str:
    parts: list[str] = []
    parts.append(
        "You are SwingSight's golf-swing coaching assistant.\n\n"
        "A computer-vision system has ALREADY measured this swing and decided which faults "
        "are geometrically present. Your only job is to interpret those measurements into "
        "encouraging, plain-language coaching. You never measure anything from the images, "
        "and you never decide the numbers."
    )
    parts.append(
        "Hard rules (these are enforced in code; output that breaks them is discarded):\n"
        "- Select EXACTLY ONE fault, and ONLY from the \"open gates\" listed in the user "
        "message. Never name a fault that is not in that list. Never invent a fault.\n"
        "- Pick EXACTLY ONE drill, and ONLY from the chosen fault's eligible drills.\n"
        "- Never output a joint, a body-landmark index, a frame number, or a score — those "
        "come from the measurement layer, not from you.\n"
        "- No medical, injury, or anatomical-risk claims.\n"
        "- Hedge on any metric tagged \"approximate\" (say \"tends to\", \"around\"); never "
        "state an approximate value as an exact figure.\n"
        "- \"Lead\" and \"trail\" are handedness-relative. The user message states the "
        "golfer's handedness — mirror ALL left/right and lead/trail language to match it.\n"
        "- Keep the \"why\" to 1-3 short sentences: name the cause, then the effect, in "
        "language a weekend golfer understands.\n"
        "- The \"chain\" explains how the ONE fault you selected knocks on through the rest "
        "of the swing — link it to the OTHER measurements provided (tempo, follow-through, "
        "balance, turn, etc.), 2-4 short sentences. Ground every link ONLY in the provided "
        "measurements; do NOT invent a number and do NOT introduce a second fault as a "
        "diagnosis. If the measurements don't support a real chain, give one sentence on the "
        "fault's main downstream effect.\n"
        "- Some open gates are marked \"tentative\": true — an APPROXIMATE 2D proxy the vision "
        "system is not confident enough to assert as a fault. If you select a tentative gate, "
        "hedge strongly (\"tends to look like\", \"it may be\", \"worth keeping an eye on\"), "
        "frame it as an observation rather than a diagnosis, and still offer an encouraging "
        "drill. Never present a tentative gate as a confirmed fault.\n"
        "- The optional ball-flight note is a TENDENCY, not a certainty (\"often\", \"tends to\")."
    )

    lib_lines = ["Fault library (the cause->effect scaffold to write from — do not quote verbatim):"]
    for f in FAULT_LIBRARY:
        view = "/".join(f.views)
        drills = ", ".join(f"{d} ({DRILLS[d].title})" for d in f.drill_ids if d in DRILLS)
        ball = f" Ball-flight tendency: {f.ball_flight_hook}" if f.ball_flight_hook else ""
        lib_lines.append(
            f"- {f.id} ({f.name}; view {view}): {f.explanation_hook}{ball} "
            f"Eligible drills: {drills}."
        )
    parts.append("\n".join(lib_lines))

    drill_lines = ["Drill catalogue (the drill_id must be one of these):"]
    for d in DRILLS.values():
        first = d.steps[0] if d.steps else ""
        drill_lines.append(f"- {d.id}: {d.title} — {first}")
    parts.append("\n".join(drill_lines))

    parts.append(
        "Output fields:\n"
        "- chosen_fault_id: the id of the single fault you selected (one of the open gates).\n"
        "- headline: one short sentence, the one thing to work on.\n"
        "- why: 1-3 sentences, root cause -> effect, encouraging.\n"
        "- chain: 2-4 sentences on how that one fault cascades through the rest of the swing, "
        "grounded only in the provided measurements.\n"
        "- ball_flight_note: optional shot tendency phrased as a tendency, or null.\n"
        "- drill_id: one drill id from the chosen fault's eligible drills.\n"
        "- confidence: 0.0-1.0, your confidence this is the right priority fault and explanation."
    )
    return "\n\n".join(parts)


SYSTEM_PROMPT = _build_system_prompt()


def _build_observations_system_prompt() -> str:
    """OBSERVATIONS mode prompt — used when NO catalogued fault fired. The model gives an
    honest, hedged read of what the swing's measurements + frames show, so the report is
    useful even without a flagged fault, WITHOUT inventing a fault or a number."""
    parts: list[str] = []
    parts.append(
        "You are SwingSight's golf-swing coaching assistant, in OBSERVATIONS mode.\n\n"
        "The computer-vision system measured this swing but NONE of its catalogued faults "
        "fired — so there is no diagnosed fault. Your job is to give the golfer an honest, "
        "encouraging read of what their measurements (and the annotated frames) actually show, "
        "so the report is still useful. You never measure anything yourself and you never "
        "invent a named fault."
    )
    parts.append(
        "Hard rules (enforced in code; output that breaks them is discarded):\n"
        "- Do NOT assert any catalogued fault as confirmed (chicken wing, reverse spine, over "
        "the top, early extension, head movement). Those come only from the measurement layer, "
        "which flagged none here. You may note a gentle TENDENCY, heavily hedged.\n"
        "- Ground every watch-out in a provided measurement that is OUTSIDE its ideal range, OR "
        "in something clearly visible in the frames — and when it is only from the frames, say "
        "so ('from the frames it looks like…').\n"
        "- Describe the ACTUAL direction of each deviation using the metric guide below; never "
        "force it into the nearest fault. E.g. a NEGATIVE downswing-path value means the club "
        "works from the INSIDE / too shallow — the OPPOSITE of over the top; never call that "
        "'over the top'.\n"
        "- Hedge everything ('tends to', 'leaning toward', 'worth keeping an eye on'). These are "
        "observations, not a diagnosis.\n"
        "- If the message lists NEAR-MISSES (a fault approaching but not over its threshold), you "
        "MAY flag ONE as 'right on the edge of …' or 'starting to …' — a watch-out that has NOT "
        "crossed the line. Never say the golfer HAS that fault, and never praise a near-miss "
        "metric as 'right where it should be'.\n"
        "- No raw numbers in the prose (no degrees/cm/percent) and never a joint, frame, or score.\n"
        "- 'Lead'/'trail' are handedness-relative; mirror them to the stated handedness.\n"
        "- Keep it short and encouraging, and ALWAYS include what is working."
    )
    parts.append(
        "Metric guide (direction → meaning; ideal in brackets):\n"
        "- Downswing path [0]: positive = swinging OVER the top / across to the outside; "
        "negative = dropping to the INSIDE / too shallow.\n"
        "- Shoulder turn [~90]: low = under-turning (short coil); high = over-turning.\n"
        "- X-factor [~45]: low = little separation between shoulders and hips; high = a lot.\n"
        "- Hip thrust / early extension [0, lower better]: higher = hips drifting toward the "
        "ball / standing up out of posture.\n"
        "- Tempo ratio [~3:1]: lower = quick/rushed transition; higher = a slower, longer "
        "backswing relative to the downswing.\n"
        "- Backswing time [shorter-is-snappier]: longer = a slower takeaway.\n"
        "- Follow-through completion [high better]: low = a short, unfinished finish.\n"
        "- Balance [high better]: low = swaying / losing the base through the swing.\n"
        "- Head sway / lift [low better]: higher = the head moving off the ball."
    )
    parts.append(
        "Output fields:\n"
        "- headline: one short, encouraging sentence summarising the swing.\n"
        "- summary: 1-2 sentences, the overall read.\n"
        "- observations: 1-3 hedged watch-outs, each tied to a real out-of-range measurement or "
        "a clear visual in the frames, described in the correct direction.\n"
        "- whats_working: one short sentence on what looks good.\n"
        "- confidence: 0.0-1.0."
    )
    return "\n\n".join(parts)


OBSERVATIONS_SYSTEM_PROMPT = _build_observations_system_prompt()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _metric_by_key(result: MeasurementResult, key: str) -> Optional[dict]:
    for m in result.metrics:
        if m["key"] == key:
            return m
    return None


def _format_value(metric: Optional[dict]) -> str:
    """Format a measured value for a template's {value} slot. Degrees/cm are shown whole;
    everything else to one decimal. (The template strings supply the unit text.)"""
    if metric is None:
        return "—"
    value = float(metric["value"])
    if metric.get("unit") in ("deg", "cm"):
        return str(int(round(value)))
    return str(round(value, 1))


def _open_gate_ids(result: MeasurementResult) -> list[str]:
    """The fault ids the LLM may choose from = the eligible FaultEvaluations (mirror of
    gating.pick_primary_fault's filter: fired, adequately confident, status ok, AND
    claim-eligible). soft_only faults are excluded here too, so the LLM can never be
    handed a crude unvalidated proxy as a selectable fault (spec §13.1)."""
    return [
        e["faultId"]
        for e in result.faults
        if e["fired"]
        and e["confidence"] >= LOW_CONFIDENCE
        and e["status"] == "ok"
        and e.get("claimEligible", True)
    ]


def _eval_for(result: MeasurementResult, fault_id: str) -> Optional[dict]:
    for e in result.faults:
        if e["faultId"] == fault_id:
            return e
    return None


def _clamp(s: Optional[str], n: int) -> Optional[str]:
    if s is None:
        return None
    s = s.strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


# ---------------------------------------------------------------------------
# Deterministic template coaching (the always-available floor)
# ---------------------------------------------------------------------------


def _template_for_fault(
    result: MeasurementResult, fault_id: str, tentative: bool = False
) -> dict:
    entry = find_fault(fault_id)
    if entry is None:
        return _template_no_fault()
    metric = _metric_by_key(result, entry.gate.metric_key)
    why = entry.why_template.format(value=_format_value(metric))
    coaching: dict = {
        "source": "template",
        "chosenFaultId": entry.id,
        "headline": entry.headline_template,
        "why": why,
        # The library's explanation_hook is itself a cause->effect sentence, so the
        # always-available floor still carries an honest chain (no fabricated data).
        "chain": entry.explanation_hook,
        "drillId": entry.drill_ids[0] if entry.drill_ids else None,
    }
    if tentative:
        coaching["tentative"] = True
    if entry.ball_flight_hook:
        coaching["ballFlightNote"] = entry.ball_flight_hook
    return coaching


def _template_no_fault() -> dict:
    """No gate cleared the bar — there is no fault to select, so we don't fabricate one."""
    return {
        "source": "template",
        "chosenFaultId": None,
        "headline": "Looking solid",
        "why": (
            "We didn't flag a clear priority fault on this swing. Keep filming so we can "
            "track your tempo and consistency over time."
        ),
        "drillId": None,
    }


# ---------------------------------------------------------------------------
# The LLM call (provider-abstracted via config)
# ---------------------------------------------------------------------------


def _handedness_line(handedness: str) -> str:
    if handedness == "LH":
        return (
            "Left-handed golfer: the LEAD side is the RIGHT arm/hip and the TRAIL side is "
            "the LEFT. Mirror all directional language accordingly."
        )
    return (
        "Right-handed golfer: the LEAD side is the LEFT arm/hip and the TRAIL side is the RIGHT."
    )


def _metrics_payload(result: MeasurementResult) -> list[dict]:
    """The authoritative measurement snippet handed to the model (no internal confidence
    plumbing — just what's needed to write and to hedge)."""
    return [
        {
            "key": m["key"],
            "label": m["label"],
            "value": m["value"],
            "unit": m["unit"],
            "status": m["status"],
            "reliability": m["reliabilityTag"],
            "inRange": m["inRange"],
            "ideal": m["ideal"],
            "friendlyRange": m["friendlyRange"],
        }
        for m in result.metrics
    ]


def _open_gates_payload(
    result: MeasurementResult, open_ids: list[str], tentative: bool = False
) -> list[dict]:
    out = []
    for fid in open_ids:
        entry = find_fault(fid)
        ev = _eval_for(result, fid)
        if entry is None or ev is None:
            continue
        metric = _metric_by_key(result, entry.gate.metric_key)
        out.append(
            {
                "faultId": fid,
                "name": entry.name,
                "severity": ev["severityBand"],
                "drivingMetric": entry.gate.metric_key,
                "measuredValue": metric["value"] if metric else None,
                "unit": metric["unit"] if metric else None,
                "eligibleDrillIds": list(entry.drill_ids),
                "tentative": tentative,
            }
        )
    return out


def _build_user_content(
    result: MeasurementResult,
    keyframes,
    view: str,
    handedness: str,
    open_ids: list[str],
    tentative: bool = False,
) -> list[dict]:
    import json

    tentative_note = (
        "\n\nNOTE: the single open gate below is a TENTATIVE observation from an APPROXIMATE "
        "2D proxy — the vision system is not confident enough to assert it as a fault. Select "
        "it, but hedge strongly and frame it as something to keep an eye on, not a diagnosis."
        if tentative
        else ""
    )
    header = (
        f"View: {view}. {_handedness_line(handedness)}\n\n"
        "These are the AUTHORITATIVE measurements computed by the vision system — do NOT "
        "re-measure them from the images:\n"
        f"{json.dumps(_metrics_payload(result), separators=(',', ':'))}\n\n"
        "OPEN GATES — you may select exactly one of these chosen_fault_id values, and your "
        "drill_id must be one of that fault's eligibleDrillIds:\n"
        f"{json.dumps(_open_gates_payload(result, open_ids, tentative), separators=(',', ':'))}"
        f"{tentative_note}\n\n"
        f"The {len(keyframes)} images below are the key frames of THIS swing with the measured "
        "skeleton drawn on, one per swing event (labelled). Use them only to see the geometry "
        "the measurements already describe."
    )
    content: list[dict] = [{"type": "text", "text": header}]
    for kf in keyframes:
        content.append({"type": "text", "text": f"Event: {kf.event_name}"})
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": base64.standard_b64encode(kf.jpeg).decode("ascii"),
                },
            }
        )
    return content


def _call_anthropic(
    settings: Settings,
    result: MeasurementResult,
    keyframes,
    view: str,
    handedness: str,
    open_ids: list[str],
    tentative: bool = False,
) -> Optional[LlmCoaching]:
    """Constrained structured output via Claude Haiku 4.5. Returns the parsed object, or
    None on any error (the caller then falls back to the template)."""
    from anthropic import Anthropic

    client = Anthropic(api_key=settings.anthropic_api_key)
    resp = client.messages.parse(
        model=settings.coaching_model,
        max_tokens=_MAX_TOKENS,
        temperature=0,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                # Cache the frozen rubric + drills + rules; only the per-swing user
                # message (after this breakpoint) varies.
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": _build_user_content(
                    result, keyframes, view, handedness, open_ids, tentative
                ),
            }
        ],
        output_format=LlmCoaching,
    )
    return resp.parsed_output


# ---------------------------------------------------------------------------
# Observations mode (no fault fired) — a hedged read of the measurements + frames
# ---------------------------------------------------------------------------


# A not-yet-fired fault whose value is within this fraction of its gate is "approaching"
# — surfaced to observations mode so the AI can flag it as a watch-out (hedged), instead of
# the metric reading as plainly "fine" just because it's a hair under the line.
NEAR_MISS_FRACTION = 0.8


def _gate_proximity(value: float, gate) -> float:
    """How close a NOT-yet-fired value is to opening its gate, in [0,1] (1 = at the
    threshold, approaching from the correct side). 0 when it isn't approaching at all (wrong
    side, or far away). Only the 'approach toward firing' direction counts — a value on the
    opposite side of an 'exceeds' gate (e.g. a negative over_the_top) is NOT a near-miss."""
    op = gate.operator
    t = gate.threshold
    if op == "exceeds":
        thr = t.get("min", 0) or 0
        if thr <= 0 or value <= 0:
            return 0.0
        return min(1.0, value / thr)
    if op == "magnitude_at_least":
        thr = t.get("value", 0) or 0
        if thr <= 0:
            return 0.0
        return min(1.0, abs(value) / thr)
    # 'below' / 'outside' have no single clear approach direction for the launch faults; skip.
    return 0.0


def _near_miss_faults(result: MeasurementResult) -> list[dict]:
    """In-view faults that did NOT fire but sit within NEAR_MISS_FRACTION of their gate — the
    'right on the edge of X' watch-outs observations mode would otherwise miss (e.g. early
    extension at 5.98 cm against a 6.0 cm gate)."""
    out: list[dict] = []
    for e in result.faults:
        if e["fired"] or e["status"] != "ok":
            continue
        entry = find_fault(e["faultId"])
        if entry is None:
            continue
        if _gate_proximity(float(e["value"]), entry.gate) < NEAR_MISS_FRACTION:
            continue
        metric = _metric_by_key(result, entry.gate.metric_key)
        out.append(
            {
                "faultId": e["faultId"],
                "name": entry.name,
                "drivingMetric": entry.gate.metric_key,
                # The plain-language tendency this is APPROACHING (not present).
                "approachingTendency": entry.explanation_hook,
                "reliability": metric["reliabilityTag"] if metric else "approximate",
            }
        )
    return out


def _observation_metrics_payload(result: MeasurementResult) -> list[dict]:
    """The measured (status 'ok') metrics handed to observations mode, with the context the
    model needs to read each deviation honestly (value vs ideal/friendlyRange + inRange)."""
    return [
        {
            "key": m["key"],
            "label": m["label"],
            "value": m["value"],
            "unit": m["unit"],
            "ideal": m["ideal"],
            "friendlyRange": m["friendlyRange"],
            "inRange": m["inRange"],
            "reliability": m["reliabilityTag"],
        }
        for m in result.metrics
        if m["status"] == "ok"
    ]


def _build_observations_content(
    result: MeasurementResult, keyframes, view: str, handedness: str
) -> list[dict]:
    import json

    near_misses = _near_miss_faults(result)
    near_miss_block = (
        "\n\nNEAR-MISSES — these faults did NOT fire but are APPROACHING their threshold; you "
        "MAY gently flag ONE as 'right on the edge of …' / 'starting to …', clearly as a "
        "watch-out that has NOT crossed the line, never as a present fault:\n"
        f"{json.dumps(near_misses, separators=(',', ':'))}"
        if near_misses
        else ""
    )
    header = (
        f"View: {view}. {_handedness_line(handedness)}\n\n"
        "No catalogued fault fired on this swing. These are the AUTHORITATIVE measurements "
        "(do NOT re-measure them); ground your observations in the ones OUTSIDE their ideal "
        "range, and read each deviation in the correct direction per the metric guide:\n"
        f"{json.dumps(_observation_metrics_payload(result), separators=(',', ':'))}"
        f"{near_miss_block}\n\n"
        f"The {len(keyframes)} annotated frames below are this swing's key phases (labelled). "
        "Look at them to make your observations specific and to notice qualitative things the "
        "metrics don't capture — but anything you can ONLY see in the frames must be hedged as "
        "a visual impression ('from the frames it looks like…'), never stated as a measured fault."
    )
    content: list[dict] = [{"type": "text", "text": header}]
    for kf in keyframes:
        content.append({"type": "text", "text": f"Event: {kf.event_name}"})
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": base64.standard_b64encode(kf.jpeg).decode("ascii"),
                },
            }
        )
    return content


def _call_anthropic_observations(
    settings: Settings, result: MeasurementResult, keyframes, view: str, handedness: str
) -> Optional[LlmObservations]:
    from anthropic import Anthropic

    client = Anthropic(api_key=settings.anthropic_api_key)
    resp = client.messages.parse(
        model=settings.coaching_model,
        max_tokens=_MAX_TOKENS,
        temperature=0,
        system=[
            {
                "type": "text",
                "text": OBSERVATIONS_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {"role": "user", "content": _build_observations_content(result, keyframes, view, handedness)}
        ],
        output_format=LlmObservations,
    )
    return resp.parsed_output


def _observations_result(parsed: LlmObservations) -> dict:
    notes = [n for n in (_clamp(o, _MAX_WHY) for o in (parsed.observations or [])) if n]
    coaching: dict = {
        "source": "observations",
        "chosenFaultId": None,
        "headline": _clamp(parsed.headline, _MAX_HEADLINE) or "Here's what we saw",
        "why": _clamp(parsed.summary, _MAX_WHY) or "",
        "observations": notes[:3],
        "drillId": None,
        "llmConfidence": round(float(parsed.confidence), 3),
    }
    working = _clamp(parsed.whats_working, _MAX_WHY)
    if working:
        coaching["whatsWorking"] = working
    return coaching


def _generate_observations(
    settings: Settings, result: MeasurementResult, keyframes, view: str, handedness: str
) -> dict:
    """No fault fired -> give a hedged OBSERVATIONS read via the LLM (it looks at the frames).
    The template floor stays the honest "Looking solid" when there's no key or the call fails —
    we never fabricate observations from a template."""
    provider = (settings.coaching_provider or "").lower()
    if provider != "anthropic" or not settings.anthropic_api_key:
        logger.info("coaching: no fault + no key -> template (no fault)")
        return _template_no_fault()
    try:
        parsed = _call_anthropic_observations(settings, result, keyframes, view, handedness)
    except Exception:  # noqa: BLE001 — best-effort; the template always covers it
        logger.exception("coaching: observations call failed -> template")
        return _template_no_fault()
    if parsed is None:
        return _template_no_fault()
    out = _observations_result(parsed)
    logger.info("coaching: source=observations (%d notes)", len(out["observations"]))
    return out


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def generate_coaching(
    settings: Settings,
    result: MeasurementResult,
    keyframes,
    view: str,
    handedness: str,
) -> dict:
    """Produce the CoachingResult (camelCase dict for the `coaching` jsonb). Never raises —
    every failure path returns a deterministic template so the product always degrades to
    "measured, explained simply"."""

    open_ids = _open_gate_ids(result)

    # Two coaching tiers, both still bound to gates the CV opened:
    #   - a claim-eligible gate fired -> a confident verdict (the original path).
    #   - else a soft_only fault fired -> a TENTATIVE observation, hedged (never a verdict).
    #   - else nothing fired -> don't fabricate.
    if open_ids:
        tentative = False
        selectable_ids = open_ids
        primary_id = result.primary_fault_id or open_ids[0]
    elif result.observation_fault_id:
        tentative = True
        selectable_ids = [result.observation_fault_id]
        primary_id = result.observation_fault_id
    else:
        # No fault gate fired at all. Rather than the bare "Looking solid" template, give an
        # honest, hedged OBSERVATIONS read of what the measurements + the frames actually show
        # (the LLM looks at the keyframes here). Never asserts a catalogued fault; degrades to
        # the "Looking solid" template if there's no key or the call fails.
        return _generate_observations(settings, result, keyframes, view, handedness)

    provider = (settings.coaching_provider or "").lower()
    if provider != "anthropic" or not settings.anthropic_api_key:
        logger.info("coaching: provider=%s key=%s -> template", provider, bool(settings.anthropic_api_key))
        return _template_for_fault(result, primary_id, tentative=tentative)

    try:
        parsed = _call_anthropic(
            settings, result, keyframes, view, handedness, selectable_ids, tentative
        )
    except Exception:  # noqa: BLE001 — the LLM is best-effort; the template always covers it
        logger.exception("coaching: LLM call failed -> template")
        return _template_for_fault(result, primary_id, tentative=tentative)

    if parsed is None:
        logger.warning("coaching: LLM returned no parsed output -> template")
        return _template_for_fault(result, primary_id, tentative=tentative)

    # Guardrail: the chosen fault MUST be one the CV opened. (This is the load-bearing
    # check — a fault outside the open gates is the one thing we never let through.)
    if parsed.chosen_fault_id not in selectable_ids:
        logger.warning(
            "coaching: LLM chose '%s' not in selectable gates %s -> template",
            parsed.chosen_fault_id, selectable_ids,
        )
        return _template_for_fault(result, primary_id, tentative=tentative)

    # Low self-reported confidence -> keep the same (CV) fault but use template language.
    if parsed.confidence < MIN_LLM_CONFIDENCE:
        logger.info(
            "coaching: LLM confidence %.2f < %.2f -> template", parsed.confidence, MIN_LLM_CONFIDENCE
        )
        return _template_for_fault(result, parsed.chosen_fault_id, tentative=tentative)

    entry = find_fault(parsed.chosen_fault_id)
    assert entry is not None  # guaranteed: chosen_fault_id ∈ open_ids ⊆ library

    # Drill must belong to the chosen fault; if the model slipped, coerce to a valid one
    # rather than discard otherwise-good language.
    drill_id = parsed.drill_id
    if drill_id not in entry.drill_ids:
        drill_id = entry.drill_ids[0] if entry.drill_ids else None

    coaching: dict = {
        "source": "llm",
        "chosenFaultId": parsed.chosen_fault_id,
        "headline": _clamp(parsed.headline, _MAX_HEADLINE) or entry.headline_template,
        "why": _clamp(parsed.why, _MAX_WHY)
        or entry.why_template.format(value=_format_value(_metric_by_key(result, entry.gate.metric_key))),
        # Chain falls back to the library's own cause->effect hook, never to nothing.
        "chain": _clamp(parsed.chain, _MAX_CHAIN) or entry.explanation_hook,
        "drillId": drill_id,
        "llmConfidence": round(float(parsed.confidence), 3),
    }
    if tentative:
        coaching["tentative"] = True
    note = _clamp(parsed.ball_flight_note, _MAX_BALL_FLIGHT)
    if note:
        coaching["ballFlightNote"] = note

    logger.info(
        "coaching: source=llm fault=%s drill=%s conf=%.2f tentative=%s",
        coaching["chosenFaultId"], coaching["drillId"], parsed.confidence, tentative,
    )
    return coaching
