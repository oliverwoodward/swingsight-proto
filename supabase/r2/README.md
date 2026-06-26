# Cloudflare R2 — bucket, token, lifecycle

R2 stores the raw clip (transient), the worker's H.264 playback clip, and the
extracted key-frame JPEGs. It speaks the S3 API; the Edge Function `upload-url`
and the Cloud Run worker both talk to it with S3 SigV4. Zero egress fees.

**Locked choices (this project):** bucket **`swingsight-proto`**, **EU jurisdiction**
(data stays in the EU — pairs with the EU-West Supabase region for GDPR, spec §21).

## Object key layout

| Prefix       | What                          | Lifecycle (spec §21)        |
|--------------|-------------------------------|-----------------------------|
| `raw/<uid>/` | raw uploaded clip (transient) | delete after **2 days**     |
| `frames/<uid>/<analysis>/` | key-frame JPEGs   | delete after **7 days**     |
| `playback/<uid>/<analysis>/` | playback H.264 clip | delete after **30 days**  |

Keypoints and metrics are **not** in R2 — they live in Postgres and are retained
~12 months for trends (DB retention, not lifecycle).

## 1. Create the bucket (EU jurisdiction)

Dashboard → R2 → Create bucket → name `swingsight-proto`, **Location: EU
jurisdiction**. (CLI alternative: `wrangler r2 bucket create swingsight-proto --jurisdiction eu`.)

Keep it **private** (default). The app never gets R2 credentials — only the
short-lived presigned URLs minted by `upload-url`.

## 2. Create an S3 API token (scoped to this bucket)

Dashboard → R2 → **Manage R2 API Tokens** → Create. Permissions: **Object Read &
Write**, scoped to `swingsight-proto`. Note the **Access Key ID**, **Secret Access
Key**, **Account ID**, and the **EU jurisdiction S3 endpoint**:

```
https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
```

These become the worker's and `upload-url`'s R2 secrets (never on the device).

## 3. Apply the lifecycle rules

R2 supports S3 lifecycle (object-age expiry + multipart abort). Apply
`lifecycle.json` with the AWS CLI pointed at the R2 endpoint:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com \
  --bucket swingsight-proto \
  --lifecycle-configuration file://supabase/r2/lifecycle.json
# (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY = the R2 token; AWS_DEFAULT_REGION=auto)
```

Verify:

```bash
aws s3api get-bucket-lifecycle-configuration \
  --endpoint-url https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com \
  --bucket swingsight-proto
```

(Or set the same rules in the dashboard under the bucket's **Settings → Object
lifecycle rules** if you prefer not to install the AWS CLI.)
