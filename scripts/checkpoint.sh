#!/usr/bin/env bash
# Run the Phase-2 checkpoint from setup.env (real clip upload + webhook fire).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
[[ -f setup.env ]] || { echo "✗ setup.env missing"; exit 1; }
set -a; # shellcheck disable=SC1091
source ./setup.env; set +a

SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
SAMPLE_CLIP="${SAMPLE_CLIP/#\~/$HOME}" \
  node supabase/scripts/checkpoint-upload.mjs
