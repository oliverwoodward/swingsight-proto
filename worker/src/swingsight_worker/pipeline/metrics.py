"""Metric computation (spec §8 step 7 + §15; PRD Phase 3 item 6).

Computes the casual-golfer metric set defined by METRIC_META, view-aware and
reliability-tagged. All geometry is done in PIXEL space (normalised coords times the
playback dimensions, so x/y aspect is correct), and physical distances are converted
to centimetres via a per-swing body-scale reference (median shoulder width ≈ 40 cm),
which makes them robust to how far the golfer stands from the camera.

Reliability is honest (spec §15):
  * reliable    — time-based or 2D-displacement metrics (tempo, head, lead arm, …).
  * approximate — 2D projections of a 3D quantity (turn, X-factor, plane). Surfaced
    as ranges, never precise degrees; their confidence is damped by the reliability
    factor in the score and the gate.
Every metric carries a confidence = joint-visibility × event-localisation × fps
normalisation, and a status (ok / low_confidence / implausible) that decides whether
it may drive a fault.
"""

from __future__ import annotations

import logging
import math

import numpy as np

from ..determinism import CONF_DECIMALS, METRIC_DECIMALS, q
from ..domain import keypoints as K
from ..domain.fault_library import METRIC_META
from ..domain.gating import (
    LOW_CONFIDENCE,
    assess_metric_status,
    is_in_friendly_range,
)
from .types import NormalizedClip, PoseSeries, SwingEvents

logger = logging.getLogger("swingsight.worker.metrics")

ASSUMED_SHOULDER_WIDTH_CM = 40.0


