# Deploying the SwingSight CV worker to Cloud Run

The worker is the deterministic measurement engine (Phase 3). This is the exact
sequence to deploy it to Google Cloud Run and close the loop with the existing
Supabase webhook. **These steps run under the user's own GCP account** — pick the
project + region first (see "Decisions to confirm" at the bottom).

Everything the worker needs is already in `setup.env` (R2 creds + endpoint,
`SUPABASE_URL`, `INVOKER_TOKEN`) except the Supabase **service-role** key, which is
fetched from the Supabase CLI in step 3.

> Governing law: this worker is the MEASUREMENT layer only. `ANTHROPIC_API_KEY` is
> Phase 5 (the Claude coaching call) and is **not** needed to deploy Phase 3.

---

## 0. One-time prerequisites

Confirmed choices: **new project `swingsight`**, **region `europe-west1`** (EU), public
URL + invoker-token auth.

```bash
gcloud auth login                      # if not already (run via `! gcloud auth login`)

# Create the project (pick a globally-unique id; 'swingsight' may be taken — append a
# suffix if so, e.g. swingsight-prod). Then link a billing account (required for Run).
export GCP_PROJECT=swingsight          # or swingsight-<suffix> if taken
export REGION=europe-west1
export SERVICE=swingsight-worker

gcloud projects create "$GCP_PROJECT" --name="SwingSight"
gcloud billing accounts list           # copy your billing account id
gcloud billing projects link "$GCP_PROJECT" --billing-account=<BILLING_ACCOUNT_ID>

gcloud config set project "$GCP_PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com --project "$GCP_PROJECT"
```

## 1. Load the provisioning values

```bash
cd /Users/oliverwoodward/Code/swingsight_proto
set -a; source setup.env; set +a
```

## 2. Fetch the Supabase service-role key (server-side only — never on device)

```bash
# Prints anon + service_role; copy the service_role value.
supabase projects api-keys --project-ref "$SUPABASE_PROJECT_REF"
export SUPABASE_SERVICE_ROLE_KEY=<paste-the-service_role-key>
```

## 3. Deploy (Cloud Build from source — no local Docker/registry juggling)

`--source worker` has Cloud Build build the Dockerfile and push to a managed
Artifact Registry repo, then deploys. CPU-heavy pose ⇒ `--concurrency=1`; one
analysis runs synchronously per request, so a generous `--timeout`.

```bash
gcloud run deploy "$SERVICE" \
  --source worker \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --concurrency 1 \
  --timeout 600 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "WORKER_INVOKER_TOKEN=${INVOKER_TOKEN}" \
  --set-env-vars "R2_ACCOUNT_ID=${R2_ACCOUNT_ID}" \
  --set-env-vars "R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}" \
  --set-env-vars "R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}" \
  --set-env-vars "R2_BUCKET=${R2_BUCKET}" \
  --set-env-vars "R2_ENDPOINT=${R2_ENDPOINT}" \
  --set-env-vars "SUPABASE_URL=${SUPABASE_URL}" \
  --set-env-vars "SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}"
```

`--allow-unauthenticated` makes the URL reachable; the worker authenticates the
caller itself via `WORKER_INVOKER_TOKEN` (the same token the Edge Function presents).
Hardening later: drop `--allow-unauthenticated`, grant the Edge Function's service
account `roles/run.invoker`, and send a GCP OIDC token instead of the bearer token.

Secret-manager hardening (optional, recommended for non-prototype): replace the
secret `--set-env-vars` with `--set-secrets KEY=secretName:latest` after
`gcloud secrets create`.

Capture the URL:

```bash
export WORKER_URL=$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format 'value(status.url)')
echo "$WORKER_URL"
```

## 4. Smoke-test the deployed worker

```bash
curl -s "$WORKER_URL/healthz"        # -> {"status":"ok","version":"0.3.0"}

# Unauthorised without the token (proves the invoker check):
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$WORKER_URL/analyze" \
  -H 'content-type: application/json' -d '{}'        # -> 401
```

## 5. Close the loop — point the webhook at the worker

The `on-swing-insert` Edge Function currently 200-skips because `WORKER_URL` is
unset. Set it (and confirm the invoker token matches) and the next queued swing
flows straight through:

```bash
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  WORKER_URL="$WORKER_URL" \
  WORKER_INVOKER_TOKEN="$INVOKER_TOKEN"
```

## 6. Drive a real analysis end-to-end

```bash
# Re-run the Phase-2 checkpoint: uploads the sample clip, inserts a queued swing,
# the DB webhook fires on-swing-insert -> worker /analyze -> results stream back.
scripts/checkpoint.sh
```

Then inspect the row (`swing_analyses.status` should reach `complete`, with
`keypoints_meta`, `faults`, `score`, `quality` populated and `swing_keypoints` /
`swing_metrics` / `swing_keyframes` rows written). The R2 bucket gets
`playback/<uid>/<analysis>/playback.mp4` and `frames/<uid>/<analysis>/<event>.jpg`.

---

## Decisions (confirmed with the user)

| Decision | Choice |
|---|---|
| **GCP project** | new project `swingsight` (append a suffix if the id is taken) |
| **Region** | `europe-west1` (Belgium) — EU for GDPR (spec §21), near Supabase Ireland + R2 EU |
| **Service name** | `swingsight-worker` |
| **Artifact Registry** | managed `cloud-run-source-deploy` repo (auto-created by `--source`) |
| **Auth model** | public URL + `WORKER_INVOKER_TOKEN` (the invoker check gates access); IAM/OIDC is the later hardening |

## playback_video_url — how the app gets the clip

The worker stores the R2 **object key** (`playback/<uid>/<analysis>/playback.mp4`)
in `swing_analyses.playback_video_url`, NOT a URL. The bucket is private, so the
report (Phase 4/5) mints a short-lived presigned GET on demand — a `playback-url`
Edge Function symmetric to `upload-url`. This avoids a long-lived URL that would
outlive its signature (max ~7 days) before the 30-day playback object expires, and
keeps signed URLs out of the DB and logs.
