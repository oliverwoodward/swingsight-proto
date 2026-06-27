# SwingSight — PRD & Build Progress (single source of truth)

> **Last updated:** 2026-06-26 · **Current phase:** Phases 0–6 ✅ DONE + LIVE; **Phase 7 (the last build phase) 🟢 CODE-COMPLETE + GREEN** — the validation layer (golden-set + per-fault regression + the structural claim-eligibility gate), the privacy delete/export flow + no-PII-LLM audit, and the EAS/TestFlight config are all built and verified (`scripts/validation_check.sh`, `determinism_check.sh`, `py_compile`, `tsc` all GREEN). **The gate is proven on the real sample:** the two approximate-proxy faults (`reverse_spine_angle`, `over_the_top`) are now `soft_only` — `reverse_spine_angle` still fires but is suppressed from the primary claim, so the sample reports "no clear priority fault" (the honest output) instead of highlighting a crude 2D proxy. **The worker is redeployed (revision `swingsight-worker-00004-wl9`) and the gate is LIVE-PROVEN** — a fresh analysis of the sample through the live worker returns `primaryFaultId=null` / "no clear priority fault" with `reverse_spine_angle` fired-but-suppressed (`claimEligible=false`), instead of highlighting a crude 2D proxy. **Both privacy Edge Functions (`delete-account`, `export-data`) are deployed + ACTIVE.** **The only remainders are inherently human/interactive (USER hand-offs, see §9):** real coach labels for the golden set (never fabricated — the harness reports 0 labels transparently until then), and the interactive `eas build`/`eas submit` to TestFlight (Apple login + 2FA; runbook `app/EAS_DEPLOY.md`). Retention-window reconciliation was DEFERRED for the prototype (USER's call). — Prior: **the user confirmed the first on-device run** (`npx expo run:ios --device`), clearing the last device checkpoints (Phase 1 capture, Phase 4 upload→worker→live status, Phase 5 report). Phase 6 (drill-then-recheck + history/trends) is DONE + LIVE-PROVEN. The worker was redeployed (revision `swingsight-worker-00003`) and `scripts/recheck_checkpoint.sh` drove two same-view swings end to end → both `complete` (primary fault `reverse_spine_angle`), and the 2nd got a `drill_recheck` row (`drill_id=tilt_away_drill`, `target_metric_key=reverse_spine_deg`, `previous=20.0132`, `current=20.0122`, `delta=-0.001`, `improved=true`) — the report leads with it as "Holding steady / about the same" (the −0.001 is sub-threshold cross-host neural noise, correctly absorbed; see §7). **Phase 6 — the drill-then-recheck loop + history/trends — is built end to end on top of the live Phase 4/5 loop:** **(A)** the app stores the recheck LINK on insert (`AnalysisService.findPreviousAnalysisId` → `previous_analysis_id` = the most recent COMPLETE *same-view* analysis, so the worker compares like with like; the device only supplies the link, never a value); **(B)** a new **deterministic** worker step (`worker/recheck.py`) runs AFTER `write_complete` (like coaching, so it's OUT of the measurement payload + `run_local.py` and determinism stays byte-identical): it reads the prior analysis's chosen fault (`coaching.chosenFaultId ?? primary_fault_id`), that fault's prescribed drill (→ the tracked metric + improvement direction), the prior + current `ok` measured values of that metric, computes a `delta` + direction-aware `improved`, and writes a `drill_recheck` row — writing **nothing** if there's no honest comparison (first swing / cross-view / metric not `ok` / no fault); **(C)** the report now **leads with the comparison** (`RecheckBanner`, direction-aware honest copy, friendly ranges not raw degrees for approximate metrics, no fabricated comparison when none exists); **(D)** Home + a new `/history` route show past swings (view/fault/score + a Skia mini-skeleton thumbnail from the `top` keyframe's measured pose) and a **tempo-over-time trend** (Skia sparkline). **Verified GREEN:** worker `py_compile`, `scripts/determinism_check.sh` (byte-identical WITH the recheck step in the tree — it's structurally isolated), app `tsc`. Live proof = the USER redeploys the worker (`scripts/deploy-worker.sh`) then runs `scripts/recheck_checkpoint.sh` (two same-view swings → a `drill_recheck` row on the 2nd; same clip twice → `delta ≈ 0`). — Prior context: Built on top of the GREEN Phase-3 worker: **(5a)** the worker's Claude Haiku 4.5 coaching call (`worker/coaching.py`) — runs AFTER `write_complete`, constrained structured output via `messages.parse()`, validates the LLM's fault choice against the open CV gates + discards any score/joints/frames, deterministic template fallback on any failure, writes only the `coaching` jsonb; **(B)** the `playback-url` Edge Function (presigned GET, symmetric to `upload-url`); **(4)** the app `AnalysisService` + `useAnalysisRunner` + `processing.tsx` state-machine screen, wired into `capture.tsx`; **(5b)** the report screen `report/[id].tsx` — expo-video playback + Skia skeleton overlay synced via a rAF→Reanimated-SharedValue loop, library-owned confidence-gated fault highlight, headline/why/drill/metrics/score/PhaseScrubber. App `tsc` GREEN; worker `py_compile` GREEN; determinism GREEN (byte-identical on the Cloud-Run-parity image WITH coaching in the tree — it's isolated from the measurement payload). **Worker redeployed with `ANTHROPIC_API_KEY` + `playback-url` deployed, and the live coaching call is PROVEN on real infra:** `scripts/checkpoint.sh` → `complete`, `coaching` jsonb `source:"llm"`, `chosenFaultId` ∈ open gates (= the CV primary `reverse_spine_angle`), drill `tilt_away_drill`, `llmConfidence` 0.85, score gracefully `withheld` on the far/low-conf sample. **iOS now BUILDS GREEN** for simulator + physical device (arm64, code-signed): fixed the Xcode-26/Swift-6.2 incompatibility in `expo-modules-jsi`/`-core` (`weak let` → `nonisolated(unsafe) weak var`) durably via **patch-package** (`app/patches/` + a `postinstall` hook), and changed the bundle id `com.swingsight.app` → `com.swingsight.proto` (the original was taken by another Apple team). **Only remaining:** the USER runs `cd app && npx expo run:ios --device` (compiles/signs/installs/launches) for the first true end-to-end run.
>
> This is the living tracker for the SwingSight prototype. Any agent picking up work
> should read this file top to bottom first, then continue from **§9 Phase status**.
> Keep this file updated: tick checkboxes as you finish them, and update the
> "Last updated / Current phase" line above.

---

## 0. How agents should use this document

1. Read this whole file, then read the two reference docs in §10.
2. Check the task list (TaskList tool) — phases map to tasks #1–#8.
3. Work the **current phase's** checklist in §9, in order. Mark the task in_progress.
4. Build to **production quality** — no mock/placeholder *data*. Stubs that get filled
   in a later phase are fine; fake analysis data shown to the user is not.
5. **Conform to the domain contract** (§6) — it is shared with the worker.
6. Verify with the commands in §8 after changes.
7. **Update this file** (tick checkboxes, note new gotchas/decisions) as you go.
8. Keep decisions explicit. **Ask the user before** adding a new external service or
   making a major architectural fork — every fork so far was the user's call (§4).
9. **Do not run the device build** mid-build — the user is building everything before
   the first run. JS hot-reloads; the on-phone run is the user's to trigger.

---

## 1. Product in one paragraph

A golfer records a swing on their phone (face-on or down-the-line). The phone uploads
the raw clip; a cloud worker measures it (pose → swing events → metrics → fault gates →
a deterministic score) and a constrained LLM call writes the coaching. The app plays
the swing back with a skeleton overlay, highlights the single priority fault on the
right body segment across the right phase window, and shows the one thing to work on
plus a drill. A drill-then-recheck loop tracks improvement over time.

## 2. The governing law (do not violate)

> **CV measures. The AI explains. The fault library localises.**

- The **measurement layer** (pose, events, metrics, gates, score, overlay coordinates)
  is deterministic and lives in the cloud worker. Same input → same output.
- The **interpretation layer** (the LLM) only writes language. It **never** emits a
  joint index, a frame number, or a score. It may only select a fault whose gate the
  CV opened.
- The **fault library** owns the highlight (which segment, which phase window); the app
  draws it from the CV's measured coordinates, handedness-aware and confidence-gated.
- Any numeric score is computed deterministically from metrics, never by the LLM.
- Fail gracefully: a bad/unreadable clip shows re-record guidance, never a fabricated
  analysis.

## 3. Architecture / data flow

