# SwingSight — agent guide (read this first, then PRD.md)

A production-quality prototype golf-swing analyzer. Record a swing on a phone → a cloud
worker measures it (pose → events → metrics → fault gates → deterministic score) → a
constrained Claude call writes the coaching → the app plays the swing back with a Skia
skeleton overlay and highlights the one fault to work on.

## Source of truth

**[`PRD.md`](./PRD.md) is the single source of truth** — current build status, locked
decisions, conventions, the full per-phase checklist, and a long, battle-tested
"gotchas already discovered" section (§7). **Read it before doing any work**, and
**update it as you go** (tick checkboxes, add new gotchas/decisions, bump the
"Last updated / Current phase" line at the top).

This file and the per-directory `CLAUDE.md` files are the *fast orientation* layer: the
conventions and commands you need most often. When this file and `PRD.md` disagree,
`PRD.md` wins — and fix the drift.

## The governing law (never violate)

> **CV measures. The AI explains. The fault library localises.**

- The **measurement layer** (pose, events, metrics, gates, score, overlay coordinates)
  is deterministic and lives in the cloud worker. Same input → byte-identical output.
- The **LLM** only writes language. It never emits a joint index, frame number, or
  score, and may only *select* a fault whose gate the CV already opened.
- The **fault library** owns the highlight (which body segment, which phase window);
  the app draws it from the CV's measured coordinates, handedness-aware + confidence-gated.
- **Never show fabricated analysis data to the user.** A bad/unreadable clip shows
  re-record guidance, not a made-up result. Stubs that a later phase fills in are fine;
  fake data shown as if real is not.

## Monorepo layout

| Dir | What | Stack | Deeper guide |
|---|---|---|---|
| [`app/`](./app/) | iPhone capture + report app | Expo SDK 56 dev-client, RN 0.85, React 19, expo-router, TS | `app/CLAUDE.md` |
| [`worker/`](./worker/) | Cloud Run CV pipeline + coaching call | Python 3.12, FastAPI, MediaPipe, PyAV | `worker/CLAUDE.md` |
| [`supabase/`](./supabase/) | Auth, Postgres, Realtime, Edge Functions | Supabase + Deno Edge Functions | `supabase/CLAUDE.md` |
| [`scripts/`](./scripts/) | Verify + deploy + live checkpoint scripts | bash + node | `scripts/CLAUDE.md` |

Data flow: vision-camera (1080p/60fps) → presigned upload to **Cloudflare R2** →
Supabase DB trigger → **Cloud Run** worker → results + a 720p/1080p H.264 playback clip
back to R2 → Supabase Realtime pushes status/results → Skia overlay report on the phone.
Pose = **MediaPipe BlazePose**; coaching = **Claude Haiku 4.5** (`claude-haiku-4-5`),
key server-side only. Multi-cloud is intentional (R2 = zero egress, speaks S3).

## Cross-cutting invariants (these span components — get them wrong and things drift apart)

1. **The domain contract is mirrored in THREE places.** `app/src/domain/*.ts` (the
   canonical TS contract) ↔ `worker/src/swingsight_worker/domain/*.py` (a hand-kept
   Python mirror — same formulas) ↔ `supabase/migrations/*.sql` (the DB schema + seed).
   **Change one → change all three and re-verify both sides.** See
   `app/src/domain/CLAUDE.md`.
2. **Worker determinism is sacred.** Re-running the measurement on the same clip must be
   byte-identical. Non-deterministic steps (the LLM coaching call, the recheck) are
   *structurally isolated* — they run after the measurement and aren't in its payload.
   See `worker/CLAUDE.md`.
3. **Secrets are server-side only.** The Anthropic key, the Supabase service-role key,
   and R2 credentials live only in the worker / Edge Functions — never on the device,
   never committed. No identifiable data (profile id, email) ever reaches the LLM.
4. **No fabricated analysis from the device.** Enforced in the DB: a column-guard trigger
   freezes worker-owned columns from client writes; the worker writes results via the
   service role. The device only ever supplies inputs and links, never measured values.

## Verify (run after changes — all should be GREEN)

```bash
# App typecheck
cd app && npx tsc --noEmit -p tsconfig.json
# App lint
cd app && npx expo lint
# Worker syntax
cd worker && python3 -m py_compile src/swingsight_worker/*.py \
  src/swingsight_worker/domain/*.py src/swingsight_worker/pipeline/*.py
# Worker determinism (Docker, Cloud Run parity — builds linux/amd64, runs twice, same sha256)
scripts/determinism_check.sh
# Validation regression (Phase 7) — agreement/error self-test + per-fault regression
scripts/validation_check.sh --self-test-only   # fast path, no pose
```

See `scripts/CLAUDE.md` for the full script index (live checkpoints, deploys).

## Ask the user before

- Adding a new external service or major dependency, or making an architectural fork.
  Every fork so far was the user's explicit call (PRD §4 "Locked decisions").
- Running the **on-device build** (`npx expo run:ios --device`) or any `eas build` /
  `eas submit` — those are the user's to trigger (Apple auth + 2FA). JS hot-reloads;
  the on-phone run is theirs.
- Changing a locked decision in PRD §4, or anything described as the "governing law".

## Git

`main` only so far (`Co-Authored-By` trailer convention in commit messages). Native
build output (`app/ios/`, `app/android/`), `node_modules/`, Python venvs, `setup.env`,
and `supabase/vault-secrets.sql` are gitignored — don't commit them. Commit/push only
when the user asks.
