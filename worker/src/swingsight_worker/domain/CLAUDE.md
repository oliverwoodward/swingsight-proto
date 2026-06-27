# domain/ (Python) — a MIRROR, not a source

These files are a hand-kept Python mirror of **`app/src/domain/*.ts`**, which is the
**source of truth** for the shared contract. Same formulas, operator-for-operator
(the docstrings cross-reference their TS counterparts).

**Do not change a formula or shape here without changing `app/src/domain/*.ts` to match
(and usually the SQL schema/seed too).** A silent divergence means the app and worker
disagree about what a number means. See the full mirror rule in
[`app/src/domain/CLAUDE.md`](../../../../app/src/domain/CLAUDE.md).

After any edit here:
```bash
python3 -m py_compile worker/src/swingsight_worker/domain/*.py
cd app && npx tsc --noEmit -p tsconfig.json     # confirm the TS side still matches
scripts/determinism_check.sh                     # if you touched a measured formula
```

Files mirror their TS twins: `keypoints.py` ↔ `keypoints.ts`, `events.py` ↔ `events.ts`,
`fault_library.py` ↔ `faultLibrary.ts`, `gating.py` ↔ `gating.ts`. (Highlight/coordinates
stay app-side — the worker doesn't draw.)
