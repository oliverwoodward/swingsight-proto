# SwingSight backend (Supabase + R2)

Auth (anonymous), Postgres (the data model mirroring `app/src/domain/types.ts`),
Realtime (push results to the app), and Edge Functions (presigned R2 upload URL +
worker trigger). Built in **Phase 2**.

## Layout

```
supabase/
  config.toml                    # supabase init + anon auth on + per-function verify_jwt
  migrations/
    …_init_schema.sql            # enums + 9 tables + indexes + updated_at trigger
    …_rls.sql                    # RLS by auth.uid() + worker-owned-column guard
    …_realtime.sql               # swing_analyses → supabase_realtime, replica identity full
    …_webhook.sql                # pg_net + Vault trigger: queued swing → on-swing-insert
    …_seed_reference.sql         # fault_library (5) + drills (8), from domain/faultLibrary.ts
  functions/
    _shared/cors.ts
    upload-url/                  # mint a 15-min R2 presigned PUT URL (S3 SigV4), scoped to auth.uid()
    on-swing-insert/             # webhook → POST Cloud Run worker /analyze (authenticated)
  r2/
    lifecycle.json + README.md   # bucket/token/lifecycle (raw 2d, frames 7d, playback 30d)
  scripts/
    checkpoint-upload.mjs        # Phase 2 checkpoint: real clip upload + webhook fire
  PROVISIONING.md                # ← the exact deploy steps to run (start here)
```

## Deploy

See **`PROVISIONING.md`** for the full, ordered steps (create project + R2,
`link` / `db push` / `config push`, set Edge Function + Vault secrets, deploy
functions, apply R2 lifecycle, wire app env, run the checkpoint).

## Data flow (spec §7.2)

```
app ──(JWT)──► upload-url ──► presigned R2 PUT URL
app ──PUT clip──► R2
app ──insert/queue swing_analyses (RLS: profile_id = auth.uid())
   └─ DB trigger (pg_net, Vault-config) ──► on-swing-insert ──(invoker token)──► worker /analyze
worker ──(service role)──► writes results + Realtime ──► app
```
