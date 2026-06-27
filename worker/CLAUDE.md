# worker/ — Cloud Run CV pipeline + coaching call

The deterministic **measurement layer**: ingest → pose → blur-refine → events → metrics
→ fault gates → score → quality gate → output assembly. Then two structurally-isolated
non-deterministic steps run after the measurement is written: the Claude coaching call
and the drill recheck. Read the root [`../CLAUDE.md`](../CLAUDE.md) and
[`../PRD.md`](../PRD.md) (§7 worker gotchas) first. Deploy steps: [`DEPLOY.md`](./DEPLOY.md).

## ⚠️ Determinism is the headline requirement

Re-running the measurement on the same clip must produce a **byte-identical** payload.
This is enforced *structurally* — don't undo it:

- **`determinism.py` is imported FIRST** (before numpy/OpenCV/MediaPipe) in `main.py` and
  `run_local.py`. It pins every numeric backend to one thread (`OMP/OPENBLAS/MKL/
  TF_*_THREADS=1`), disables the GPU, and sets `PYTHONHASHSEED=0`. If you add a new
  entrypoint that touches CV, import `determinism` before anything else.
- **Pose runs in MediaPipe IMAGE mode** (per-frame independent, no tracking state).
- **Every emitted float is quantised** via `q()`. New numeric outputs must go through it.
- **Verify after any measurement change:** `scripts/determinism_check.sh` (builds the
  linux/amd64 image, runs the measurement twice, asserts identical sha256). It must stay
  GREEN. Note determinism is per-runtime: two separate Cloud Run hosts can differ at the
  ~1e-3 level (TFLite/XNNPACK), which is why the app presents recheck deltas through a
  meaningful-change floor, never the raw boolean.

### The non-deterministic steps are quarantined — keep them there

`coaching.py` (the LLM) and `recheck.py` both run in `process.py` **after**
`write_complete`, write their own column/table, and are **NOT imported** by
`run_local.py` / `serialize.py` / `assemble.py`. That's why the determinism payload is
byte-identical regardless of the LLM. **Do not pull coaching or recheck into the
measurement core.** The LLM never emits a score/joint/frame (its Pydantic schema has no
such field); the one runtime check is `chosen_fault_id ∈ open gates`, else template fallback.

## Layout

```
src/swingsight_worker/
  main.py          FastAPI: /healthz, /analyze (runs the pipeline synchronously)
  config.py        env-driven Settings (R2, Supabase, pose knobs, coaching provider/model)
  determinism.py   single-thread env (import FIRST) + float quantisation q()
  process.py       IO orchestration: download → transcode → measure → upload → write
                   → coaching → recheck
  storage.py       Cloudflare R2 (S3 API via boto3) get/put
  writeback.py     Supabase service-role result writes (bypasses RLS + the column guard)
  serialize.py     canonical measurement JSON (the determinism contract)
  run_local.py     local measurement harness = the determinism checkpoint entrypoint
  coaching.py      Claude Haiku 4.5 call (isolated; template fallback on any failure)
  recheck.py       deterministic drill-recheck (compares prior same-view analysis)
  domain/          Python MIRROR of app/src/domain/*.ts — keep in lockstep (see below)
  pipeline/        the measurement stages. assemble.run_measurement runs them in order:
                   ingest → pose → refine → detect_events → quality → metrics → faults →
                   score. transcode (playback clip) + keyframes run in process.py around it.
  validation/      Phase 7 golden-set + per-fault regression runner (manifest, regression,
                   run_regression). Reuses assemble.run_measurement verbatim — never perturbs it.
```

## Domain mirror

`domain/*.py` is a hand-kept mirror of `app/src/domain/*.ts` — **the TS side is the source
of truth.** Same formulas, operator-for-operator. Don't change one side without the other.
See `app/src/domain/CLAUDE.md` for the full mirror rule (TS ↔ Py ↔ SQL).

## Python env (system Python is 3.14 — MediaPipe needs 3.12)

```bash
cd worker
uv venv --python 3.12 .venv-check
uv pip install --python .venv-check/bin/python mediapipe av scipy pydantic-settings
curl -fsSL -o models/pose_landmarker_full.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
```

The `.venv-check/` venv (has mediapipe) is what runs local measurement + the validation
regression. `models/` is gitignored (downloaded; the Dockerfile downloads it at build).

## Verify / run

```bash
# Syntax (fast)
python3 -m py_compile src/swingsight_worker/*.py src/swingsight_worker/domain/*.py \
  src/swingsight_worker/pipeline/*.py
# Local measurement (fast, native)
PYTHONPATH=src POSE_MODEL_DIR="$PWD/models" .venv-check/bin/python \
  -m swingsight_worker.run_local <video> --view face_on --handedness RH
# Determinism (Docker, Cloud Run parity)
../scripts/determinism_check.sh
# Validation regression (Phase 7)
../scripts/validation_check.sh            # self-test + per-fault regression
```

## Gotchas (full list in PRD §7 "Phase 3 worker gotchas")

- **MediaPipe = Tasks API, NOT `solutions`.** Use
  `mediapipe.tasks.python.vision.PoseLandmarker` (IMAGE mode). `mp.solutions.pose` is gone.
- **Don't pin `opencv-python-headless`** — mediapipe hard-depends on
  `opencv-contrib-python` (its cv2); two providers shadow each other. The Dockerfile
  installs the X libs the non-headless build needs.
- **iPhone clips are portrait + rotated.** One ffmpeg pass auto-rotates upright + strips
  the rotate tag + transcodes to 720p H.264, and pose runs on that SAME upright clip the
  app plays — so the skeleton can't be mirrored/rotated vs the video.
- **`playback_video_url` stores the R2 OBJECT KEY**, not a URL (private bucket). The app
  mints a short-lived presigned GET via the `playback-url` Edge Function on report load.
- **`/analyze` is synchronous** (Cloud Run guarantees CPU during a request). Deploy with
  `--concurrency=1 --cpu=2 --memory=4Gi --timeout=600`. It returns 200 once a terminal
  status is on the row (truth lives in the DB/Realtime), so the webhook never retry-storms.
- **Approximate 2D proxies are crude** — tagged `approximate`, shown as ranges/soft,
  excluded from the score, and gated to `soft_only` (can't drive the primary claim). Don't
  promote one to `drives_claim` without clearing its bar in the regression runner.
