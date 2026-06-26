#!/usr/bin/env bash
# Non-interactive executor: reads setup.env and applies the backend (link, db push,
# edge-function secrets, deploy). Secrets stay in setup.env — never printed.
# Run by Claude on your behalf; safe to re-run.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"

[[ -f setup.env ]] || { echo "✗ setup.env missing"; exit 1; }
set -a; # shellcheck disable=SC1091
source ./setup.env; set +a

req() { [[ -n "${!1:-}" ]] || { echo "✗ setup.env missing: $1"; exit 1; }; }
for v in SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_ANON_KEY \
         R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET \
         WEBHOOK_SECRET INVOKER_TOKEN; do req "$v"; done
: "${R2_ENDPOINT:=https://${R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com}"

# app/.env (public values)
cat > app/.env <<EOF
EXPO_PUBLIC_SUPABASE_URL=$SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
EOF
echo "✓ app/.env"

# link + db push (only if the DB password is provided; the CLI reads SUPABASE_DB_PASSWORD)
if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  export SUPABASE_DB_PASSWORD
  supabase link --project-ref "$SUPABASE_PROJECT_REF" </dev/null
  echo "✓ linked $SUPABASE_PROJECT_REF"
  supabase db push </dev/null
  echo "✓ db push"
else
  echo "• SUPABASE_DB_PASSWORD blank — assuming you ran 'supabase link' + 'supabase db push' yourself"
fi

# Edge Function secrets
supabase secrets set \
  R2_ACCOUNT_ID="$R2_ACCOUNT_ID" \
  R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  R2_BUCKET="$R2_BUCKET" \
  R2_ENDPOINT="$R2_ENDPOINT" \
  ON_SWING_INSERT_SECRET="$WEBHOOK_SECRET" \
  WORKER_INVOKER_TOKEN="$INVOKER_TOKEN" \
  ${WORKER_URL:+WORKER_URL="$WORKER_URL"} >/dev/null
echo "✓ edge function secrets set"

# Deploy
supabase functions deploy upload-url >/dev/null
echo "✓ deployed upload-url"
supabase functions deploy on-swing-insert >/dev/null
echo "✓ deployed on-swing-insert"

echo
echo "Backend applied. Remaining before the checkpoint:"
echo "  1) Authentication → Anonymous sign-ins = ON"
echo "  2) SQL editor → paste supabase/vault-secrets.sql → Run"
echo "Then: scripts/checkpoint.sh"
