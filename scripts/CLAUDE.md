# scripts/ — verify, deploy, and live-checkpoint scripts

The entry points for verification and provisioning. Most read secrets from `setup.env`
(gitignored; copy from `setup.env.example`) and are safe to re-run (idempotent). Anything
that calls a cloud provider needs the user's auth — see the "who runs it" column.

| Script | What it does | Who runs it |
|---|---|---|
| `determinism_check.sh [VIDEO] [VIEW] [HAND]` | **The headline verification.** Builds the worker container (Cloud Run parity) and runs the measurement core twice → asserts byte-identical sha256. Run after ANY measurement change. | agent (needs Docker) |
| `validation_check.sh [--self-test-only]` | Phase 7 regression: agreement/error/bar self-test (no pose), then the per-fault regression over the local golden set. Exits non-zero only on a real regression. | agent (`.venv-check`) |
| `setup.sh` | Interactive Phase-2 provisioning helper: prompts for blank `setup.env` values, generates the two shared secrets, offers to run the Supabase steps. | user (interactive) |
| `apply.sh` | Non-interactive backend apply from `setup.env` (link, `db push`, edge-function secrets, deploy). Safe to re-run. | agent / user |
| `checkpoint.sh` | Phase-2 checkpoint: real clip upload + webhook fire (wraps `supabase/scripts/checkpoint-upload.mjs`). | agent / user |
| `apply-r2-lifecycle.mjs` | Apply `supabase/r2/lifecycle.json` to the bucket (dependency-free SigV4). | agent / user |
| `deploy-worker.sh` | Full Phase-3 Cloud Run deploy + webhook wiring (create project, enable APIs, deploy `--source worker`, set `WORKER_URL`). Idempotent. | **user** — needs `gcloud auth login` |
| `recheck_checkpoint.sh [VIEW] [HAND]` | Phase-6 live check: drives two same-view swings, asserts a `drill_recheck` row on the 2nd. **Note:** with the Phase-7 gate the default sample yields "no row" (expected — see PRD §7b). | user (after a worker redeploy) |

## Conventions

- **Secrets come from `setup.env`** (or the Supabase/gcloud CLIs) — never hardcoded,
  never printed. `setup.env` and `supabase/vault-secrets.sql` are gitignored.
- Scripts `cd` to repo root via `$(dirname "${BASH_SOURCE[0]}")/..` and use
  `set -euo pipefail`. Match that style for new scripts.
- The `.mjs` checkpoints live in `supabase/scripts/` and are invoked by the `.sh`
  wrappers here (which inject env from `setup.env`).
- The two verification scripts (`determinism_check.sh`, `validation_check.sh`) are the
  ones to run for code review — they keep the measurement layer honest and compose
  (validation reads the deterministic measurement, never perturbs it).
