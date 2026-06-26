#!/usr/bin/env bash
# Phase 3 determinism checkpoint — the headline verification.
#
# Builds the worker container (the SAME runtime as Cloud Run) and runs the pure
# measurement core on a real swing TWICE inside it, then asserts the measurement
# JSON is byte-identical (matching sha256). This proves "same input -> same output"
# on the deploy runtime, not just on a dev machine.
#
# Usage: scripts/determinism_check.sh [VIDEO] [VIEW] [HANDEDNESS]
#   VIDEO       default: $SAMPLE_CLIP from setup.env, else the IMG_5736 sample.
#   VIEW        face_on | dtl     (default face_on)
#   HANDEDNESS  RH | LH           (default RH)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[ -f setup.env ] && source setup.env || true

VIDEO="${1:-${SAMPLE_CLIP:-/Users/oliverwoodward/Code/Swing_Prototype/data/videos/IMG_5736.mov}}"
VIEW="${2:-face_on}"
HANDEDNESS="${3:-RH}"
IMAGE="swingsight-worker:det-check"

[ -f "$VIDEO" ] || { echo "ERROR: video not found: $VIDEO" >&2; exit 1; }

echo "==> Building worker image (linux/amd64, Cloud Run parity)…"
docker build --platform linux/amd64 -t "$IMAGE" worker

run_once() {
  docker run --rm --platform linux/amd64 \
    -v "$VIDEO:/data/input.mov:ro" \
    "$IMAGE" \
    python -m swingsight_worker.run_local /data/input.mov --view "$VIEW" --handedness "$HANDEDNESS"
}

echo "==> Pass A…"; run_once > /tmp/swing_detA.json
echo "==> Pass B…"; run_once > /tmp/swing_detB.json

A=$(shasum -a 256 /tmp/swing_detA.json | awk '{print $1}')
B=$(shasum -a 256 /tmp/swing_detB.json | awk '{print $1}')
echo "    A: $A"
echo "    B: $B"

if [ "$A" = "$B" ]; then
  echo "✅ DETERMINISM PASS — byte-identical measurement layer ($(wc -c </tmp/swing_detA.json) bytes)"
else
  echo "❌ DETERMINISM FAIL — measurement layer differs"; diff <(jq . /tmp/swing_detA.json) <(jq . /tmp/swing_detB.json) | head -40 || true
  exit 1
fi