```
iPhone (Expo dev client)                 Cloudflare R2            Google Cloud Run (Python)
  capture (vision-camera 1080p/60fps) ── raw clip (TUS) ──►  bucket ──► worker:
  onboarding / report (Skia overlay)                          │           ingest+normalize 60fps
        ▲                                                     │           BlazePose pose
        │  Supabase Realtime (status + result)                │           blur refine
        │                                                     │           heuristic 8 events
  Supabase (Postgres, Auth=anon, Edge Fns) ◄── results ───────┘           metrics + fault gates
        ▲         │  Edge Fn: mint R2 presigned upload URL                 deterministic score
        │         │  Edge Fn: DB webhook → POST worker /analyze            output assembly
        └─────────┘                                            playback clip + keyframes ─► R2
                                                               Claude Haiku 4.5 coaching call
```

Multi-cloud is intentional and fine: R2 speaks the S3 API; Cloud Run is just an HTTPS
container. The Anthropic key, the Supabase service-role key, and R2 secrets live only
in the worker / Edge Functions — never on the device.

## 4. Locked decisions (chosen by the user — do not change without asking)

| Concern | Decision |
|---|---|
| App runtime | Expo SDK 56 **development build** (custom dev client). TestFlight later via EAS. |
| Capture | **react-native-vision-camera v5**, **1080p / 60fps**, face-on **and** DTL views |
| Auth | **Supabase anonymous auth** (zero-friction; each device = its own RLS-partitioned user) |
| Upload | Raw clip → R2 via **presigned URL + TUS resumable/multipart**, background |
| Storage | **Cloudflare R2** (zero egress). Worker writes a 720p/1080p H.264 playback clip back; raw lifecycle-deleted after processing |
| Compression | **In the cloud worker** (no on-device transcode) |
| Backend | **Supabase** (Postgres, Auth, Realtime, Edge Functions) |
| Worker host | **Google Cloud Run** (Python, scale-to-zero); queue (Pub/Sub/Cloud Tasks) only when burst load demands |
| Pose | **MediaPipe BlazePose** (33 landmarks incl. wrists; Apache-2.0) |
| Events | **Kinematic heuristics** for the 8 events (commercial-safe; SwingNet/GolfDB avoided — CC BY-NC) |
| Blur refinement | Deterministic outlier-detect + smooth (Savitzky-Golay/Kalman) |
| 3D lift | **Off at launch** (2.5D only for orientation/phase, never shown as measured angles) |
| Club tracking | **Deferred** — DTL ships pose-only (posture, 2D hand-path plane proxy) |
| LLM | **Claude Haiku 4.5** (`claude-haiku-4-5`, $1/$5 per 1M tok), provider-abstracted, key server-side only |
| Score | **Deterministic** consistency/progress score vs the user's own baseline, **confidence-gated** (withheld/softened on poor visibility), tappable to reveal driving metrics; fault+drill stays front-and-centre |

### Implementation deviations from the original plan (for build reliability)
- **No NativeWind.** Use the template's theme system (`Colors`/`Spacing`/`Fonts`) +
  RN `StyleSheet` + the brand palette. Lower native-build risk; the plan's NativeWind
  rationale ("match the sibling repo") was soft.
- **vision-camera v5 (Nitro), not v4.** v5 is what's compatible with RN 0.85; v4's
  Expo config plugin doesn't fit this stack.

## 5. Repo layout

```
swingsight_proto/
  PRD.md            ← this file (single source of truth)
  README.md         ← short orientation
  app/              ← Expo SDK 56 dev-client app (RN 0.85, React 19, expo-router, TS)
    src/app/        ← expo-router routes (@/* -> src/*); index gate, (onboarding)/ group, capture.tsx
    src/domain/     ← the shared contract (see §6)
    src/components/ ← UI kit (ui/screen,button,option-card) + onboarding/ + capture/ + themed-text/view
    src/constants/  ← theme.ts (Colors/Spacing/Fonts), brand.ts (Brand colours), capture.ts (fps/res/limits)
    src/contexts/   ← profile.tsx (UserProfile state), onboarding-draft.tsx (in-flow selections)
    src/services/   ← profile-store.ts (ProfileStore iface; secure-store impl, Supabase swap in Phase 2)
    src/hooks/      ← use-theme.ts (returns the active color object)
    src/utils/      ← id.ts (crypto UUID v4 for the local profile id)
    app.json        ← config (bundle id, permissions in ios.infoPlist, plugins)
    ios/            ← prebuilt native project (gitignored; re-prebuild on native config change)
  worker/           ← Cloud Run Python service (FastAPI skeleton; CV pipeline = Phase 3)
    src/swingsight_worker/{main.py,config.py,pipeline/}
    Dockerfile, pyproject.toml, .env.example
  supabase/         ← migrations/ + functions/ (built in Phase 2)
```

## 6. Domain contract (`app/src/domain/`, import via `@/domain`)

The single contract the app and the worker's JSON output both conform to. **Framework-
free TypeScript.** When you change a shape here, the worker's output must match.

- `types.ts` — `UserProfile` (handedness `'RH'|'LH'`, `preferredView` `'face_on'|'dtl'`,
  `consentAcceptedAt`), `SwingAnalysis` (status state machine
  `uploading→queued→processing→complete|failed|unreadable`, keypoints, events, metrics,
  faults, primaryFaultId, `SwingScore`, `CoachingResult`, `QualityReport`),
  `Metric`, `FaultLibraryEntry`, `FaultEvaluation`, `Drill`, `DrillRecheck`,
  `AnalysisStatusUpdate`.
- `keypoints.ts` — BlazePose-33 indices, `SKELETON_EDGES`, **the single-source
  handedness lead/trail map** (`jointRefToIndex`) — a wrong map highlights the wrong arm.
- `events.ts` — the 8 events (`SWING_EVENTS`), `resolvePhaseWindow`.
- `faultLibrary.ts` — `FAULT_LIBRARY_VERSION`, `METRIC_META` (metric catalogue +
  reliability tiers + friendly ranges), `DRILLS`, and the **5 launch faults**:
  `chicken_wing` (FO), `reverse_spine_angle` (FO), `excessive_head_movement` (FO),
  `over_the_top` (DTL), `early_extension` (DTL).
- `gating.ts` — `evaluateGate`, `severityBand`, `pickPrimaryFault`, `LOW_CONFIDENCE`.
- `highlight.ts` — `resolveFaultHighlight` (logical joints + handedness + events →
  drawable points + time/frame window).
- `coordinates.ts` — `computeContainFit` (must match expo-video `contentFit="contain"`),
  `projectPoint`, `interpolateFrame` (smooth 60fps overlay between sampled poses).

## 7. Gotchas already discovered (don't re-derive)

- **vision-camera v5.0.11 has NO Expo config plugin.** Do **not** add
  `"react-native-vision-camera"` to `app.json` plugins (it crashes `expo config`).
  Camera/mic permissions are set via `ios.infoPlist` + `android.permissions` — leave them.
- **vision-camera v5 is Nitro-based** and needs `react-native-nitro-modules` +
  `react-native-nitro-image` (both installed). The v5 **recording API differs from v4**
  (the original note was v4-shaped). What actually ships (verified against the installed
  5.0.11 source, see `capture.tsx`):
  - View: `<Camera device={useCameraDevice('back')} isActive constraints={[{fps:60}]}
    outputs={[videoOutput]} resizeMode="cover" />`. **fps is a `constraints` entry**, not a prop;
    **no `format` prop** — resolution is the video output's `targetResolution`.
  - Permissions: `useCameraPermission()` / `useMicrophonePermission()` →
    `{ hasPermission, canRequestPermission, requestPermission }`.
  - Recording: `const out = useVideoOutput({ targetResolution: CommonResolutions.FHD_16_9,
    enableAudio })` → `const rec = await out.createRecorder({ maxDuration })` →
    `await rec.startRecording(onFinished, onError)` → `rec.stopRecording()`. A `Recorder`
    records **once** (create a fresh one per take); `onFinished(filePath, reason)` gives a
    **filesystem path, not a `file://` URL** (prefix `file://` for `expo-video` / `new File()`).
  - No frame processors needed.
- **No `babel.config.js` / `metro.config.js`** in `app/` — the stack runs on Expo SDK 56
  defaults (Metro tsconfig-path alias resolution for `@/*`, worklets babel auto-plugin).
  Don't add them without a reason; if you do, re-verify reanimated/worklets still build.
- **File metadata:** `expo-file-system` (56) uses the class API — `new File(uri).size`
  (bytes) / `.exists`. The legacy `getInfoAsync` is deprecated.
- **iOS is already prebuilt** (`app/ios`). After any native config change (app.json
  plugins/permissions, new native dep), re-run `npx expo prebuild -p ios --clean`.
