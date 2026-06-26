"""Determinism guardrails — the headline requirement of the measurement layer.

Re-running the worker on the same clip must produce a byte-identical measurement
layer (keypoints / events / metrics / fault gates / score / quality). MediaPipe,
BLAS, OpenCV and thread pools can all introduce run-to-run float noise from
non-deterministic reduction order. Two defences:

1. **Single-thread every numeric backend** so reductions happen in a fixed order.
   These env vars MUST be set before numpy / OpenCV / MediaPipe import anything,
   so this module is imported first (before any CV import) in every entrypoint.
2. **Quantise every emitted float** to a fixed number of decimals via `q()` before
   serialisation. This collapses any sub-quantum noise to an identical value and is
   itself deterministic (Python's round is banker's rounding, fully specified).

The faithful proof is the checkpoint: run this code twice inside the *same* Docker
image and diff the measurement JSON. See scripts/determinism_check.sh.
"""

from __future__ import annotations

import os

# --- 1. Pin every threaded numeric backend to a single thread (set before imports) ---
_SINGLE_THREAD_ENV = {
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
    "VECLIB_MAXIMUM_THREADS": "1",
    "TF_NUM_INTRAOP_THREADS": "1",
    "TF_NUM_INTEROP_THREADS": "1",
    "TF_CPP_MIN_LOG_LEVEL": "3",
    # MediaPipe / TFLite run on CPU; never let a GPU delegate (non-deterministic) in.
    "MEDIAPIPE_DISABLE_GPU": "1",
    "CUDA_VISIBLE_DEVICES": "",
    # Stable Python hashing for any dict/set ordering that leaks into output.
    "PYTHONHASHSEED": "0",
}

for _key, _value in _SINGLE_THREAD_ENV.items():
    os.environ.setdefault(_key, _value)


def configure_opencv_single_thread() -> None:
    """Force OpenCV to a single thread. Call once, after cv2 is importable."""
    try:
        import cv2

        cv2.setNumThreads(1)
    except Exception:  # pragma: no cover - cv2 always present in the container
        pass


# --- 2. Stable float quantisation ---------------------------------------------------

# Decimal places per quantity. Generous enough to be lossless for the UI, tight
# enough to absorb any 1e-7-scale nondeterminism from float32 inference.
COORD_DECIMALS = 5  # normalised [0,1]; 1e-5 ≈ 0.04px at 4K, invisible
TIME_DECIMALS = 5  # seconds; 1e-5 = 10µs, far under a 60fps frame (16.7ms)
METRIC_DECIMALS = 4
CONF_DECIMALS = 4
MAGNITUDE_DECIMALS = 5


def q(value: float, decimals: int = METRIC_DECIMALS) -> float:
    """Quantise a float to a fixed number of decimals, deterministically.

    NaN / inf are coerced to 0.0 so they can never reach the JSON or the DB
    (a NaN would also break JSON spec-compliance). Callers that need to *detect*
    implausible values do so before quantising.
    """
    import math

    if value is None or math.isnan(value) or math.isinf(value):
        return 0.0
    # round(x, n) is specified and stable; normalise -0.0 to 0.0 for clean output.
    rounded = round(float(value), decimals)
    return rounded + 0.0