def _angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Interior angle ABC at vertex b, in degrees."""
    ba = a - b
    bc = c - b
    denom = (np.linalg.norm(ba) * np.linalg.norm(bc)) + 1e-9
    cosang = float(np.clip(np.dot(ba, bc) / denom, -1.0, 1.0))
    return math.degrees(math.acos(cosang))


class _Geo:
    """Pixel-space pose access + body-scale, shared by all metric computations."""

    def __init__(self, pose: PoseSeries, clip: NormalizedClip, events: SwingEvents):
        self.pose = pose
        self.clip = clip
        self.events = events.events
        self.detection_conf = events.detection_confidence
        self.W = clip.playback_width
        self.H = clip.playback_height
        self.px = pose.image[:, :, :2] * np.array([self.W, self.H])  # (T,33,2)
        self.vis = pose.image[:, :, 2]  # (T,33)
        self.handedness = None  # set by caller

        a, t = self.ev("address"), self.ev("top")
        lo, hi = min(a, t), max(a, t) + 1
        sw = np.linalg.norm(
            self.px[lo:hi, K.LEFT_SHOULDER] - self.px[lo:hi, K.RIGHT_SHOULDER], axis=1
        )
        sw = sw[sw > 1.0]
        self.shoulder_px = float(np.median(sw)) if sw.size else max(self.W * 0.15, 1.0)
        self.cm_per_px = ASSUMED_SHOULDER_WIDTH_CM / self.shoulder_px

        torso = np.linalg.norm(
            self.px[a, K.NOSE]
            - 0.5 * (self.px[a, K.LEFT_HIP] + self.px[a, K.RIGHT_HIP])
        )
        self.torso_px = float(torso) if torso > 1.0 else self.shoulder_px * 1.5

    def ev(self, name: str) -> int:
        return int(self.events[name]["frameIndex"])

    def lead(self, ref: str) -> int:
        return K.joint_ref_to_index(ref, self.handedness)

    def mid(self, ja: int, jb: int, frame: int) -> np.ndarray:
        return 0.5 * (self.px[frame, ja] + self.px[frame, jb])

    def vis_of(self, indices: list[int], frames: list[int]) -> float:
        vals = [self.vis[f, j] for f in frames for j in indices]
        return float(np.mean(vals)) if vals else 0.0


def _build(
    key: str,
    value: float,
    indices: list[int],
    frames: list[int],
    evt_conf: float,
    geo: _Geo,
) -> tuple[dict, float]:
    meta = METRIC_META[key]
    vis = geo.vis_of(indices, frames)
    engine_conf = max(0.0, min(1.0, vis * evt_conf * geo.clip.normalization_confidence))
    status = assess_metric_status(value, meta)
    if status == "ok" and engine_conf < LOW_CONFIDENCE:
        status = "low_confidence"
    in_range = is_in_friendly_range(value, meta) if status == "ok" else False
    metric = {
        "key": key,
        "label": meta.label,
        "value": q(value, METRIC_DECIMALS),
        "unit": meta.unit,
        "status": status,
        "reliabilityTag": meta.reliability_tag,
        "confidence": q(engine_conf, CONF_DECIMALS),
        "ideal": meta.ideal,
        "friendlyRange": {"min": meta.friendly_range.min, "max": meta.friendly_range.max},
        "inRange": in_range,
    }
    return metric, engine_conf


# --- individual metrics -------------------------------------------------------------

def _tempo(geo: _Geo) -> list[tuple[dict, float]]:
    a, top, imp = geo.ev("address"), geo.ev("top"), geo.ev("impact")
    ta, tt, ti = (geo.clip.timestamps[i] for i in (a, top, imp))
    backswing = max(float(tt - ta), 1e-3)
    downswing = max(float(ti - tt), 1e-3)
    evt = min(
        geo.events["address"]["confidence"],
        geo.events["top"]["confidence"],
        geo.events["impact"]["confidence"],
    )
    wri = [K.LEFT_WRIST, K.RIGHT_WRIST]
    out = []
    out.append(_build("tempo_ratio", backswing / downswing, wri, [a, top, imp], evt, geo))
    out.append(_build("backswing_seconds", backswing, wri, [a, top], evt, geo))
    return out


def _head(geo: _Geo) -> list[tuple[dict, float]]:
    a, imp = geo.ev("address"), geo.ev("impact")
    lo, hi = a, imp + 1
    nose_x = geo.px[lo:hi, K.NOSE, 0]
    nose_y = geo.px[lo:hi, K.NOSE, 1]
    sway_cm = float((nose_x.max() - nose_x.min())) * geo.cm_per_px if nose_x.size else 0.0
    lift_cm = float(geo.px[a, K.NOSE, 1] - geo.px[imp, K.NOSE, 1]) * geo.cm_per_px
    evt = min(geo.events["address"]["confidence"], geo.events["impact"]["confidence"])
    frames = list(range(lo, hi))
    return [
        _build("head_sway_cm", sway_cm, [K.NOSE], frames, evt, geo),
        _build("head_lift_cm", lift_cm, [K.NOSE], [a, imp], evt, geo),
    ]


def _lead_elbow(geo: _Geo) -> list[tuple[dict, float]]:
    imp = geo.ev("impact")
    ls, le, lw = geo.lead("lead_shoulder"), geo.lead("lead_elbow"), geo.lead("lead_wrist")
    angle = _angle(geo.px[imp, ls], geo.px[imp, le], geo.px[imp, lw])
    flexion = max(0.0, 180.0 - angle)
    evt = geo.events["impact"]["confidence"]
    return [_build("lead_elbow_flexion_impact_deg", flexion, [ls, le, lw], [imp], evt, geo)]


def _reverse_spine(geo: _Geo) -> list[tuple[dict, float]]:
    top = geo.ev("top")
    shoulder_mid = geo.mid(K.LEFT_SHOULDER, K.RIGHT_SHOULDER, top)
    pelvis_mid = geo.mid(K.LEFT_HIP, K.RIGHT_HIP, top)
    lead_hip = geo.px[top, geo.lead("lead_hip")]
    trail_hip = geo.px[top, geo.lead("trail_hip")]
    lead_dir = 1.0 if (lead_hip[0] - trail_hip[0]) >= 0 else -1.0
    dx = (shoulder_mid[0] - pelvis_mid[0]) * lead_dir  # +ve toward target = reverse
    dy_up = max(pelvis_mid[1] - shoulder_mid[1], 1e-6)
    lean_deg = math.degrees(math.atan2(dx, dy_up))
    evt = geo.events["top"]["confidence"]
    idx = [K.LEFT_SHOULDER, K.RIGHT_SHOULDER, K.LEFT_HIP, K.RIGHT_HIP]
    return [_build("reverse_spine_deg", lean_deg, idx, [top], evt, geo)]


def _over_the_top(geo: _Geo) -> list[tuple[dict, float]]:
    a, top, imp = geo.ev("address"), geo.ev("top"), geo.ev("impact")
    wri = [K.LEFT_WRIST, K.RIGHT_WRIST]
    mid_a = geo.mid(K.LEFT_WRIST, K.RIGHT_WRIST, a)
    mid_t = geo.mid(K.LEFT_WRIST, K.RIGHT_WRIST, top)
    mid_i = geo.mid(K.LEFT_WRIST, K.RIGHT_WRIST, imp)
    bs = mid_t - mid_a  # backswing hand-path vector (address -> top)
    ds = mid_i - mid_t  # downswing hand-path vector (top -> impact)
    # An on-plane downswing roughly RETRACES the backswing, so ds ≈ -bs and the loop is
    # ~0°. Over-the-top = the downswing deviates to the outside of that retrace line.
    # Signed deviation of ds from -bs; handedness flips the camera-side sign. Approximate
    # (2D, camera-side dependent) — a soft indicator, never a precise plane angle.
    ref = -bs
    cross = ref[0] * ds[1] - ref[1] * ds[0]
    dot = ref[0] * ds[0] + ref[1] * ds[1]
    signed = math.degrees(math.atan2(cross, dot))
    over = signed if geo.handedness == "RH" else -signed
    evt = min(geo.events["top"]["confidence"], geo.events["impact"]["confidence"])
    return [_build("over_the_top_deg", over, wri, [top, imp], evt, geo)]


def _early_extension(geo: _Geo) -> list[tuple[dict, float]]:
    a, imp = geo.ev("address"), geo.ev("impact")
    pelvis_a = geo.mid(K.LEFT_HIP, K.RIGHT_HIP, a)
    pelvis_i = geo.mid(K.LEFT_HIP, K.RIGHT_HIP, imp)
    wrist_a = geo.mid(K.LEFT_WRIST, K.RIGHT_WRIST, a)
    ball_dir = 1.0 if (wrist_a[0] - pelvis_a[0]) >= 0 else -1.0
    thrust_cm = float((pelvis_i[0] - pelvis_a[0]) * ball_dir) * geo.cm_per_px
    evt = min(geo.events["address"]["confidence"], geo.events["impact"]["confidence"])
    idx = [K.LEFT_HIP, K.RIGHT_HIP]
    return [_build("early_extension_cm", thrust_cm, idx, [a, imp], evt, geo)]


def _follow_through(geo: _Geo) -> list[tuple[dict, float]]:
    fin = geo.ev("finish")
    lead_w = geo.lead("lead_wrist")
    nose_y = geo.px[fin, K.NOSE, 1]
    pelvis_y = geo.mid(K.LEFT_HIP, K.RIGHT_HIP, fin)[1]
    wrist_y = geo.px[fin, lead_w, 1]
    ref_high = nose_y - 0.5 * geo.torso_px  # hands above the head = full finish
    ref_low = pelvis_y  # hands at the waist = barely past impact
    span = max(ref_low - ref_high, 1e-6)
    completion = max(0.0, min(1.2, (ref_low - wrist_y) / span))
    evt = geo.events["finish"]["confidence"]
    return [_build("follow_through_completion", completion, [lead_w, K.NOSE], [fin], evt, geo)]


def _balance(geo: _Geo) -> list[tuple[dict, float]]:
    a, fin = geo.ev("address"), geo.ev("finish")
    lo, hi = min(a, fin), max(a, fin) + 1
    center = 0.25 * (
        geo.px[lo:hi, K.LEFT_SHOULDER]
        + geo.px[lo:hi, K.RIGHT_SHOULDER]
        + geo.px[lo:hi, K.LEFT_HIP]
        + geo.px[lo:hi, K.RIGHT_HIP]
    )
    x_std = float(np.std(center[:, 0])) if center.shape[0] > 1 else 0.0
    stability = max(0.0, min(1.0, 1.0 - x_std / (0.6 * geo.shoulder_px)))
    idx = [K.LEFT_SHOULDER, K.RIGHT_SHOULDER, K.LEFT_HIP, K.RIGHT_HIP]
    return [_build("balance_stability", stability, idx, list(range(lo, hi)), geo.detection_conf, geo)]


def _turn_proxy(width_top: float, width_addr: float) -> float:
    ratio = float(np.clip(width_top / max(width_addr, 1e-6), 0.0, 1.0))
    return math.degrees(math.acos(ratio))


def _turns(geo: _Geo) -> list[tuple[dict, float]]:
    a, top = geo.ev("address"), geo.ev("top")
    sh_a = np.linalg.norm(geo.px[a, K.LEFT_SHOULDER] - geo.px[a, K.RIGHT_SHOULDER])
    sh_t = np.linalg.norm(geo.px[top, K.LEFT_SHOULDER] - geo.px[top, K.RIGHT_SHOULDER])
    hip_a = np.linalg.norm(geo.px[a, K.LEFT_HIP] - geo.px[a, K.RIGHT_HIP])
    hip_t = np.linalg.norm(geo.px[top, K.LEFT_HIP] - geo.px[top, K.RIGHT_HIP])
    # Face-on: shoulders foreshorten as they turn (width shrinks). DTL: the opposite,
    # so use the complementary projection. Either way an approximate soft indicator.
    if geo.view == "face_on":
        shoulder_turn = _turn_proxy(sh_t, sh_a)
        hip_turn = _turn_proxy(hip_t, hip_a)
    else:
        shoulder_turn = 90.0 - _turn_proxy(sh_a, sh_t)
        hip_turn = 90.0 - _turn_proxy(hip_a, hip_t)
    x_factor = max(0.0, shoulder_turn - hip_turn)
    evt = geo.events["top"]["confidence"]
    sidx = [K.LEFT_SHOULDER, K.RIGHT_SHOULDER]
    hidx = [K.LEFT_HIP, K.RIGHT_HIP]
    return [
        _build("shoulder_turn_deg", shoulder_turn, sidx, [a, top], evt, geo),
        _build("x_factor_deg", x_factor, sidx + hidx, [a, top], evt, geo),
    ]


# View -> ordered metric builders. Only in-view metrics are emitted.
_BUILDERS_FACE_ON = (_tempo, _head, _lead_elbow, _reverse_spine, _follow_through, _balance, _turns)
_BUILDERS_DTL = (_tempo, _over_the_top, _early_extension, _follow_through, _balance, _turns)


def compute_metrics(
    pose: PoseSeries, clip: NormalizedClip, events: SwingEvents, view: str, handedness: str
) -> tuple[list[dict], dict[str, float]]:
    """Return (metrics[], engine_confidence_by_key) for the analysis view."""
    geo = _Geo(pose, clip, events)
    geo.handedness = handedness
    geo.view = view
    builders = _BUILDERS_FACE_ON if view == "face_on" else _BUILDERS_DTL

    metrics: list[dict] = []
    engine_conf: dict[str, float] = {}
    for builder in builders:
        for metric, conf in builder(geo):
            metrics.append(metric)
            engine_conf[metric["key"]] = conf
    logger.info("metrics: computed %d metrics for view=%s", len(metrics), view)
    return metrics, engine_conf
