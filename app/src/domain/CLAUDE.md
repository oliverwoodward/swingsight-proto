# src/domain/ — the shared contract (mirrored 3 ways)

This is the **single contract** the app, the worker's JSON output, and the database all
conform to. It is **pure, framework-free TypeScript** — no React, no Expo imports. Import
it via `@/domain` (barrel in `index.ts`).

## ⚠️ The mirror rule (the #1 thing to get right here)

When you change a shape or a formula in this folder, you must update **all three** copies
and re-verify both runtimes:

1. **`app/src/domain/*.ts`** — the canonical source (this folder).
2. **`worker/src/swingsight_worker/domain/*.py`** — a hand-kept Python mirror. Same
   formulas, operator-for-operator. The files even cross-reference each other in their
   docstrings (e.g. `gating.py` says "mirror of gating.ts — do not improve one side
   without the other").
3. **`supabase/migrations/*.sql`** — the DB schema + the `fault_library` / `drills` seed
   (`*_seed_reference.sql`) are derived from `types.ts` + `faultLibrary.ts`.

Then verify both sides:
```bash
cd app && npx tsc --noEmit -p tsconfig.json                    # TS side
cd worker && python3 -m py_compile src/swingsight_worker/domain/*.py   # Py side
scripts/determinism_check.sh                                    # if you touched a formula
```

A silent divergence here is the worst class of bug in this repo: the app and worker would
disagree about what a number *means* (e.g. a wrong handedness map highlights the wrong
arm; a different gate threshold opens a fault on one side only).

## Files

- **`types.ts`** — `UserProfile`, `SwingAnalysis` (status state machine
  `uploading→queued→processing→complete|failed|unreadable`), `Metric`, `FaultEvaluation`,
  `FaultLibraryEntry`, `Drill`, `DrillRecheck`, `SwingScore`, `CoachingResult`,
  `QualityReport`, `AnalysisStatusUpdate`. The DB schema mirrors these.
- **`keypoints.ts`** — BlazePose-33 indices, `SKELETON_EDGES`, and the **single-source
  handedness lead/trail map** (`jointRefToIndex`). A wrong map highlights the wrong arm.
- **`events.ts`** — the 8 swing events (`SWING_EVENTS`) + `resolvePhaseWindow`.
- **`faultLibrary.ts`** — `FAULT_LIBRARY_VERSION`, `METRIC_META` (metric catalogue +
  reliability tiers + friendly ranges), `DRILLS`, the **5 launch faults**, and each
  fault's `validation` block (`claimEligibility: drives_claim | soft_only` + a per-fault
  bar). The 5 faults: `chicken_wing` (FO), `reverse_spine_angle` (FO),
  `excessive_head_movement` (FO), `over_the_top` (DTL), `early_extension` (DTL).
- **`gating.ts`** — `evaluateGate`, `severityBand`, `pickPrimaryFault` (excludes
  `soft_only` faults from the primary claim), `LOW_CONFIDENCE`. Deterministic.
- **`highlight.ts`** — `resolveFaultHighlight` (logical joints + handedness + events →
  drawable points + time/frame window).
- **`coordinates.ts`** — `computeContainFit` (must match expo-video `contentFit="contain"`),
  `projectPoint`, `interpolateFrame` (smooth 60fps overlay between sampled poses).

## Invariants baked into this layer

- **Deterministic.** Same inputs → same outputs. No `Date.now()`, no randomness, no I/O.
- **The validation gate** (`claimEligibility`): a fault may *fire* with high confidence
  yet be `soft_only` → recorded for transparency but never selectable as the primary
  claim or offered to the LLM. The two approximate 2D proxies (`reverse_spine_angle`,
  `over_the_top`) are `soft_only`; the three reliable-metric faults are `drives_claim`.
  To promote one, follow the workflow in `worker/validation/README.md` (tighten the
  proxy → coach-labelled swings clear the bar → flip the flag in BOTH libraries).
- **Reliability tiers gate the score.** Only `reliable`-tier metrics move the numeric
  score; `approximate` 2D proxies are soft indicators shown as ranges, never raw degrees.
