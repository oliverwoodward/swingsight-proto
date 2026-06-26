# SwingSight (prototype)

> **Agents / contributors start here:** [`PRD.md`](./PRD.md) is the single source of
> truth — current build status, locked decisions, conventions, gotchas, and the
> per-phase checklist. Read it before doing any work.

A production-quality prototype of the SwingSight golf-swing-analysis pipeline. You
record a swing on your phone; a cloud worker measures it (pose → events → metrics →
fault gates → a deterministic score) and a constrained Claude call writes the
coaching; the app plays your swing back with a skeleton overlay and highlights the
one fault to work on.

**Governing law:** CV measures, the AI explains, the fault library localises.

## Repo layout

```
app/         Expo SDK 56 dev-client app (React Native, TS) — capture + report
worker/      Google Cloud Run Python service — the CV pipeline + the coaching call
supabase/    Auth, Postgres, Realtime, Edge Functions (presigned upload + worker trigger)
```

Architecture: vision-camera (1080p/60fps) → raw TUS upload to **Cloudflare R2** →
**Supabase** triggers the **Cloud Run** worker → results + a 720p/1080p H.264 playback
clip back to R2 → **Skia** overlay report on the phone. Pose = **MediaPipe BlazePose**;
events = kinematic heuristics; coaching = **Claude Haiku 4.5** (key server-side only).

## Run

- **App:** `cd app && npx expo run:ios --device` (builds the dev client onto your
  iPhone; subsequent JS changes hot-reload).
- **Worker:** see `worker/README.md`.
- **Backend:** see `supabase/README.md`.

The full build plan lives at `~/.claude/plans/rosy-popping-hopcroft.md`.
