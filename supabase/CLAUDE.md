# supabase/ — Auth, Postgres, Realtime, Edge Functions

The backend: anonymous auth, the Postgres data model (mirrors `app/src/domain/types.ts`),
Realtime (pushes status/results to the app), and Deno Edge Functions (presigned R2 URLs +
the worker trigger + privacy actions). Read the root [`../CLAUDE.md`](../CLAUDE.md) and
[`../PRD.md`](../PRD.md) (§7 "Phase 2 backend wiring") first. **Deploy steps:
[`PROVISIONING.md`](./PROVISIONING.md)** — start there for the ordered runbook.

Live project ref: `grhwgmloocegvgiccltp` (Supabase EU-West Ireland; R2 EU jurisdiction).

## Layout

```
config.toml                      supabase init + anon auth on + per-function verify_jwt;
                                 local ports remapped to 553xx (coexists w/ another local stack)
migrations/  (ordered, append-only, timestamped — never edit an applied one)
  …_init_schema.sql              8 enums + 9 tables + indexes + updated_at triggers
  …_rls.sql                      RLS by auth.uid() (14 policies) + the column-guard trigger
  …_realtime.sql                 swing_analyses → supabase_realtime, replica identity full
  …_webhook.sql                  pg_net + Vault trigger: a queued swing → on-swing-insert
  …_seed_reference.sql           fault_library (5) + drills (8), from domain/faultLibrary.ts
functions/                       Deno Edge Functions (run on Deno, not Node):
  _shared/cors.ts                corsHeaders / json / preflight helpers
  upload-url/                    mint a 15-min R2 presigned PUT (S3 SigV4 via aws4fetch)
  playback-url/                  mint a 1h presigned GET (longer: expo-video re-ranges while scrubbing)
  on-swing-insert/              webhook → POST the Cloud Run worker /analyze (invoker token)
  delete-account/                purge the caller's R2 objects then service-role delete the user
  export-data/                   the user's data as a JSON bundle + presigned playback links
r2/  lifecycle.json + README.md  bucket/token/lifecycle (raw 2d, frames 7d, playback 30d)
scripts/                         node checkpoints (checkpoint-upload, recheck-upload,
                                 sync-validation-set) — see scripts/CLAUDE.md too
```

## Conventions / invariants

- **The schema mirrors `app/src/domain/types.ts`** and the seed mirrors `faultLibrary.ts`.
  Change the contract → update the migration/seed too (see `app/src/domain/CLAUDE.md`).
  Documented deviation: per-frame keypoints are one row **per frame** with the 33
  landmarks as `jsonb` (maps 1:1 to `KeypointFrame`, ~33× fewer rows). Worker-computed
  sub-objects with no child table (`score`, `coaching`, `quality`, `faults`,
  `keypoints_meta`) are `jsonb` columns, **null until measured** — never defaulted to fake.
- **Migrations are append-only.** Add a new timestamped file; don't edit one that's been
  applied to the hosted DB. The DB is the contract — keep it in lockstep with the domain.
- **RLS + the column guard enforce the governing law in the DB.** A client may only insert
  a swing and advance `uploading → queued`; the `guard_swing_analyses_update` trigger
  freezes worker-owned columns from client writes. The **worker writes results via the
  service role** (RLS + guard bypassed). This is how "no fabricated analysis from the
  device" is enforced structurally — don't loosen it.
- **The webhook is pg_net + Vault, not a dashboard webhook.** An `after insert/update`
  trigger fires `on-swing-insert` only when a row is freshly `queued` with
  `raw_object_key` set. The Edge Function base URL + shared secret live in **Vault**
  (`edge_function_base_url`, `on_swing_insert_secret`) — nothing hardcoded; the trigger
  no-ops if Vault is empty (so migrations apply before provisioning). Updating only
  `coaching` does NOT re-fire it (it keys on the transition to `queued`).
- **Edge Functions run on Deno.** Import via `npm:`/`https:` specifiers (e.g.
  `npm:aws4fetch`, `npm:@supabase/supabase-js`), read config with `Deno.env.get`, reuse
  `_shared/cors.ts`. Secrets are server-side only; never return them to the client. Object
  keys are always built **server-side** under the authenticated `auth.uid()` so a client
  can't target another user's data. `verify_jwt` is set per-function in `config.toml`.
- **R2 is private; the bucket is never public.** Presigned URLs are the only credential the
  device sees (PUT to upload, GET to play back). EU-jurisdiction buckets MUST use the
  `…​.eu.r2.cloudflarestorage.com` endpoint (set `R2_ENDPOINT`) — the non-EU endpoint
  returns NoSuchBucket.

## Common commands

```bash
supabase db push                                   # apply new migrations to the linked project
supabase functions deploy <name>                   # deploy one Edge Function
supabase config push                               # apply config.toml (anon auth, verify_jwt)
supabase secrets set KEY=value                      # Edge Function secrets (incl. WORKER_URL)
```

Validate migrations locally by applying them to a throwaway DB (the local stack ports are
`553xx`). The service-role key is never committed; Vault SQL output is gitignored.
