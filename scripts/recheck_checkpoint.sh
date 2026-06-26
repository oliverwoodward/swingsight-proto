#!/usr/bin/env bash
# Phase 6 live checkpoint — drives TWO same-session, same-view swings and asserts the
# worker wrote a drill_recheck comparison for the second (the report leads with it).
#
# ⚠ PHASE 7 GATE: once the worker is redeployed with the Phase-7 validation gate, the
# DEFAULT sample clip (IMG_5736) fires only `reverse_spine_angle`, now `soft_only` — so it
# yields NO primary fault and therefore NO drill_recheck row (correct: we don't recheck a
# crude proxy we haven't validated). A recheck needs a clip that fires a RELIABLE fault
# (chicken_wing / excessive_head_movement / early_extension). With the gated sample this
# checkpoint will report "no row" — that's the expected new behaviour, not a regression
# (see PRD §7b). The recheck mechanism itself is unchanged.
#
# REQUIRES the worker to be redeployed with the Phase-6 recheck step first:
#   scripts/deploy-worker.sh
#
# Then:  scripts/recheck_checkpoint.sh   [VIEW]   [HANDEDNESS]
#   VIEW        face_on | dtl   (default face_on)
#   HANDEDNESS  RH | LH         (default RH)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
[[ -f setup.env ]] || { echo "✗ setup.env missing"; exit 1; }
set -a; # shellcheck disable=SC1091
source ./setup.env; set +a

SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
SAMPLE_CLIP="${SAMPLE_CLIP/#\~/$HOME}" \
VIEW="${1:-face_on}" \
HANDEDNESS="${2:-RH}" \
  node supabase/scripts/recheck-upload.mjs
