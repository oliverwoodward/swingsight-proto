"""The validation layer (spec §13.1; PRD Phase 7 A) — what makes "accurate" measurable.

A golden set of swings with KNOWN faults labelled by a qualified coach, and a per-fault
regression runner that runs the DETERMINISTIC measurement core over that set and reports
how often the pipeline's primary fault agrees with the coach label (+ per-metric error).
A fault may only drive a visible claim once it clears its documented bar against this set
(the validation gate lives in the fault library's `validation` field and is enforced in
gating.pick_primary_fault / coaching._open_gate_ids).

Governing law: this layer only READS the deterministic output — it never perturbs the
measurement payload (scripts/determinism_check.sh stays byte-identical). And it NEVER
fabricates: coach labels are a human input (manifest.load_golden_set structurally rejects
a label without a labeller), and the agreement rate is reported over whatever REAL labels
exist — 0, transparently, until a coach fills the set in.

Modules:
  manifest.py    — load + validate worker/validation/golden_set.json (honesty guard)
  regression.py  — PURE comparison: predicted vs label -> per-fault agreement + metric error
  run_regression.py — entrypoint: load -> run_measurement per clip -> report -> exit code
"""
