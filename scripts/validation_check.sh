#!/usr/bin/env bash
# Phase 7 validation checkpoint — the per-fault regression over the golden set.
#
# Runs (1) the pure-logic self-test of the agreement/error/bar maths (always, no pose),
# then (2) the deterministic measurement core over every golden clip present locally,
# comparing the pipeline's primary fault + metrics to the coach labels and reporting the
# per-fault AGREEMENT RATE. Exits non-zero ONLY when a claim-eligible fault has dropped
# below its documented bar (a real regression) or the manifest is malformed.
#
# This READS the deterministic measurement (it never perturbs it), so it composes with
# scripts/determinism_check.sh — run both to keep the measurement layer honest.
#
# Usage: scripts/validation_check.sh [--self-test-only]
#   Env: SAMPLE_CLIP (the golden clips' dir is derived from it), or set
#        SWINGSIGHT_GOLDEN_CLIPS_DIR to point at where the golden clips live.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[ -f setup.env ] && source setup.env || true
export SAMPLE_CLIP="${SAMPLE_CLIP/#\~/$HOME}"

# Prefer the native check venv (has mediapipe); fall back to python3 for --self-test-only.
PY="$ROOT/worker/.venv-check/bin/python"
[ -x "$PY" ] || PY="python3"

cd "$ROOT/worker"
export PYTHONPATH="src"
export POSE_MODEL_DIR="${POSE_MODEL_DIR:-$ROOT/worker/models}"

echo "==> Self-test (agreement/error/bar maths, no pose)…"
"$PY" -m swingsight_worker.validation.run_regression --self-test

if [ "${1:-}" = "--self-test-only" ]; then
  echo "==> Skipping the measurement run (--self-test-only)."
  exit 0
fi

echo ""
echo "==> Regression over the golden set (deterministic measurement per clip)…"
"$PY" -m swingsight_worker.validation.run_regression --out /tmp/swing_validation_report.json
echo "    (machine-readable report: /tmp/swing_validation_report.json)"