- **Xcode 26 / Swift 6.2 breaks Expo SDK 56 native modules — fixed durably via patch-package.**
  The first real device compile (Phase 0 only ran `pod install`, never `xcodebuild`) failed:
  Xcode 26.1.1's Swift compiler (1) rejects `weak let` (`'weak' must be a mutable variable`)
  and (2) rejects a mutable stored property in a `Sendable` class. `expo-modules-jsi` (14
  Swift files) and `expo-modules-core` (`SharedObjectRegistry.swift`) ship `weak let runtime/
  appContext` in `Sendable` classes. Fix = `weak let` → `nonisolated(unsafe) weak var`
  (the property is only set in `init`, so the unsafe assertion is correct). Captured durably
  with **patch-package**: `app/patches/expo-modules-{jsi,core}+<ver>.patch` (jsi patch is
  scoped to `apple/Sources/*.swift` only — exclude the prebuilt xcframework/`.build`/
  `.DerivedData` artifacts or the patch balloons to MBs), applied by a `postinstall:
  "patch-package"` hook (patch-package is a devDep). So `npm install` re-applies it
  automatically. Simulator **and** device (arm64) builds are GREEN after the patch.
  - NB: these modules compile from source on Xcode 26 because the shipped prebuilt xcframework
    is ABI-incompatible; the patched sources are what get compiled. If Expo later ships an
    Xcode-26-compatible SDK 56 patch, drop `patches/` + the `postinstall` (patch-package warns
    on a version mismatch). If a future clean build ever recompiles `expo-modules-core` from
    source and errors on other original `weak var … : Sendable` decls, extend the same
    `nonisolated(unsafe)` fix to them.
- **Bundle identifier changed `com.swingsight.app` → `com.swingsight.proto`** (app.json ios+
  android, the two pbxproj `PRODUCT_BUNDLE_IDENTIFIER`, and the Info.plist URL scheme). The
  original was registered to another Apple team, so device signing failed with "Failed
  Registering Bundle Identifier … not available". The new id auto-provisioned under the user's
  team (`J2TZ34TYLC`, Apple Development: owoodward21@gmail.com). **Both the simulator and the
  device (arm64, code-signed) builds are GREEN** — `npx expo run:ios --device` now compiles,
  signs, installs and launches; it's the only remaining (interactive) step.
- **Supabase isn't built until Phase 2.** In Phase 1 persist the `UserProfile` locally
  with `expo-secure-store` behind a small profile context/service, so Phase 2 swaps the
  backing store to Supabase without touching the UI.
- **TS 6:** `tsc` with files on the CLI needs `--ignoreConfig`; prefer
  `npx tsc --noEmit -p tsconfig.json`. A `declarations.d.ts` shims `*.css` imports.
- `app/AGENTS.md` reminder: read https://docs.expo.dev/versions/v56.0.0/ for exact
  Expo SDK 56 APIs before writing Expo code.
