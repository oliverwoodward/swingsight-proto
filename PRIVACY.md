# SwingSight — privacy & data handling (Phase 7 B)

> Spec §21. This documents what we hold, what reaches the AI, how a user deletes/exports
> their data, and how training use is gated. Final retention windows + legal sign-off are
> **deferred for the prototype** (the user's call) — see the bottom.

## No identifiable data reaches the LLM (audited)

Governing-law corollary: the coaching model only ever sees **measurements + annotated
frames**, never who the golfer is.

- The coaching call is `worker/coaching.py` → `generate_coaching(settings, result,
  keyframes, view, handedness)`. It is handed the `MeasurementResult` (metrics, fault
  gates, score, quality), the rendered keyframe JPEGs, the `view`, and the `handedness` —
  **and nothing else**. `process.py` does not pass `profile_id`, `analysis_id`, or any
  account field into it.
- The prompt (`_build_user_content`) contains: the view + handedness sentence, the metrics
  JSON, the open fault gates, and the base64 keyframe images. `grep` of `coaching.py` for
  `profile_id|email|analysis_id` returns **nothing**. The frozen system prompt is a static
  rubric (fault library + drills + rules).
- Anonymous auth means there is no name/email on the account to leak in the first place; the
  profile id is a random UUID that never enters the prompt regardless.

**Re-audit when changing `coaching.py`:** if you ever add context to the prompt, keep it to
measurements + frames. The schema (`LlmCoaching`) also has no field for a score/joint/frame,
so the model cannot emit one even if asked.

**Anthropic zero-retention (follow-up, not code):** by default the API may retain prompts
briefly for trust-and-safety. For production, request **zero-retention** on the Anthropic
account/org (an account-level agreement, not a code change) so swing frames are not retained
provider-side. Tracked as a launch item, not a prototype blocker.

## Delete my data (right to erasure — spec §21)

`supabase/functions/delete-account` (device JWT, `verify_jwt = true`):

1. Enumerates the caller's **own** R2 object keys under RLS — `raw_object_key` +
   `playback_video_url` from `swing_analyses`, `frame_object_key` from `swing_keyframes`.
2. Deletes those objects from R2 (private bucket; SigV4 DELETE; the R2 secret never leaves
   the function). Best-effort and reported honestly — any object that fails to delete is
   bounded by the R2 lifecycle rules anyway.
3. Deletes the **auth user** with the service role, which **cascades** through the schema
   (`auth.users → profiles → swing_analyses → swing_metrics / swing_keyframes /
   swing_keypoints / drill_recheck`, all `on delete cascade`), removing every row the user
   owns.

The app surfaces this on the **Privacy & data** screen (`app/src/app/privacy.tsx`) behind a
destructive confirmation; on success it signs out the dead session and resets the local
profile, so the next launch mints a fresh anonymous user. Reads keys **before** deleting
rows (or they'd be lost).

## Export my data (right to portability — spec §21)

`supabase/functions/export-data` (device JWT, `verify_jwt = true`): returns the caller's
**own** profile + every swing (status, faults, score, coaching, quality) + metrics + events +
drill rechecks as one JSON bundle, with a short-lived presigned playback link per finished
swing. RLS-scoped, read-only. The app writes the bundle to a file and opens the OS share
sheet.

## Training consent gates the data flywheel

- `UserProfile.trainingConsentAcceptedAt` (separate, opt-in; collected at onboarding,
  surfaced on the Privacy screen) is the gate for any **flywheel** use of a user's swings
  (spec §13.2 — growing the validation set, fine-tuning).
- **There is no flywheel ingestion today.** The golden/validation set
  (`worker/validation/golden_set.json` + the `validation_set` table) is **coach-sourced**,
  not harvested from user swings, so nothing currently consumes user data for training.
- **When a flywheel job is added**, it must filter to consented users only — i.e. only
  ingest swings whose owner has `profiles.training_consent_accepted_at IS NOT NULL`. This is
  the single rule to enforce at that ingestion point; it is called out here so it is not
  missed.

## Retention (deferred for the prototype)

R2 lifecycle rules are already applied (`scripts/apply-r2-lifecycle.mjs`): raw 2d, frames 7d,
playback 30d; keypoints/metrics live in Postgres. The spec's indicative windows (§21) are raw
24–48h, processed ~30d, frames ~7d, keypoints/metrics ~12m, coaching longer. **Reconciling
the exact windows + legal sign-off is intentionally deferred** for the prototype (the user's
call) — the delete/export rights above work regardless of the automatic windows.
