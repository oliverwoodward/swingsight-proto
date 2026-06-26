"""Run the per-fault regression over the golden set — the Phase-7 validation checkpoint.

Loads worker/validation/golden_set.json, runs the DETERMINISTIC measurement core over each
golden clip (the SAME assemble.run_measurement the determinism check and Cloud Run use — so
this reads the measurement, never perturbs it), and reports per-fault agreement + per-metric
error + the gate verdict. Exits non-zero only when a CLAIM-ELIGIBLE fault has dropped below
its documented bar (a real regression) or the manifest is malformed.

Usage:
  python -m swingsight_worker.validation.run_regression [--manifest PATH] [--clips-dir DIR]
                                                        [--json] [--out FILE] [--self-test]

  --self-test   verify the agreement/error maths on synthetic fixtures (no pose, no clips),
                so the runner's logic is checkable even where MediaPipe/clips aren't present.
  --clips-dir   where to resolve each swing's `clip` (else $SWINGSIGHT_GOLDEN_CLIPS_DIR, the
                dir of $SAMPLE_CLIP, or an absolute clip path in the manifest).

`determinism` is imported first so the single-thread env is set before numpy/MediaPipe load.
"""

from __future__ import annotations

from .. import determinism  # noqa: F401  (must be first — sets thread env on import)

import argparse
import json
import os
import sys
import tempfile

from ..domain.fault_library import FAULT_LIBRARY
from .manifest import GoldenSet, GoldenSwing, ManifestError, load_golden_set
from .regression import SwingPrediction, build_report

_DEFAULT_MANIFEST = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "validation", "golden_set.json"
)


# ---------------------------------------------------------------------------
# Clip resolution (clips are not committed; resolve them locally, gracefully)
# ---------------------------------------------------------------------------


def _candidate_dirs(clips_dir: str | None) -> list[str]:
    dirs: list[str] = []
    if clips_dir:
        dirs.append(clips_dir)
    env_dir = os.environ.get("SWINGSIGHT_GOLDEN_CLIPS_DIR")
    if env_dir:
        dirs.append(env_dir)
    sample = os.environ.get("SAMPLE_CLIP")
    if sample:
        dirs.append(os.path.dirname(os.path.expanduser(sample)))
    return dirs


def resolve_clip(swing: GoldenSwing, clips_dir: str | None) -> str | None:
    clip = os.path.expanduser(swing.clip)
    if os.path.isabs(clip) and os.path.exists(clip):
        return clip
    for d in _candidate_dirs(clips_dir):
        cand = os.path.join(os.path.expanduser(d), os.path.basename(clip))
        if os.path.exists(cand):
            return cand
    sample = os.environ.get("SAMPLE_CLIP")
    if sample:
        sample = os.path.expanduser(sample)
        if os.path.basename(sample) == os.path.basename(clip) and os.path.exists(sample):
            return sample
    return None


# ---------------------------------------------------------------------------
# Run the deterministic measurement over one golden clip
# ---------------------------------------------------------------------------


def _open_gate_ids(result) -> tuple[str, ...]:
    from ..domain.gating import LOW_CONFIDENCE

    return tuple(
        e["faultId"]
        for e in result.faults
        if e["fired"]
        and e["confidence"] >= LOW_CONFIDENCE
        and e["status"] == "ok"
        and e.get("claimEligible", True)
    )


