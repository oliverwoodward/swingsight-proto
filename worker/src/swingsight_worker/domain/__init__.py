"""Python mirror of the shared domain contract (app/src/domain/*.ts).

The worker's JSON output must match these shapes 1:1, and its fault gating must use
the SAME logic as app/src/domain/gating.ts so the app and worker always agree on
which gate is open and which fault is primary. This package is the single Python
source of that contract; the pipeline imports from here and never re-derives a
threshold, a lead/trail map, or a gate formula inline.

Mirrors:
  keypoints.py    <- domain/keypoints.ts   (BlazePose-33 indices, lead/trail map)
  events.py       <- domain/events.ts      (8 events, phase-window resolution)
  fault_library.py<- domain/faultLibrary.ts(METRIC_META, DRILLS, FAULT_LIBRARY)
  gating.py       <- domain/gating.ts      (evaluate_gate, severity_band, primary)
"""
