# SwingSight CV worker

Containerised Python service (Google Cloud Run) that turns an uploaded swing clip
into a measured analysis. It is the deterministic **measurement layer** only:
ingest → pose → blur-refine → events → metrics → fault gates → score → quality gate
→ output assembly. Same input → same output.

> Governing law: **CV measures, the AI explains, the fault library localises.** The
> worker emits joints/frames/metrics/gates/score and writes them back. It does **not**
> write coaching language — the Claude Haiku 4.5 coaching call is **Phase 5**, not here.

## Layout

```
worker/src/swingsight_worker/
  main.py          # FastAPI: /healthz, /analyze (runs the pipeline synchronously)
  config.py        # env-driven settings (R2, Supabase, pose knobs)
  determinism.py   # single-thread env (imported FIRST) + float quantisation q()
  process.py       # IO orchestration: download → transcode → measure → upload → write
  storage.py       # Cloudflare R2 (S3 API) get/put
  writeback.py     # Supabase service-role result writes
  serialize.py     # canonical measurement JSON (the determinism contract)
  run_local.py     # local measurement harness (the determinism checkpoint entrypoint)
  domain/          # Python MIRROR of app/src/domain/*.ts (the shared contract)
    keypoints.py events.py fault_library.py gating.py
  pipeline/        # the measurement stages
    transcode.py ingest.py pose.py refine.py detect_events.py
    metrics.py faults.py score.py quality.py keyframes.py assemble.py
  models/          # bundled pose_landmarker_*.task (gitignored; downloaded)
```

## Determinism (the headline requirement)

Re-running on the same clip produces a **byte-identical** measurement layer. Enforced
structurally: `determinism.py` pins every numeric backend to one thread and disables
the GPU **before** numpy/OpenCV/MediaPipe import (so it is imported first), pose runs
in MediaPipe's per-frame IMAGE mode (no tracking state), and every emitted float is
quantised. Proof:

```bash
# Cloud Run parity (builds the linux/amd64 image, runs twice, asserts same sha256):
../scripts/determinism_check.sh

# Fast native loop (system Python is 3.14 — MediaPipe needs 3.12):
uv venv --python 3.12 .venv-check
uv pip install --python .venv-check/bin/python mediapipe av scipy pydantic-settings
curl -fsSL -o models/pose_landmarker_full.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
PYTHONPATH=src POSE_MODEL_DIR="$PWD/models" .venv-check/bin/python \
  -m swingsight_worker.run_local <video> --view face_on --handedness RH
```

## Run the HTTP service locally

```bash
cd worker
cp .env.example .env        # fill in R2 + Supabase (service-role) values
docker build -t swingsight-worker .
docker run --rm -p 8080:8080 --env-file .env swingsight-worker
curl localhost:8080/healthz   # -> {"status":"ok","version":"0.3.0"}
```

`/analyze` is invoked by the Supabase `on-swing-insert` Edge Function (authenticated
with the invoker token) when a `swing_analyses` row is queued with its raw clip.

## Deploy to Cloud Run

See **`DEPLOY.md`** for the full sequence (project/region, secrets, the `--source`
deploy, and the `supabase secrets set WORKER_URL=…` wiring that closes the loop).