def measure_swing(swing: GoldenSwing, clip_path: str) -> SwingPrediction:
    """Transcode + run the pure measurement core; never raises (errors become a status)."""
    from ..config import get_settings
    from ..pipeline import assemble, transcode

    settings = get_settings()
    tmpdir = tempfile.mkdtemp(prefix=f"swing-val-{swing.id}-")
    try:
        playback = os.path.join(tmpdir, "playback.mp4")
        width, height = transcode.make_playback_clip(clip_path, playback)
        run = assemble.run_measurement(
            playback,
            width,
            height,
            swing.view,
            swing.handedness,
            settings.target_fps,
            settings.pose_height,
            settings.pose_model_complexity,
            settings.pose_model_dir,
        )
        result = run.result
        metrics = {
            m["key"]: {"value": m["value"], "status": m["status"], "unit": m["unit"]}
            for m in result.metrics
        }
        return SwingPrediction(
            swing_id=swing.id,
            status=result.status,  # 'complete' | 'unreadable'
            predicted_primary_fault_id=result.primary_fault_id,
            predicted_metrics=metrics,
            open_gate_ids=_open_gate_ids(result),
        )
    except Exception as exc:  # noqa: BLE001 — a bad clip shouldn't crash the whole run
        return SwingPrediction(swing.id, "error", error=f"{type(exc).__name__}: {exc}")
    finally:
        import shutil

        shutil.rmtree(tmpdir, ignore_errors=True)


def run_golden_set(golden_set: GoldenSet, clips_dir: str | None) -> dict[str, SwingPrediction]:
    predictions: dict[str, SwingPrediction] = {}
    for swing in golden_set.swings:
        clip = resolve_clip(swing, clips_dir)
        if clip is None:
            sys.stderr.write(f"  · {swing.id}: clip not found ({swing.clip}) — skipped\n")
            predictions[swing.id] = SwingPrediction(swing.id, "clip_missing")
            continue
        sys.stderr.write(f"  · {swing.id}: measuring {os.path.basename(clip)} ({swing.view})…\n")
        predictions[swing.id] = measure_swing(swing, clip)
    return predictions


# ---------------------------------------------------------------------------
# Human-readable report
# ---------------------------------------------------------------------------


def _pct(x) -> str:
    return "—" if x is None else f"{x * 100:.0f}%"


def print_report(report: dict) -> None:
    s = report["summary"]
    out = sys.stdout
    out.write("\n=== SwingSight validation — per-fault regression ===\n")
    out.write(
        f"golden set v{s['goldenSetVersion']} · "
        f"{s['totalSwings']} swings ({s['labelledSwings']} labelled, "
        f"{s['pendingSwings']} pending) · "
        f"fault lib {s['currentFaultLibraryVersion']}"
        f"{'' if s['faultLibraryVersionMatch'] else ' (manifest mismatch!)'}\n"
    )
    out.write(f"run status: {s['runStatusCounts']}\n")
    out.write(
        f"overall primary-fault agreement: {_pct(s['overallPrimaryAgreement'])}"
        f" over {s['countedSwings']} counted swing(s)\n\n"
    )

    out.write("per-fault (recall vs coach label, against each fault's bar):\n")
    out.write(f"  {'fault':<24}{'elig':<6}{'labels':<8}{'agree':<8}{'bar':<8}{'verdict'}\n")
    for f in report["perFault"]:
        elig = "—" if f["claimEligible"] is None else ("claim" if f["claimEligible"] else "soft")
        bar = "—" if f["barMinAgreement"] is None else f"{f['barMinAgreement'] * 100:.0f}%"
        out.write(
            f"  {f['faultId']:<24}{elig:<6}"
            f"{str(f['labelledCount']):<8}{_pct(f['agreement']):<8}{bar:<8}{f['status']}\n"
        )

    if report["perMetricError"]:
        out.write("\nper-metric error (|pipeline − coach truth|):\n")
        for m in report["perMetricError"]:
            out.write(f"  {m['metricKey']:<32}{m['meanAbsError']:.2f} {m['unit']} (n={m['n']})\n")

    if report["pendingReview"]:
        out.write("\nawaiting coach labels (pipeline prediction shown for REVIEW only — NOT a label):\n")
        for p in report["pendingReview"]:
            pred = p["predictedPrimaryFaultId"] or "(no clear fault)"
            extra = f" — {p['error']}" if p.get("error") else ""
            out.write(
                f"  · {p['swingId']} [{p['view']}] run={p['runStatus']}{extra}\n"
                f"      pipeline predicts: {pred}; open gates: {p['openGateIds'] or '[]'}\n"
            )

    out.write("\n")
    if report["regression"]:
        out.write("❌ REGRESSION — a claim-eligible fault dropped below its bar (see above).\n")
    elif s["countedSwings"] == 0:
        out.write(
            "✅ NO REGRESSION — harness GREEN. No coach labels yet, so agreement is not "
            "measurable. Add coach labels to worker/validation/golden_set.json to gate.\n"
        )
    else:
        out.write("✅ NO REGRESSION — every claim-eligible fault clears its bar (or awaits evidence).\n")


