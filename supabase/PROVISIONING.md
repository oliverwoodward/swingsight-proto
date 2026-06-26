# SwingSight Phase 2 — provisioning & deploy

Everything codeable is built (migrations, RLS, Realtime, Edge Functions, the app
Supabase client + anon-auth + Supabase profile store, the checkpoint script).
These are the steps **you** run, because they need your accounts/credentials.

**Locked choices:** Supabase region **EU West (Ireland)**, R2 **EU jurisdiction**,
project + bucket **`swingsight-proto`** (GDPR posture, spec §21).

Secret custody (PRD §4): the **anon key + project URL** go in the app
(`EXPO_PUBLIC_*`, public by design). The **service-role key, R2 secrets, Anthropic
key, worker invoker token** live ONLY in the worker / Edge Functions — never on the
device.

---

## Fast path — `./scripts/setup.sh`

After steps 1–2 below (create the Supabase project + R2 bucket/token in the
browser), just run the helper from the repo root:

```bash
cp setup.env.example setup.env     # optional: pre-fill what you have
./scripts/setup.sh
```

It **prompts** for anything blank, auto-generates the two shared secrets, writes
`app/.env` and `supabase/vault-secrets.sql`, and offers to run `link` / `db push` /
`secrets set` / `functions deploy` / the checkpoint (each opt-in). It still leaves
three things for you to do in the browser: enable anonymous sign-ins, paste the
Vault SQL, and apply the R2 lifecycle. The manual steps below are the same actions,
spelled out.

---

---

## 1. Create the Supabase project

Dashboard → New project → name **`swingsight-proto`**, region **West EU (Ireland)**.
Then collect (Settings → API / General):

- Project ref (e.g. `abcdefghijklmnop`)
- Project URL: `https://<ref>.supabase.co`
- `anon` public key
- `service_role` key (secret)

## 2. Create the R2 bucket + S3 token

Follow **`supabase/r2/README.md`**: bucket `swingsight-proto` (EU jurisdiction),
an Object Read&Write S3 token, and the EU endpoint
`https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`. Note the account id, access key
id, secret. (Apply the lifecycle rules in step 7.)

## 3. Link the project & push the schema

```bash
cd /Users/oliverwoodward/Code/swingsight_proto
supabase link --project-ref <ref>
supabase db push          # applies supabase/migrations/* (validated locally)
supabase config push      # applies config.toml → enables anonymous sign-ins
```

If `config push` isn't available on your CLI, enable it in the dashboard:
**Authentication → Sign In / Up → Anonymous sign-ins = ON**.

> Note: the local-dev ports in `config.toml` are remapped to `553xx` so this stack
> can run alongside your other local Supabase project. That only affects
> `supabase start`; it has no effect on the hosted project.

## 4. Edge Function secrets

The functions read these at runtime (Supabase auto-injects `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — don't set those). Generate two
random secrets first:

```bash
WEBHOOK_SECRET=$(openssl rand -hex 32)     # shared: DB trigger ↔ on-swing-insert
INVOKER_TOKEN=$(openssl rand -hex 32)      # shared: on-swing-insert ↔ worker

supabase secrets set \
  R2_ACCOUNT_ID=<acct> \
  R2_ACCESS_KEY_ID=<key> \
  R2_SECRET_ACCESS_KEY=<secret> \
  R2_BUCKET=swingsight-proto \
  R2_ENDPOINT=https://<acct>.eu.r2.cloudflarestorage.com \
  ON_SWING_INSERT_SECRET=$WEBHOOK_SECRET \
  WORKER_INVOKER_TOKEN=$INVOKER_TOKEN
  # WORKER_URL is set in Phase 3 once Cloud Run is deployed. Until then the
  # function safely no-ops the dispatch (it still authenticates the webhook).
```

## 5. Vault secrets (power the DB → Edge Function webhook)

The `swing_analyses` insert/queue trigger reads the Edge Function base URL and the
shared webhook secret from Vault. Set them (SQL editor, or `psql`):

```sql
select vault.create_secret('https://<ref>.supabase.co', 'edge_function_base_url', 'SwingSight edge base url');
select vault.create_secret('<paste the same $WEBHOOK_SECRET>', 'on_swing_insert_secret', 'SwingSight webhook secret');
```

`on_swing_insert_secret` (Vault) **must equal** `ON_SWING_INSERT_SECRET` (function
env) — that's how the function authenticates the webhook.

## 6. Deploy the Edge Functions

```bash
supabase functions deploy upload-url        # verify_jwt = true  (per config.toml)
supabase functions deploy on-swing-insert   # verify_jwt = false (per config.toml)
```

## 7. Apply the R2 lifecycle rules

See `supabase/r2/README.md` step 3 (`aws s3api put-bucket-lifecycle-configuration`
against the EU endpoint, using `supabase/r2/lifecycle.json`).

## 8. Wire the app env

```bash
cd app
cp .env.example .env
# fill in:
#   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
#   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

The app auto-switches to the Supabase-backed profile store + anonymous auth once
these are set (before they're set it falls back to the device-local store, so the
dev build keeps running). No UI changes — the `ProfileStore` seam is unchanged.

## 9. Checkpoint — presigned upload of a real clip + webhook fires

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<anon key> \
SAMPLE_CLIP=~/Code/Swing_Prototype/data/videos/IMG_5736.mov \
  node supabase/scripts/checkpoint-upload.mjs
```

Expected: anon sign-in → presigned URL → **real clip uploaded to R2** → rows
inserted under RLS → status `queued`. Then confirm the webhook fired:

```bash
supabase functions logs on-swing-insert     # → "worker /analyze -> 501"
```

The **501 is expected**: the Cloud Run worker isn't deployed until Phase 3 (its
skeleton returns 501). A 501 still proves the full chain
DB insert → trigger → Edge Function → worker `/analyze`. Once Phase 3 deploys the
worker, set `WORKER_URL` (step 4) and the same checkpoint drives a real analysis.

---

## What's already done in code (no action needed)

- `supabase/migrations/*` — schema (mirrors `domain/types.ts`), RLS by `auth.uid()`,
  Realtime on `swing_analyses`, the webhook trigger, fault-library + drill seed.
- `supabase/functions/upload-url` + `on-swing-insert` — presigned R2 URL + worker bridge.
- App: `services/supabase.ts` (client + chunked-keychain session + anon auth),
  `services/profile-store.ts` (`createSupabaseProfileStore`), `contexts/auth.tsx`,
  and `_layout.tsx` wiring (profile id = `auth.uid()`).
- Worker: `/analyze` now authenticates the invoker token (still 501 until Phase 3).
