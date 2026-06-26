# The validation layer (golden set + per-fault regression)

> Spec §13.1 · PRD Phase 7 (A). This is what makes **"accurate"** measurable, and it is
> the gate every visible claim must pass. Governing law: **CV measures, the AI explains,
> the fault library localises** — and *every fault rule that drives a visible highlight
> must clear a regression bar against coach-labelled ground truth before it ships.*

## What this is

- **`golden_set.json`** — a fixed set of swings, each with a **known fault labelled by a
  qualified coach**. The clip bytes are *not* committed (large, and may be personal data);
  each entry references a clip by name that the runner resolves locally.
- **The regression runner** (`swingsight_worker.validation.run_regression`) runs the
  **deterministic measurement core** over the set, compares the pipeline's primary fault +
  metrics to the coach labels, and reports a **per-fault agreement rate** + **per-metric
  error**. It exits non-zero only when a *claim-eligible* fault drops below its bar.

It only ever **reads** the deterministic output, so it composes with
`scripts/determinism_check.sh` (the measurement payload stays byte-identical).

## No fabricated labels — ever

A coach label is a human input. The loader (`manifest.py`) enforces an honesty guard:

- A swing **awaiting** judgment is `labelSource: "pending_coach_review"` and must carry
  **no** verdict. It is run for review but never counted toward the agreement rate.
- A **labelled** swing (`coach` or `self_provisional`) must name **who** labelled it
  (`labeledBy`) and carry **exactly one** verdict (`expectedPrimaryFaultId` *or*
  `expectedNoFault`). *A label without a labeller is rejected at load.*
- `self_provisional` is the honest tier for a non-coach eyeball baseline: it counts, but
  is clearly marked and never presented as coach ground truth.

The pipeline's own prediction is the thing being validated — it is **never** used as a
label (that would be circular). The runner prints it for `pending` swings only as review
context, labelled "NOT a label".

## The gate (per-fault bar)

Each fault in the library carries a `validation` block (`app/src/domain/faultLibrary.ts`,
mirrored in `worker/.../domain/fault_library.py`):

| Fault | Driving metric | Tier | Claim eligibility | Bar |
|---|---|---|---|---|
| `chicken_wing` | `lead_elbow_flexion_impact_deg` | reliable | **drives_claim** | ≥70% over ≥5 labels |
| `excessive_head_movement` | `head_sway_cm` | reliable | **drives_claim** | ≥70% over ≥5 labels |
| `early_extension` | `early_extension_cm` | reliable | **drives_claim** | ≥70% over ≥5 labels |
| `reverse_spine_angle` | `reverse_spine_deg` | approximate | **soft_only** | ≥70% over ≥5 labels |
| `over_the_top` | `over_the_top_deg` | approximate | **soft_only** | ≥70% over ≥5 labels |

- **`drives_claim`** — the fault may be the report's primary claim, drive the crisp
  highlight, and be an LLM-selectable open gate. The three reliable-metric faults carry
  the product today on that reliable basis; the runner now *measures* their coach
  agreement and will **fail** (exit non-zero) if one drops below its bar.
- **`soft_only`** — the two approximate 2D proxies read crudely (spec §15.2; PRD §7), so
  they are **excluded from the primary claim and the LLM open gates** until they clear the
  bar on coach-labelled swings. They are still measured and recorded (`claimEligible:false`
  on the evaluation) and may be surfaced softly. Underperformance by a `soft_only` fault is
  reported but does **not** fail the gate (it can't drive a claim anyway).

This gate is enforced structurally in `gating.pick_primary_fault` (+ `coaching._open_gate_ids`),
not left to UI discretion.

### Promoting a `soft_only` fault to `drives_claim`

1. Tighten the proxy in `worker/.../pipeline/metrics.py` (or the gate threshold).
2. Add ≥ `minLabelledSwings` coach-labelled swings for it to `golden_set.json`.
3. Run the regression; confirm it clears its bar **and** nothing else regressed.
4. Flip `claimEligibility` to `drives_claim` in **both** the TS and Python fault library.
5. Re-run the regression + `determinism_check.sh`; commit together.

## Adding a coach label (the handoff workflow)

1. Drop the clip somewhere local (e.g. the dir of `$SAMPLE_CLIP`, or pass `--clips-dir`).
2. Add an entry to `golden_set.json`, or flip a `pending` one to labelled:
   ```json
   {
     "id": "jdoe_faceon_rh_2026_06",
     "clip": "jdoe_faceon.mov",
     "view": "face_on",
     "handedness": "RH",
     "labelSource": "coach",
     "labeledBy": "Coach name / PGA id",
     "labeledAt": "2026-06-27",
     "expectedPrimaryFaultId": "chicken_wing",   // or "expectedNoFault": true
     "metricGroundTruth": { "tempo_ratio": 3.1 } // optional, drives per-metric error
   }
   ```
3. Run `scripts/validation_check.sh`. The agreement rate now includes that swing.

## Run it

```bash
scripts/validation_check.sh                 # self-test + regression over local golden clips
scripts/validation_check.sh --self-test-only  # logic only (no pose / no clips)

# or directly (from worker/, with the check venv that has mediapipe):
PYTHONPATH=src POSE_MODEL_DIR=worker/models \
  .venv-check/bin/python -m swingsight_worker.validation.run_regression --json
```

## Current state (honest)

The set holds the **one real sample clip**, entered as `pending_coach_review` — there are
**0 coach labels yet**, so the agreement rate is *not yet measurable* (reported as such,
not faked). The harness runs end-to-end: on that far/low-confidence sample the pipeline now
predicts **no clear priority fault** (its only firing gate, `reverse_spine_angle`, is
`soft_only`), which is the correct, honest output. **Next:** a qualified coach labels this
clip and adds more, at which point the per-fault agreement becomes real and the bars bite.