# ---------------------------------------------------------------------------
# Self-test (pure logic, no pose) — verifies the agreement/error maths
# ---------------------------------------------------------------------------


def _swing(
    sid, fault=None, *, no_fault=False, source="coach", view="face_on", mgt=None
) -> GoldenSwing:
    return GoldenSwing(
        id=sid,
        clip=f"{sid}.mov",
        view=view,
        handedness="RH",
        label_source=source,
        expected_primary_fault_id=fault,
        expected_no_fault=no_fault,
        metric_ground_truth=mgt or {},
        labeled_by=None if source == "pending_coach_review" else "test-coach",
        labeled_at=None,
        notes="",
    )


def _pred(sid, primary=None, status="complete", metrics=None) -> SwingPrediction:
    return SwingPrediction(sid, status, primary, metrics or {})


def self_test() -> int:
    failures: list[str] = []

    def check(cond: bool, msg: str) -> None:
        if not cond:
            failures.append(msg)

    # 1. chicken_wing recall at 4/5 -> 80% >= 70% bar -> clears, no regression.
    swings = [_swing(f"cw{i}", "chicken_wing") for i in range(5)]
    preds = {f"cw{i}": _pred(f"cw{i}", "chicken_wing") for i in range(4)}
    preds["cw4"] = _pred("cw4", "reverse_spine_angle")  # one miss
    gs = GoldenSet("test", "x", "", tuple(swings))
    r = build_report(gs, preds)
    cw = next(f for f in r["perFault"] if f["faultId"] == "chicken_wing")
    check(cw["labelledCount"] == 5, f"cw labelledCount {cw['labelledCount']} != 5")
    check(abs(cw["agreement"] - 0.8) < 1e-9, f"cw agreement {cw['agreement']} != 0.8")
    check(cw["clearsBar"] is True, "cw should clear bar at 80%")
    check(cw["regression"] is False, "cw should not regress at 80%")
    check(r["regression"] is False and r["ok"] is True, "set should be OK")
    check(abs(r["summary"]["overallPrimaryAgreement"] - 0.8) < 1e-9, "overall != 0.8")

    # 2. chicken_wing recall at 2/5 -> 40% < 70% bar AND claim-eligible -> REGRESSION.
    preds_bad = {f"cw{i}": _pred(f"cw{i}", "chicken_wing") for i in range(2)}
    for i in range(2, 5):
        preds_bad[f"cw{i}"] = _pred(f"cw{i}", None)
    r2 = build_report(gs, preds_bad)
    cw2 = next(f for f in r2["perFault"] if f["faultId"] == "chicken_wing")
    check(cw2["status"] == "REGRESSION", f"cw should REGRESS at 40% (got {cw2['status']})")
    check(r2["regression"] is True and r2["ok"] is False, "set should fail on regression")

    # 3. soft_only fault below bar is NOT a regression (it can't drive a claim anyway).
    rs = [_swing(f"rs{i}", "reverse_spine_angle") for i in range(5)]
    rs_preds = {f"rs{i}": _pred(f"rs{i}", None) for i in range(5)}  # 0% agreement
    r3 = build_report(GoldenSet("t", "x", "", tuple(rs)), rs_preds)
    rsf = next(f for f in r3["perFault"] if f["faultId"] == "reverse_spine_angle")
    check(rsf["claimEligible"] is False, "reverse_spine_angle must be soft_only")
    check(rsf["regression"] is False, "soft_only fault must never count as a regression")
    check(r3["ok"] is True, "soft_only underperformance must not fail the gate")

    # 4. insufficient evidence: < bar.minLabelled labels -> no pass/fail, just flagged.
    few = [_swing("cwA", "chicken_wing"), _swing("cwB", "chicken_wing")]
    r4 = build_report(GoldenSet("t", "x", "", tuple(few)), {"cwA": _pred("cwA", "chicken_wing"), "cwB": _pred("cwB", "chicken_wing")})
    cw4 = next(f for f in r4["perFault"] if f["faultId"] == "chicken_wing")
    check(cw4["status"] == "insufficient_evidence", f"2 labels -> insufficient (got {cw4['status']})")
    check(cw4["clearsBar"] is None and cw4["regression"] is False, "insufficient -> no verdict")

    # 5. no-fault label vs null prediction agrees; metric error is |pred - truth|.
    nf = _swing("nf1", no_fault=True, mgt={"tempo_ratio": 3.0})
    nf_pred = _pred("nf1", None, metrics={"tempo_ratio": {"value": 3.4, "status": "ok", "unit": "ratio"}})
    r5 = build_report(GoldenSet("t", "x", "", (nf,)), {"nf1": nf_pred})
    check(abs(r5["summary"]["overallPrimaryAgreement"] - 1.0) < 1e-9, "no_fault vs null should agree")
    me = next(m for m in r5["perMetricError"] if m["metricKey"] == "tempo_ratio")
    check(abs(me["meanAbsError"] - 0.4) < 1e-9, f"tempo error {me['meanAbsError']} != 0.4")

    # 6. pending swing never counts toward agreement.
    pend = _swing("p1", source="pending_coach_review")
    r6 = build_report(GoldenSet("t", "x", "", (pend,)), {"p1": _pred("p1", "chicken_wing")})
    check(r6["summary"]["countedSwings"] == 0, "pending swing must not be counted")
    check(len(r6["pendingReview"]) == 1, "pending swing must appear in review list")

    # 7. every library fault has a bar (so the gate is always defined).
    for entry in FAULT_LIBRARY:
        check(entry.validation.bar.min_labelled_swings >= 1, f"{entry.id} bar minLabelled < 1")
        check(0.0 < entry.validation.bar.min_agreement <= 1.0, f"{entry.id} bar minAgreement invalid")

    if failures:
        sys.stdout.write("❌ SELF-TEST FAILED:\n")
        for f in failures:
            sys.stdout.write(f"  - {f}\n")
        return 1
    sys.stdout.write("✅ SELF-TEST PASSED — agreement/error/bar maths verified on fixtures.\n")
    return 0


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="SwingSight golden-set regression runner")
    parser.add_argument("--manifest", default=os.path.abspath(_DEFAULT_MANIFEST))
    parser.add_argument("--clips-dir", default=None)
    parser.add_argument("--json", action="store_true", help="print the JSON report to stdout")
    parser.add_argument("--out", default=None, help="write the JSON report to this file")
    parser.add_argument("--self-test", action="store_true", help="verify the logic only (no pose)")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    try:
        golden_set = load_golden_set(args.manifest)
    except (ManifestError, FileNotFoundError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"❌ golden set invalid: {exc}\n")
        return 2

    sys.stderr.write(f"Running {len(golden_set.swings)} golden swing(s)…\n")
    predictions = run_golden_set(golden_set, args.clips_dir)
    report = build_report(golden_set, predictions)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, sort_keys=True)
        sys.stderr.write(f"wrote {args.out}\n")

    if args.json:
        sys.stdout.write(json.dumps(report, indent=2, sort_keys=True) + "\n")
    else:
        print_report(report)

    return 1 if report["regression"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
