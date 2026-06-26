#!/usr/bin/env bash
# Deploy the SwingSight CV worker to a NEW, isolated Cloud Run project.
#
# Idempotent and safe to re-run. Does the whole Phase-3 deploy + wiring:
#   1. create project (default: swingsight-proto) + link billing
#   2. enable Run / Cloud Build / Artifact Registry
#   3. fetch the Supabase service-role key (read-only)
#   4. gcloud run deploy --source worker  (Cloud Build → Cloud Run, EU)
#   5. supabase secrets set WORKER_URL + WORKER_INVOKER_TOKEN  (closes the webhook loop)
#
# Requires a fresh gcloud token: run `gcloud auth login` first (interactive).
# All secret values come from setup.env + the Supabase CLI — none are hardcoded.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; source setup.env; set +a

PROJECT="${GCP_PROJECT:-swingsight-proto}"     # globally-unique id; override via env
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-swingsight-worker}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"          # optional; auto-detected if exactly one

echo "==> Project=$PROJECT  Region=$REGION  Service=$SERVICE"

# --- 0. token freshness ----------------------------------------------------------
if ! gcloud projects list --limit=1 >/dev/null 2>&1; then
  echo "ERROR: gcloud token is stale. Run:  gcloud auth login   then re-run this." >&2
  exit 1
fi

# --- 1. project ------------------------------------------------------------------
if gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
  echo "==> Project $PROJECT already exists; reusing."
else
  echo "==> Creating project $PROJECT..."
  gcloud projects create "$PROJECT" --name="SwingSight Proto"
fi
gcloud config set project "$PROJECT" >/dev/null

# --- 2. billing ------------------------------------------------------------------
if ! gcloud billing projects describe "$PROJECT" \
      --format="value(billingEnabled)" 2>/dev/null | grep -qi true; then
  if [ -z "$BILLING_ACCOUNT" ]; then
    mapfile -t OPEN < <(gcloud billing accounts list --filter="open=true" \
                        --format="value(name)" 2>/dev/null || true)
    if [ "${#OPEN[@]}" -eq 1 ]; then
      BILLING_ACCOUNT="${OPEN[0]}"
    elif [ "${#OPEN[@]}" -eq 0 ]; then
      echo "ERROR: no open billing account. Add one in the console, then set BILLING_ACCOUNT=... and re-run." >&2
      exit 1
    else
      echo "ERROR: multiple billing accounts; set BILLING_ACCOUNT=... to one of:" >&2
      printf '   %s\n' "${OPEN[@]}" >&2
      exit 1
    fi
  fi
  echo "==> Linking billing account $BILLING_ACCOUNT..."
  gcloud billing projects link "$PROJECT" --billing-account="$BILLING_ACCOUNT"
else
  echo "==> Billing already enabled."
fi

# --- 3. APIs ---------------------------------------------------------------------
echo "==> Enabling APIs (run, cloudbuild, artifactregistry)..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com --project "$PROJECT"

# --- 4. Supabase service-role key (read-only) ------------------------------------
echo "==> Fetching Supabase service-role key..."
SRK="$(supabase projects api-keys --project-ref "$SUPABASE_PROJECT_REF" 2>/dev/null \
       | awk -F'|' '/service_role/ { gsub(/ /,"",$2); print $2 }')"
[ -n "$SRK" ] || { echo "ERROR: could not read service_role key." >&2; exit 1; }

# --- 5. deploy -------------------------------------------------------------------
echo "==> Deploying $SERVICE from source (Cloud Build → Cloud Run)..."
gcloud run deploy "$SERVICE" \
  --source worker \
  --project "$PROJECT" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi --cpu 2 --concurrency 1 --timeout 600 \
  --min-instances 0 --max-instances 3 \
  --set-env-vars "WORKER_INVOKER_TOKEN=${INVOKER_TOKEN}" \
  --set-env-vars "R2_ACCOUNT_ID=${R2_ACCOUNT_ID}" \
  --set-env-vars "R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}" \
  --set-env-vars "R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}" \
  --set-env-vars "R2_BUCKET=${R2_BUCKET}" \
  --set-env-vars "R2_ENDPOINT=${R2_ENDPOINT}" \
  --set-env-vars "SUPABASE_URL=${SUPABASE_URL}" \
  --set-env-vars "SUPABASE_SERVICE_ROLE_KEY=${SRK}" \
  --set-env-vars "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}" \
  --set-env-vars "COACHING_MODEL=${COACHING_MODEL:-claude-haiku-4-5}"

WORKER_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --project "$PROJECT" --format='value(status.url)')"
echo "==> WORKER_URL=$WORKER_URL"

# --- 6. wire the webhook ---------------------------------------------------------
echo "==> Pointing the on-swing-insert webhook at the worker..."
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  WORKER_URL="$WORKER_URL" \
  WORKER_INVOKER_TOKEN="$INVOKER_TOKEN"

echo
echo "✅ Deployed + wired."
echo "   Health:  curl -s $WORKER_URL/healthz"
echo "   Persist: add WORKER_URL=$WORKER_URL to setup.env"
echo "   E2E:     scripts/checkpoint.sh   (drives a real analysis through the worker)"