- **Phase 2 backend wiring (built):**
  - **Schema mirrors `domain/types.ts`.** Per-frame keypoints are stored one row
    **per frame** with the 33 landmarks as `jsonb` (`swing_keypoints.landmarks`) —
    a deliberate, documented deviation from the spec's one-row-per-joint sketch
    (≈33× fewer rows, maps 1:1 onto `KeypointFrame`). Worker-computed sub-objects
    with no child table (`score`, `coaching`, `quality`, `faults`, `keypoints_meta`)
    are `jsonb` columns, **null until measured** (never defaulted to fake data).
  - **A guard trigger** (`guard_swing_analyses_update`) freezes worker-owned columns
    from client updates: an authenticated user may only insert a swing and advance
    `uploading → queued`. The worker writes results via the **service role** (RLS +
    guard bypassed). This enforces "no fabricated analysis from the device" in the DB.
  - **The webhook is pg_net + Vault**, not a dashboard webhook: an `after insert or
    update` trigger fires `on-swing-insert` only when a row is freshly `queued` with
    `raw_object_key` set. The Edge Function base URL + shared secret live in **Vault**
    (`edge_function_base_url`, `on_swing_insert_secret`) so nothing is hardcoded and
    migrations apply before provisioning (the trigger no-ops if Vault is empty).
  - **Anonymous auth** must be enabled on the hosted project (`supabase config push`
    applies `config.toml`, or toggle it in the dashboard). The session is persisted
    in the **keychain via a chunked expo-secure-store adapter** (Supabase sessions
    exceed SecureStore's ~2KB item limit).
  - **The app degrades gracefully pre-provisioning:** if `EXPO_PUBLIC_SUPABASE_*` are
    unset, `AuthProvider`/`ProfileBootstrap` fall back to the Phase-1 device-local
    store + local UUID. Once set, it uses Supabase + `auth.uid()`. UI never changes.
  - **R2 is single-shot presigned PUT in Phase 2** (`aws4fetch` SigV4 in the Edge
    Function). Resumable multipart/TUS is the **Phase-4** app upload — same S3 endpoint.
  - **Local `supabase start`:** `config.toml` ports are remapped to `553xx` so the
    stack coexists with another local Supabase project; this only affects local dev.
    SQL was validated by applying all migrations to an isolated throwaway DB in a
    running Supabase Postgres (the `auth`/`vault`/`pg_net`/realtime objects exist there).
- **Phase 3 worker gotchas (built):**
  - **MediaPipe = Tasks API, NOT `solutions`.** Current wheels (0.10.3x, incl. macOS
    arm64) ship only `mediapipe.tasks`; `mp.solutions.pose` is gone → `AttributeError`.
    Use `mediapipe.tasks.python.vision.PoseLandmarker` (IMAGE mode = deterministic,
    per-frame independent). It needs a bundled `pose_landmarker_full.task` model
    (Dockerfile downloads it to `/app/models`; `POSE_MODEL_DIR` points at it).
  - **MediaPipe pulls `opencv-contrib-python`** (its cv2). Do **not** also pin
    `opencv-python-headless` — two cv2 providers shadow each other. It's the non-headless
    build, so the image installs `libsm6 libxext6 libxrender1` (+ libgl1/libglib2.0-0).
  - **Determinism is structural, and it's GREEN.** `determinism.py` sets single-thread
    env (`OMP/OPENBLAS/MKL/TF_*_THREADS=1`, GPU off, `PYTHONHASHSEED=0`) **before** any
    CV import (so it's imported first in `main.py`/`run_local.py`), and every emitted
    float is quantised via `q()`. Proof: `run_local.py` ×2 → byte-identical sha256;
    `scripts/determinism_check.sh` repeats it inside the linux/amd64 image.
  - **Local determinism run** (no Docker): `uv venv --python 3.12`, `uv pip install
    mediapipe av scipy pydantic-settings`, then `PYTHONPATH=src POSE_MODEL_DIR=worker/models
    python -m swingsight_worker.run_local <video> --view face_on`. System Python is 3.14
    (no MediaPipe wheels) — use 3.12.
  - **iPhone clips are often portrait + rotated.** ffmpeg auto-rotates by default; we
    keep that, strip the rotate tag, and run pose on the SAME upright clip the app plays,
    so the skeleton can't be mirrored/rotated vs the video. (`keypoints_meta.videoWidth/
    Height` are the playback dims — e.g. the 4K sample becomes 406×720 portrait.)
  - **`playback_video_url` stores the R2 OBJECT KEY**, not a URL (private bucket). Phase
    4/5 mints a short-lived presigned GET on report load (a `playback-url` Edge Function
    symmetric to `upload-url`) — a long-lived signed URL would expire before the 30-day
    object. Decided; documented in `worker/DEPLOY.md`.
  - **`/analyze` runs synchronously** (Cloud Run guarantees CPU during a request;
    scale-to-zero between). Deploy with `--concurrency=1 --cpu=2 --memory=4Gi
    --timeout=600`. Returns 200 once a terminal status is on the row (truth is in the DB/
    Realtime), so pg_net/the Edge Function never retry-storm; only auth failures are non-2xx.
  - **Approximate 2D proxies are crude** (shoulder/hip turn, X-factor, 2D plane,
    over-the-top). They can read degenerate (0 / >plausible) on off-angle clips; they're
    tagged `approximate`, shown as ranges/soft, **excluded from the score**, and only the
    plausible ones gate a fault. Tightening them is Phase 7 validation work, not a launch
    blocker — the reliable metrics (tempo/head/lead-arm/follow-through/balance) carry Phase 3.
- **Phase 3 Cloud Run deploy gotchas (live):** worker runs in GCP project **`swingsight-proto`**
  (`europe-west1`), URL `https://swingsight-worker-ayxycat24a-ew.a.run.app`. Deploy with
  `scripts/deploy-worker.sh` (idempotent: project/billing/APIs/key-fetch/deploy/secret-wire).
  - **Brand-new GCP projects need manual IAM.** Google stopped auto-granting roles to the
    default compute SA: source deploys fail with `storage.objects.get` denied until you grant
    `${PNUM}-compute@developer` the `cloudbuild.builds.builder` + `storage.objectViewer` +
    `artifactregistry.writer` + `logging.logWriter` roles. Also create the
    `cloud-run-source-deploy` Artifact Registry repo if `--source` races on a fresh project.
    These IAM grants + the AR repo are one-time per project (already done for swingsight-proto).
  - **Org policy blocks public Cloud Run.** The `swing-sight.com` org enforces Domain
    Restricted Sharing (`iam.allowedPolicyMemberDomains` → customer `C045p9nk1`), so
    `--allow-unauthenticated` (allUsers) is rejected. Fix used (user-approved): a **project-scoped**
    org-policy override (`allowAll: true`) on `swingsight-proto` only, then add the allUsers
    `run.invoker` binding (retry ~90s for propagation). The worker's invoker-token still gates calls.
  - **`GET /healthz` returns a Google-frontend 404** (that path is intercepted at the edge).
    Non-issue — the webhook only calls `POST /analyze`; use `/docs` or `/openapi.json` to confirm
    the app is up. (Could rename to `/health` later to avoid the quirk.)
  - **Worker runs synchronously**; the real clip took ~96s end to end (download 101 MB + Full
    pose on 453 frames + transcode + uploads + writeback). Comfortably within the spec's <30s
    target only after on-device trim (the sample is untrimmed 7s/4K); fine for the prototype.
- **Phase 4/5 gotchas (built):**
  - **Coaching is the ONLY non-deterministic step and is structurally isolated.** It lives in
    `worker/coaching.py` + `writeback.write_coaching` and is called from `process.py` AFTER
    `write_complete`. It is NOT imported by `run_local.py`/`serialize.py`/`assemble.py`, so the
    Phase-3 determinism payload (and `scripts/determinism_check.sh`) is byte-identical
    regardless of the LLM. The LLM's Pydantic schema (`LlmCoaching`) has no field for a
    score/joint/frame, so "discard LLM score/joints/frames" is enforced by construction; the
    one load-bearing runtime check is `chosen_fault_id ∈ open gates` (else template fallback).
  - **The open gates the LLM may pick from** = the eligible `FaultEvaluation`s (mirror of
    `gating.pick_primary_fault`'s filter: `fired && confidence≥0.5 && status=='ok'`). If none
    are open, coaching is the deterministic "no fault" template (no LLM call). Template fallback
    choice is always the worker's `primary_fault_id`.
  - **`ANTHROPIC_API_KEY` / `COACHING_MODEL` are passed by `deploy-worker.sh` from `setup.env`**
    (default empty / `claude-haiku-4-5`). Empty key OR `COACHING_PROVIDER!='anthropic'` →
    template-only (so a keyless deploy and local runs still produce grounded coaching). The key
    is server-side only — never on the device. Coaching cost target <1¢ (Haiku 4.5 $1/$5 + a
    cached system prompt + ~8 small annotated JPEGs).
  - **`messages.parse(output_format=Pydantic)` needs a recent `anthropic` SDK** — pyproject
    pins `anthropic>=0.40` and Cloud Build installs the LATEST, which has `messages.parse`. The
    whole call is wrapped so any SDK/API failure degrades to the template (never a blank report).
  - **`playback-url` Edge Function uses a 1h presigned GET** (vs `upload-url`'s 15min) because
    expo-video re-issues range requests while the user scrubs/replays — a 15min URL would
    expire mid-watch. Still short-lived, far inside the 30-day playback lifecycle. It reuses the
    existing function secrets (SUPABASE_URL/ANON_KEY/R2_*); no new secrets. `config.toml` has
    `[functions.playback-url] verify_jwt = true`. Deploy: `supabase functions deploy playback-url`.
  - **App upload uses `expo-file-system/legacy`** (`createUploadTask`, `BINARY_CONTENT`, PUT) for
    the presigned single-shot upload with progress — the new `File` class API (used in
    `capture.tsx` for `.size`) has no upload method. The presigned PUT signs only the `host`
    header, so sending `Content-Type` does NOT break the signature (proven by the Phase-2 101MB
    upload). Client mints the analysis id (`createId()`) and uses it as BOTH the row id and the
    R2 object name so they stay aligned.
  - **Overlay sync (the no-drift design):** the report's `SwingStage` sizes the video box to the
    clip's exact aspect ratio (`series.videoWidth/videoHeight`), so expo-video `contentFit=
    "contain"` has zero letterbox and `computeContainFit` returns a pure scale (offsets ≈ 0) —
    the skeleton can't slide off. A `requestAnimationFrame` loop reads `player.currentTime`,
    interpolates+projects on the JS thread (canonical `coordinates.ts` maths), and writes a flat
    coord payload into a Reanimated SharedValue; Skia assembles SkPaths from it in worklets on
    the UI thread (cheap). If on-device perf bites, move interpolation into a worklet next.
  - **The fault highlight degrades** (spec §11.3): crisp polyline when the worker's fault
    confidence ≥0.5 AND the per-frame highlight-joint visibility ≥0.35; a crisp ring for a
    single-joint fault (head); else a soft translucent region; words-only if events/highlight
    don't resolve. Highlight limb is `coaching.chosenFaultId ?? primaryFaultId`, handedness from
    the row — never the AI.
  - **Coaching arrives as a SECOND Realtime UPDATE** after `complete` (the `coaching` column
    fills a moment later). The report subscribes and shows "Writing your feedback…" until it
    lands. Updating only `coaching` does NOT re-fire the queued-swing webhook (that trigger keys
    on a status transition to `queued`); the service role bypasses the column guard.
  - **Navigation:** `capture.tsx` → `router.replace('/processing')` → (on `complete`)
    `router.replace('/report/[id])`. Because capture is a `fullScreenModal`, the replaced
    screens may inherit modal presentation — cosmetic only; the report's ✕ closes to Home. If it
    reads oddly on device, give `processing`/`report/[id]` an explicit `presentation: 'card'`.
- **Phase 6 gotchas (built):**
  - **The recheck is structurally isolated like coaching, and determinism stays GREEN.** It's a
    SEPARATE `process.py` step AFTER `write_complete` (`worker/recheck.py` + `writeback.
    write_drill_recheck`) and is NOT imported by `serialize.py`/`assemble.py`/`run_local.py`, so
    `scripts/determinism_check.sh` is byte-identical regardless. It depends on a PRIOR analysis
    (an external input) — that's exactly why it must stay out of the measurement payload.
  - **What "chosen fault" the recheck tracks (decided + documented):** the PREVIOUS analysis's
    `coaching.chosenFaultId` if a fault was chosen, else its deterministic `primary_fault_id`
    (the coaching choice is validated to be one of the CV's open gates, so the two usually agree;
    `primary_fault_id` is the anchor). That fault's PRESCRIBED drill (prior `coaching.drillId`,
    else the fault's first eligible drill) names the tracked metric and the improvement direction
    — and **every drill's `target_metric_key` IS its fault's `gate.metric_key`**, so the drill and
    the gate can never disagree about what to re-measure. `delta = current − previous`; `improved`
    is `delta < 0` for a `decrease` drill, `delta > 0` for `increase`. All current drills decrease.
  - **The delta is NEVER LLM-generated** (governing law). The worker computes it from the two `ok`
    measured values; the LLM coaching call was left untouched (the report words the comparison
    deterministically in `recheck-copy.ts` — even safer than letting the LLM phrase it). Both
    endpoints must be `status == 'ok'` or nothing is written; the current value comes from the
    in-memory `result.metrics` (no extra round-trip), the previous from `swing_metrics`.
  - **`drill_recheck` is NOT Realtime-replicated** (only `swing_analyses` has replica identity
    full + is in the publication). It's written a beat after `complete` (right after coaching), so
    the report fetches it with a short **bounded retry** (`use-report`, 5×1.5s) rather than via a
    Realtime event. If it never lands (first-ever/cross-view swing, metric not comparable) the
    report simply shows no comparison — never a fabricated one.
  - **The device supplies only the LINK.** `previous_analysis_id` is set on INSERT (the insert RLS
    only checks `profile_id = auth.uid()`; the column guard freezes worker-owned columns on UPDATE
    only, and doesn't list `previous_analysis_id` anyway). The worker re-verifies same-profile +
    same-view + `complete` before comparing, and re-measures the value itself.
  - **History uses TWO plain queries, not PostgREST embedded filtering** (`fetchSwingHistory`):
    the terminal swings, then a batched `swing_metrics` tempo query over the returned ids — the
    `!inner` / embedded-filter semantics are ambiguous enough to risk silently dropping a complete
    swing, so they're avoided. The tempo trend is derived from those same items (no third query).
  - **History thumbnails are Skia mini-skeletons from stored keypoints** (`HistoryThumb`), fetched
    lazily per row (one keyframe row → one keypoint row), drawn from the `top` event's measured
    pose — the product's signature visual, real data, no R2 round-trip, graceful view-coded tile
    when a pose isn't available. FlatList virtualisation keeps the per-row fetches bounded.
  - **Home is now dark** (`Screen background={Brand.surfaceDark}` + explicit light hero text) so
    the dark-surface history components (`TempoTrend`/`SwingHistoryCard`) are consistent with the
    rest of the post-onboarding app (report/processing/history/capture) regardless of system theme.
  - **Determinism is per-RUNTIME, not cross-host — and that's exactly why the recheck thresholds
    in the copy layer matter.** The live recheck test uploaded the SAME clip twice and got
    `reverse_spine_deg` `20.0132` vs `20.0122` (`delta −0.001`), not an exact 0. `determinism_
    check.sh` proves byte-identical output *in one container*; two separate Cloud Run requests can
    land on different hosts where the neural pose model's TFLite/XNNPACK math differs at the
    ~1e-3 level, which wiggles an *approximate* metric. The worker's `improved` boolean is a raw
    `delta < 0`, so it read `true` on −0.001 — but `utils/recheck-copy.ts` has a per-unit
    **meaningful-change floor** (`deg: 2`, `cm: 1`, `ratio: 0.2`, …) that classifies sub-floor
    moves as "about the same", so the UI never oversells hardware noise as improvement. Lesson:
    present the recheck through the threshold, never the raw boolean; the deterministic delta is
    still stored honestly. (For reliable metrics it also only shows raw before→after numbers, and
    approximate metrics stay qualitative — so the 20.01° never reaches the user as a figure.)

## 7b. Phase 7 gotchas (built)
- **The validation gate changes a live-proven path — on purpose.** Gating
  `reverse_spine_angle` + `over_the_top` to `soft_only` means a fault can FIRE with high
  confidence yet not be selectable as the primary claim. On the sample clip
  `reverse_spine_angle` fired (conf 0.807, status ok) but `primaryFaultId` is now `None` →
  the report leads with "Looking solid / no clear priority fault" + the soft metric readout,
  which is the honest output (we don't highlight a crude 2D proxy we haven't validated).
  **Consequence for `scripts/recheck_checkpoint.sh`:** the identical-sample path used to write
  a `drill_recheck` row off `reverse_spine_angle`→`tilt_away_drill`→`reverse_spine_deg`; with
  the gate it now writes **no row** on that clip (no claim-eligible fault → no recheck). The
  recheck MECHANISM is intact — it just needs a swing that fires a *reliable* fault
  (chicken_wing / head / early_extension). Not a regression; the expected new behaviour.
- **`claimEligible` is an additive, deterministic field on every `FaultEvaluation`.** It's a
  constant from the library (`entry.validation.claimEligibility == 'drives_claim'`), so the
  determinism payload stays byte-identical run-to-run (`determinism_check.sh` GREEN with it in
  the stream). The app reads `faults` as a plain cast, so the new field flows through with no
  app parsing change; the app never calls `pickPrimaryFault` itself (it reads the worker's
  `primary_fault_id`), so the TS gate is just kept in sync for correctness/tests.
- **No fabricated coach labels — enforced at load, not by discipline.** `validation/manifest.py`
  rejects a labelled swing without a `labeledBy`, and rejects a `pending_coach_review` swing
  that carries a verdict. So a half-entered or invented label fails loudly. The agreement rate
  is over REAL labels only (0 today → "not measurable", never faked). The pipeline's own
  prediction is never used as a label (that would be circular) — it's printed for review only.
- **The regression runner reuses the determinism core verbatim** (`assemble.run_measurement`),
  so it READS the deterministic measurement and never perturbs it. `validation/` is NOT imported
  by `run_local.py`/`serialize.py`, so it can't affect the determinism payload. Run it natively
  with the `.venv-check` venv (has mediapipe); `--self-test` needs no pose/clips.
- **EAS: the project already existed.** `@swingsight/swingsight` (projectId
  `d19293ab-2782-47de-9934-d7f0f775d6b6`) under the `swingsight` org — `eas init` refused to
  re-create it; just wire `extra.eas.projectId` + `owner` in app.json. **No git repo at the
  root** → EAS commands need `EAS_NO_VCS=1` (archives the dir respecting `.gitignore`, which
  correctly excludes `node_modules/` + `ios/` so EAS does a clean cloud prebuild) — or `git init`.
  The Xcode-26 patches apply in the cloud because `npm ci` (lockfile present) runs the
  `postinstall: patch-package` devDep hook; verify "applying 2 patches" in the build logs. Two
  config fixes the first build surfaced: `ITSAppUsesNonExemptEncryption=false` (export
  compliance) and DROP the per-profile `channel` (no `expo-updates`/OTA installed → it warns).
- **Delete-my-data reads R2 keys BEFORE deleting rows.** `delete-account` enumerates the
  user's object keys (raw/playback/keyframes) under RLS first, purges R2, then service-role
  deletes the auth user (DB cascade). Order matters (deleting rows first loses the keys);
  partial R2 failures are bounded by the lifecycle rules and reported honestly. The
  `SUPABASE_SERVICE_ROLE_KEY` is auto-injected into Edge Functions (no new secret).

## 8. Verify / commands

- App typecheck: `cd app && npx tsc --noEmit -p tsconfig.json`
- App config sanity: `cd app && node node_modules/expo/bin/cli config --json --full >/dev/null`
- Worker syntax: `cd worker && python3 -m py_compile src/swingsight_worker/*.py src/swingsight_worker/domain/*.py src/swingsight_worker/pipeline/*.py`
- Worker determinism checkpoint (Docker, Cloud Run parity): `scripts/determinism_check.sh`
  (builds the linux/amd64 image, runs the measurement twice → asserts identical sha256)
- **Validation regression (Phase 7): `scripts/validation_check.sh`** — the agreement/error/bar
  self-test (no pose), then the per-fault regression over the local golden set; exits non-zero
  only when a claim-eligible fault drops below its bar. `--self-test-only` skips the pose run.
- Worker local run (fast, native): `cd worker && PYTHONPATH=src POSE_MODEL_DIR="$PWD/models" \
  .venv-check/bin/python -m swingsight_worker.run_local <video> --view face_on --handedness RH`
- **Live recheck loop (Phase 6; AFTER a worker redeploy):** `scripts/recheck_checkpoint.sh
  [VIEW] [HANDEDNESS]` — drives two same-view swings in one session, polls each to `complete`,
  then asserts a `drill_recheck` row on the 2nd with a sensible delta + `improved`. (Same clip
  twice → `delta ≈ 0`; a different swing shows real movement.)
- On-device run (USER triggers, later): `cd app && npx expo run:ios --device`

## 9. Phase status

Legend: `[x]` done · `[ ]` todo · `[~]` in progress

### Phase 0 — Scaffold ✅ COMPLETE
- [x] Expo SDK 56 dev-client app scaffolded (`app/`)
- [x] Native deps installed + **validated via iOS prebuild + `pod install`**
      (vision-camera v5/Nitro, nitro-modules, nitro-image, skia, expo-video,
      secure-store, haptics, supabase-js + polyfills)
- [x] `app.json` configured (bundle id, permissions in infoPlist, valid plugin set)
- [x] Domain layer authored + passes `tsc` (§6)
- [x] App shell (providers, Home, capture placeholder) + UI kit (Screen, Button)
- [x] Worker FastAPI skeleton + config + Dockerfile + pyproject; supabase/ stub; root README/.gitignore
- [x] iOS **builds GREEN** for simulator + physical device (arm64, code-signed) after the
      Xcode-26/Swift-6.2 patch + bundle-id change (see §7). `npx expo run:ios --device` now
      compiles, signs, installs and launches — the USER runs that final interactive step.

### Phase 1 — Onboarding + Capture  (code-complete; device checkpoint pending)
Onboarding
- [x] `(onboarding)` route group with a handedness picker (RH/LH)
      (group entry is `welcome.tsx`, **not** `index.tsx` — a group `index` collides with root `/`)
- [x] Consent screen that **blocks analysis until accepted** (required + optional training consent)
- [x] Face-on / DTL view selector (persists as `preferredView`)
- [x] Profile context/service persisting `UserProfile` via `expo-secure-store`
      (`services/profile-store.ts` `ProfileStore` iface + `contexts/profile.tsx`; swappable to Supabase in Phase 2 without UI change)
- [x] `index.tsx` routes to onboarding when the profile is incomplete, else Home
Capture (replaced `app/src/app/capture.tsx`)
- [x] vision-camera full-screen capture at **1080p/60fps** (v5: `constraints={[{fps:60}]}` + `useVideoOutput({targetResolution: FHD_16_9})`)
- [x] Camera/mic permission request + denied-state UI (camera required → Settings; mic optional → records without audio)
- [x] `FramingOverlay`: alignment box + distance guide + lighting/background hint (spec Stage 4 / 2.1)
      (hint is honest **setup guidance**; the live luminance/scene warning needs frame processors → deferred; the measured input-quality gate is the worker's job, Phase 3)
- [x] Record button + countdown + short max duration → local clip file URI (held in screen state for upload)
- [x] Respect handedness + selected view from the profile (per-recording view switch also persists the default)
Checkpoint
- [x] (USER) On-device run confirmed — recorded a real clip on the phone end to end.

### Phase 2 — Supabase backend + R2 storage  ✅ COMPLETE (provisioned + deployed; checkpoint green)
Provisioned to project **`swingsight-proto`** (Supabase EU-West Ireland; R2 EU
jurisdiction). Migrations pushed, RLS + Realtime + webhook live, both Edge Functions
deployed, anonymous auth on. **Checkpoint passed end-to-end** (`scripts/checkpoint.sh`):
real 101 MB clip → presigned R2 PUT 200 → rows under RLS → `queued` → DB trigger →
`on-swing-insert` (webhook-secret authenticated) returned 200. `pg_net._http_response`
confirms the dispatch. Only the Function→worker hop is unexercised (worker = Phase 3;
`WORKER_URL` deliberately unset). Deploy steps captured in `supabase/PROVISIONING.md`
(+ `scripts/setup.sh` / `apply.sh` / `checkpoint.sh`). Gotcha found: R2 EU-jurisdiction
buckets must use the `…​.eu.r2.cloudflarestorage.com` endpoint (non-EU endpoint → NoSuchBucket).
- [x] Migrations: `profiles`, `swing_analyses` (status enum incl. `unreadable`),
      `swing_metrics`, `swing_keyframes`, `swing_keypoints`, `fault_library`,
      `drills`, `drill_recheck`, `validation_set` — mirror the domain contract (§6);
      8 enums, 9 tables, indexes, `updated_at` triggers
      ((USER) `supabase link` + `db push` to the new project)
- [x] RLS keyed to `auth.uid()` (14 policies + a guard trigger freezing worker-owned
      columns from client writes); Realtime on `swing_analyses` (+ replica identity
      full); anonymous auth on first launch (app `AuthProvider` + secure-store session)
- [x] Edge Function `upload-url`: mint a 15-min R2 presigned PUT URL (S3 SigV4,
      private bucket, scoped server-side to `auth.uid()`). NOTE: single-shot PUT
      (what the checkpoint + small clips need); resumable multipart/TUS for large
      clips is the app-side Phase-4 upload, layered on the same S3 endpoint.
- [x] Edge Function `on-swing-insert`: DB webhook (pg_net + Vault-config trigger on
      queued swing) → POST the Cloud Run worker `/analyze`, authenticated (invoker
      token; worker `/analyze` now checks it). Worker returns 501 until Phase 3 —
      proves the wiring.
- [x] R2 lifecycle rules authored (`supabase/r2/lifecycle.json`: raw 2d, frames 7d,
      playback 30d; keypoints/metrics retained in Postgres ~12m)
      ((USER) apply with `aws s3api put-bucket-lifecycle-configuration`)
- [x] Swapped the Phase-1 profile store to Supabase behind the same `ProfileStore`
      interface (`createSupabaseProfileStore`); profile id = `auth.uid()` via an
      injected `mintId` — UI unchanged; falls back to secure-store pre-provisioning
- [x] Checkpoint PASSED: `scripts/checkpoint.sh` — real 101 MB clip presigned-uploaded
      to R2 (200), rows inserted under RLS, status→`queued`, DB webhook fired →
      `on-swing-insert` ran + authenticated (pg_net response 200). Function→worker hop
      pending Phase 3 worker deploy (`WORKER_URL` unset by design).
- [x] R2 lifecycle rules applied to the bucket (`scripts/apply-r2-lifecycle.mjs`,
      dependency-free SigV4 PutBucketLifecycleConfiguration → 200): raw 2d, frames 7d,
      playback 30d, abort-incomplete-multipart 1d.

### Phase 3 — Cloud Run CV worker (built fresh, NOT from the sibling swingbench) 🟢 CODE-COMPLETE
Built in `worker/src/swingsight_worker/` — a `domain/` Python **mirror** of the TS
contract (keypoints/events/fault_library/**gating** — same evaluate_gate/severity_band/
pick_primary_fault formulas), a `pipeline/` of stages, IO modules (`storage.py` R2,
`writeback.py` Supabase service-role), `process.py` orchestrator, `main.py` `/analyze`,
and `run_local.py` (the determinism harness). Determinism is structural: a `determinism.py`
pins single-thread BLAS/TFLite + GPU-off, and every emitted float is quantised.
- [x] Ingest/normalize (`pipeline/ingest.py` + `transcode.py`): PyAV reads **real PTS**
      (true tempo on VFR), decimates >66fps to a 60fps grid by nearest real timestamp
      (120→2nd, 90→nearest), processes sub-60fps natively flagged lower-confidence, never
      rejects. Transcode+normalize is one ffmpeg pass (auto-rotate upright + 720p + H.264,
      `-vsync passthrough` to keep real timestamps) so pose frames & playback can't drift.
- [x] Playback transcode → 720p H.264 clip (the same normalized clip; uploaded to R2)
- [x] Pose: MediaPipe BlazePose via the **Tasks API** `PoseLandmarker` (IMAGE mode,
      per-frame independent → deterministic; 2D + 2.5D world + visibility). `.task` model
      bundled in the image.
- [x] Blur refinement (`refine.py`): deterministic L/R inversion de-swap → single-frame
      spike rejection → short Savitzky-Golay (preserves the downswing); wrist-distance
      sanity as a confidence input. Visibility never smoothed.
- [x] Event detection (`detect_events.py`): kinematic heuristics off the refined mid-wrist
      (top=apex, impact=peak speed after top, address/finish=stillness, mids interpolated),
      time-domain via real timestamps; per-event + overall confidence; 8 keyframe indices.
- [x] Metric computation (`metrics.py`): pixel-space geometry, body-scale cm via shoulder
      width; view-aware reliability-tagged set per `METRIC_META`; each metric carries
      confidence (joint vis × event × fps-norm) + status (ok/low_confidence/implausible).
- [x] Fault gating (`faults.py`): reuses the domain gating mirror; confidence-gated on the
      **highlight joints'** visibility across the phase window; primary via pick_primary_fault.
- [x] Deterministic score (`score.py`): 0–100 from **reliable-tier** metrics only (approx
      2D proxies are soft indicators, never move the number), confidence-gated → withheld
      when too few confident metrics; signed per-metric contributions for "tap to see why".
- [x] Input-quality gate (`quality.py`): no_person / too_dark / partial_body /
      multiple_people (best-effort) / no_swing_detected / too_blurry → `unreadable` + friendly
      guidance. Never fabricates.
- [x] Output assembly (`assemble.py` + `writeback.py` + `storage.py`): per-frame keypoints
      (jsonb, one row/frame), 8 annotated keyframe JPEGs → R2, metrics rows, fault gates
      (jsonb), events+timestamps, playback **object key** in `playback_video_url`, score.
      `process.py` advances status processing→complete|unreadable|failed via service role.
- [x] **Determinism checkpoint GREEN** (native runtime, `run_local.py` ×2 on IMG_5736.mov →
      identical sha256). `scripts/determinism_check.sh` runs the same proof inside the
      linux/amd64 Docker image (Cloud Run parity).
- [x] **Deployed to Cloud Run + loop closed.** Project `swingsight-proto` (`europe-west1`),
      `scripts/deploy-worker.sh` (Cloud Build `--source` → Run; auto-links billing, fetches the
      service-role key, sets `WORKER_URL`). `scripts/checkpoint.sh` drove a real analysis end to
      end → `complete` in 96s, results in Supabase + R2. Determinism re-confirmed on the deployed
      runtime (primary fault, quality, structure match the local run).

### Phase 4 — Upload + orchestration wiring  🟢 CODE-COMPLETE (device checkpoint pending)
- [x] App `AnalysisService` (`services/analysis.ts`, Supabase impl): mint id client-side →
      insert row (`uploading`) → `upload-url` presigned PUT → **background binary upload** to
      R2 (`expo-file-system/legacy` `createUploadTask`, single-shot; TUS/multipart later) →
      flip `queued` (+`raw_object_key`, fires the worker webhook) → subscribe to the row via
      Realtime. Plus the report-side reads (metrics/events/paged keypoints) + `playback-url`.
- [x] Processing screen (`app/processing.tsx` + `hooks/use-analysis-runner.ts`) renders the
      state machine (uploading %→queued→processing w/ rotating stage labels→terminal);
      `unreadable` → "we couldn't read that swing" + `quality.guidance`; `failed` → retry.
      Realtime primary + a 4s backstop poll. Wired into `capture.tsx` ("Analyze swing").
- [x] (USER) device checkpoint confirmed — record on phone → upload → worker runs → status streams back live

### Phase 5 — AI coaching + report overlay (centerpiece) 🟢 CODE-COMPLETE (live test pending)
- [x] Worker coaching call (`worker/coaching.py`): Claude Haiku 4.5 via the Anthropic Python
      SDK (key server-side only). Prompt = metrics JSON (authoritative, "do not re-measure") +
      the open fault gates (model may only choose among them) + explicit handedness/mirror +
      the 6–8 **annotated** keyframe JPEGs as base64 image blocks (reused in-memory from the
      keyframe render — no R2 round-trip). Constrained output via `messages.parse()` Pydantic
      schema (the schema has NO field for a score/joint/frame, so it can't emit one);
      **prompt-cache** the frozen system prompt (fault library rubric + drills + rules);
      deterministic **template fallback** on any failure (API error / out-of-schema / fault
      outside the open gates / low confidence / no key) built from the gated primary fault's
      headlineTemplate/whyTemplate. Runs AFTER `write_complete`, writes only `coaching` jsonb.
- [x] `playback-url` Edge Function (`supabase/functions/playback-url`): presigned R2 GET for
      the private playback object key, resolved server-side from the RLS-scoped row.
- [x] Report screen (`app/src/app/report/[id].tsx`):
  - [x] `SwingStage` (expo-video) → `currentTime` into a Reanimated SharedValue via a
        `requestAnimationFrame` loop (also publishes the per-frame projected skeleton)
  - [x] Skia overlay from real per-frame keypoints, interpolated (`interpolateFrame`),
        low-confidence joints dimmed, `computeContainFit` — stage sized to the clip aspect so
        contentFit="contain" has zero letterbox (no drift)
  - [x] `FaultHighlight` from `resolveFaultHighlight` (handedness + events); confidence-gated
        on the worker's fault confidence AND per-frame joint visibility → crisp line / crisp
        ring (single joint) / soft region / words-only
  - [x] Headline + root-cause "why" (+ optional ball-flight) front-and-centre, drill card,
        metrics as friendly ranges (approximate ones qualitative, never raw degrees),
        deterministic **score** (tappable → contributions; `withheld` handled), `PhaseScrubber`
- [x] Live coaching test PASSED on real infra (worker redeployed with the key →
      `scripts/checkpoint.sh` → `complete` → `coaching` jsonb `source:"llm"`, `chosenFaultId`
      ∈ open gates, valid drill, score withheld). `playback-url` deployed.
- [x] (USER) first on-device end-to-end run confirmed (synced skeleton, correct-handedness limb
      across the right window, grounded coaching beside it, score shown/withheld; a bad clip →
      `unreadable` re-record guidance)

### Phase 6 — Drill-recheck + history/trends 🟢 CODE-COMPLETE (worker redeploy + live test pending)
Adds the **time dimension** (compare-to-last-time + history) on top of the live measurement/
coaching/report loop, deterministically. The recheck delta/verdict is computed by the worker
from CV — never the LLM; the app only ever supplies the link, and only words the comparison.
- [x] **(A) App stores the recheck link** (`services/analysis.ts`): `insertAnalysis` sets
      `previous_analysis_id` = `findPreviousAnalysisId` (the most recent COMPLETE **same-view**
      analysis for this profile). Best-effort (never fatal → no comparison, not an error). The
      insert RLS allows it; the column guard only freezes worker-owned columns on UPDATE.
- [x] **(B) Worker recheck step** (`worker/recheck.py` + `writeback.write_drill_recheck`):
      `main.py` forwards `previous_analysis_id` → `process_analysis`; a SEPARATE deterministic
      step AFTER `write_complete` (a couple of DB reads + arithmetic, no LLM). Tracked fault =
      prior `coaching.chosenFaultId ?? primary_fault_id`; tracked metric + direction = that
      fault's prescribed drill (`drill.target_metric_key` == the fault's `gate.metric_key`;
      `improvement_direction`). `delta = current − previous` over the two `ok` measured values;
      `improved` is direction-aware. Guards: prior must exist, be `complete`, same profile +
      view, both endpoints `ok` — else nothing is written (no fabrication). Isolated from the
      determinism payload + `run_local.py` exactly like coaching.
- [x] **(C) Report leads with the comparison** (`report/[id].tsx`): `fetchDrillRecheck` +
      `use-report` bounded retry (the row lands a beat after `complete`; `drill_recheck` is not
      Realtime-replicated) → `RecheckBanner` ABOVE the headline. Direction-aware honest copy
      (`utils/recheck-copy.ts`): celebrates improvement, states "holding steady"/"keep at it"
      plainly, shows raw before→after only for reliable metrics (approximate stay qualitative).
- [x] **(D) Home/History + tempo trend**: `fetchSwingHistory` (terminal swings + a batched
      tempo query) + `use-history`; a new `/history` route (full list) + a Home progress preview
      (latest 3 + "See all"). `TempoTrend` (Skia sparkline of `tempo_ratio` over time with the
      target band), `SwingHistoryCard` (view/fault/score), `HistoryThumb` (Skia mini-skeleton
      from the `top` keyframe's measured pose — real data, no R2 round-trip, graceful tile
      fallback). Home made dark (`Brand.surfaceDark`) so the dark-surface history UI is consistent.
- [x] Verified: worker `py_compile` GREEN; `scripts/determinism_check.sh` GREEN (byte-identical
      WITH recheck in the tree); app `tsc` GREEN.
- [x] **LIVE-PROVEN.** Worker redeployed (`scripts/deploy-worker.sh` → revision
      `swingsight-worker-00003`, webhook re-wired); `scripts/recheck_checkpoint.sh` ran two
      same-view swings end to end → both `complete`, the 2nd produced a `drill_recheck` row
      (`tilt_away_drill` / `reverse_spine_deg`, `prev 20.0132 → cur 20.0122`, `delta −0.001`,
      `improved true`). Same clip twice ⇒ ~0 delta as expected; the report leads with it as
      "Holding steady / about the same" (`reverse_spine_deg` is approximate → no raw degrees).
      A first-ever / cross-view swing writes no row → the report shows the normal view, no
      fabricated comparison.
- [ ] **(USER, optional)** record a genuinely DIFFERENT (better) second swing on-device to see a
      real, direction-aware "you're improving" comparison — the identical-clip script can only
      show ~0 movement. (Still gated by the one outstanding Phase-5 device run.)

### Phase 7 — Validation, privacy, TestFlight 🟢 CODE-COMPLETE (coach labels + interactive deploys are USER hand-offs)
Makes "accurate" measurable, makes the data handling defensible, and prepares TestFlight.
**A (validation) + B (delete/export + no-PII audit) + C (EAS config) are built + GREEN.** The
remaining work is inherently human/interactive: real coach labels, the Apple-auth build/submit,
and the (user-gated) function deploy + worker redeploy.

**(A) Validation layer + the gate** (spec §13.1; `worker/validation/`):
- [x] **The gate is structural.** Each fault carries a `validation` block (`claimEligibility`
      `drives_claim`|`soft_only` + a per-fault bar + an honest `basis`) in BOTH
      `app/src/domain/faultLibrary.ts` and the Python mirror. `FaultEvaluation` gained a
      `claimEligible` bool; `gating.pick_primary_fault` (TS+Py) and `coaching._open_gate_ids`
      now **exclude `soft_only` faults from the primary claim + the LLM's open gates**. The two
      approximate-proxy faults (`reverse_spine_angle`, `over_the_top`) are `soft_only`; the three
      reliable-metric faults (`chicken_wing`, `excessive_head_movement`, `early_extension`) stay
      `drives_claim`. **Proven on the real sample:** `reverse_spine_angle` still *fires* (conf
      0.807, ok) but is now suppressed → `primaryFaultId = None` ("no clear priority fault"),
      the honest output instead of highlighting a crude proxy. (Determinism stays byte-identical
      — `claimEligible` is a deterministic constant; the parity check is GREEN with it in the payload.)
- [x] **Golden-set + regression runner** (`swingsight_worker.validation.{manifest,regression,
      run_regression}` + `worker/validation/golden_set.json` + `README.md`): runs the
      DETERMINISTIC measurement core over the golden clips, compares predicted primary fault +
      metrics to coach labels, reports a **per-fault agreement rate** (recall vs the bar) +
      **per-metric error** + the gate verdict, and exits non-zero only when a *claim-eligible*
      fault drops below its bar. `scripts/validation_check.sh` (self-test + regression). The pure
      agreement/error/bar maths has a `--self-test` (GREEN) so the logic is checkable without pose.
- [x] **No fabricated labels — structurally.** `manifest.load_golden_set` rejects a label
      without a labeller and rejects a `pending_coach_review` swing that carries a verdict. The
      set is seeded with the one real sample clip as **PENDING** (0 coach labels yet → agreement
      "not yet measurable", reported transparently; the runner prints the pipeline's prediction
      for that clip as REVIEW-only context, never as a label).
- [x] `supabase/scripts/sync-validation-set.mjs` mirrors the manifest into the existing
      `validation_set` table (the optional registry; the manifest stays the runnable source).
- [ ] **(USER)** a qualified coach labels the sample clip (+ adds more) so the agreement rate
      becomes real and the bars bite — the one genuinely human input (`worker/validation/README.md`
      has the workflow). Never fabricated.

**(B) Privacy / data rights** (spec §21; `PRIVACY.md`):
- [x] **Delete my data** (`supabase/functions/delete-account`): enumerates the caller's OWN R2
      keys under RLS (raw + playback + keyframe JPEGs), purges them from R2, then service-role
      deletes the auth user → DB **cascade** removes every row. **Export my data**
      (`supabase/functions/export-data`): the user's profile + swings + metrics + analysis as a
      JSON bundle with short-lived presigned playback links. Both `verify_jwt = true`, RLS-scoped.
- [x] A **Privacy & data** app screen (`app/src/app/privacy.tsx` + `services/privacy.ts`, linked
      from Home): export (writes the bundle + opens the share sheet) and a destructive
      delete-with-confirmation that signs out + resets to onboarding. App `tsc` GREEN.
- [x] **No identifiable data reaches the LLM — audited + documented.** `coaching.py`'s prompt
      carries only view/handedness/metrics/frames (no `profile_id`/`email`/`analysis_id`; grep-clean).
      `trainingConsentAcceptedAt` is the gate for any future flywheel use (none exists today — the
      golden set is coach-sourced); the one rule for when a flywheel is added is documented.
      Anthropic zero-retention noted as an account-level launch follow-up. **Retention windows
      reconciliation is DEFERRED for the prototype (USER's call).**
- [x] **DEPLOYED.** `supabase functions deploy delete-account export-data` → both **ACTIVE** on
      project `grhwgmloocegvgiccltp` (delete-account v1, export-data v1; reuse the existing R2
      secrets + the auto-injected service-role key, so no new secrets).

**(C) EAS → TestFlight** (`app/eas.json` + `app/EAS_DEPLOY.md`):
- [x] `eas.json` authored (development / development-simulator / preview / production +
      `submit.production.ios`), `app.json` wired (owner `swingsight`, the existing EAS project
      `d19293ab-…`, `ITSAppUsesNonExemptEncryption=false`). The non-interactive build attempt
      validated everything through versioning + credential resolution and stopped exactly at the
      Apple-auth wall ("run in interactive mode") — the handoff point.
- [x] **KEY RISK cleared:** EAS installs with `npm ci` (lockfile present) which runs the
      `postinstall: patch-package` hook (patch-package is a devDep EAS installs), so the
      Xcode-26 patches apply in the cloud. The runbook says to confirm "applying 2 patches" in
      the build logs. Progress UX ("Finding your swing… / Measuring… / Writing feedback…") +
      upload % already exist (`processing.tsx`). No git repo → use `EAS_NO_VCS=1` (or `git init`).
- [ ] **(USER)** the interactive `eas build -p ios --profile production` (Apple login) →
      `eas submit` → TestFlight external tester (App Store Connect beta review). Runbook:
      `app/EAS_DEPLOY.md`. (`ascAppId` placeholder filled after the app exists in App Store Connect.)

**Checkpoint status:** the regression runner reports the honest per-fault state over the golden
set (harness GREEN; 0 coach labels so agreement not yet measurable — awaiting the human input);
the determinism + py_compile + tsc checks are all GREEN; the delete-my-data action (removes DB
rows + R2 objects) is built; the EAS build is configured + attempted to the Apple-auth handoff.

**The gate is now LIVE-PROVEN.** The worker was redeployed (`scripts/deploy-worker.sh` → revision
`swingsight-worker-00004-wl9`, webhook re-wired) and both Edge Functions deployed. A fresh
analysis of the sample driven through the **live** worker came back `status=complete`,
**`primaryFaultId=null`**, coaching `template` "Looking solid" — and the stored `faults` show
`reverse_spine_angle` **fired (conf 0.83, status ok) but `claimEligible=false`**, i.e. it would
have been primary pre-gate and is now correctly suppressed. So the production worker no longer
leads with a crude 2D proxy; it honestly reports "no clear priority fault". (Consequence per §7b:
`recheck_checkpoint.sh` on the identical sample now writes no `drill_recheck` row — expected.)
Remaining: real coach labels (USER), and the interactive `eas build`/`eas submit` (Apple auth).

## 10. Reference docs (deep detail lives here)

- **Build plan + rationale:** `~/.claude/plans/rosy-popping-hopcroft.md` (per-phase steps,
  risks, verification). This PRD is the live tracker; the plan is the design rationale.
- **Product spec:** `~/Downloads/swing-analysis-pipeline-spec.md` (full behaviour:
  Stage 0 onboarding, Stage 1 capture, Stage 5 CV pipeline, §14 fault library, §15 metrics).
- A prior, research-only Python project exists at `~/Code/Swing_Prototype` (`swingbench`).
  **Do not depend on it** — it is test/research-grade. Build the worker fresh from the
  spec. It is useful only as inspiration and for a real sample swing video.

## 11. Open items to settle during build (defaults chosen; adjustable)
- Drill library size/authoring (start ~2–3 vetted drills per launch fault — already seeded in `faultLibrary.ts`).
- When to add Pub/Sub or Cloud Tasks in front of the worker (at first burst load).
- **GCP project + region + naming for Cloud Run** (the worker's deploy target) — the
  user's call; defaults proposed in `worker/DEPLOY.md` (region `europe-west1` EU, service
  `swingsight-worker`). Pending the deploy.
- ~~**`playback-url` Edge Function** (Phase 4/5)~~ ✅ BUILT (`supabase/functions/playback-url`,
  1h presigned GET, RLS-scoped object-key lookup). USER deploys: `supabase functions deploy
  playback-url`.
- **Coaching prompt tuning (observed live):** the first live LLM run on the sample chose the
  right fault + drill but worded the `headline` awkwardly ("Tilt toward the target at the top
  instead of away from it" — ambiguous vs. the template's clear "Your spine is tilting toward
  the target at the top"). The `why` was correct. The headline rules in `worker/coaching.py`
  `_build_system_prompt` could ask for an action-first, unambiguous headline (and/or few-shot
  examples). Not a blocker — the deterministic template is the floor for exactly this.
- ~~**Approximate-metric refinement** (turn/X-factor/2D plane/over-the-top): tighten +
  regression-test before they drive any visible claim~~ ✅ GATED (Phase 7A). The approximate-
  proxy faults (`reverse_spine_angle`, `over_the_top`) are now `soft_only` — excluded from the
  primary claim + the LLM open gates until they clear their bar in the regression runner.
  Reliable-metric faults carry the product. To PROMOTE one: tighten the proxy, add coach-labelled
  swings, confirm it clears its bar, flip `claimEligibility` to `drives_claim` in both libraries
  (workflow in `worker/validation/README.md`).
- **Golden-set coach labels (USER):** the validation harness is built but the set has 0 real
  coach labels yet (seeded PENDING). A qualified coach labels the sample clip (+ more) to make
  the agreement rate real. Never fabricated.
- **Final data-retention windows (DEFERRED for the prototype, USER's call):** R2 lifecycle is
  applied (raw 2d/frames 7d/playback 30d); spec §21 windows + legal sign-off are deferred. The
  user-initiated delete/export rights (`PRIVACY.md`) work regardless.
