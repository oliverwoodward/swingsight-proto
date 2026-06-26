"""Ingest / normalise (spec §8 step 1; PRD Phase 3 item 1).

Reads the playback clip with PyAV to get REAL per-frame presentation times, then
produces a deterministic ~60fps working frame set:

  * source ≈ target (≤ 1.1× target)  -> keep every frame (covers 60fps and sub-60fps).
  * source clean multiple / odd high  -> select the frame nearest each point on a
    60fps grid (120→every 2nd, 90→nearest), by REAL timestamp, deterministically.
  * sub-target (e.g. 30fps)           -> processed natively, flagged lower-confidence.

Tempo/timing are always computed from the selected frames' REAL timestamps, so a VFR
clip times correctly. We NEVER reject an upload here — a clip we cannot decode at all
becomes `unreadable` upstream, not an exception that drops the job.
"""

from __future__ import annotations

import logging

import numpy as np

from ..determinism import configure_opencv_single_thread
from .types import NormalizedClip

logger = logging.getLogger("swingsight.worker.ingest")


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _decode_frames(path: str, pose_height: int) -> tuple[list[np.ndarray], np.ndarray]:
    """Decode every frame to RGB at `pose_height`, returning (frames, timestamps_s)."""
    import av
    import cv2

    configure_opencv_single_thread()

    frames: list[np.ndarray] = []
    times: list[float] = []
    container = av.open(path)
    try:
        stream = container.streams.video[0]
        stream.thread_type = "NONE"  # deterministic decode order
        nominal = float(stream.average_rate) if stream.average_rate else 60.0
        last_t = 0.0
        for i, frame in enumerate(container.decode(stream)):
            t = frame.time
            if t is None:
                t = last_t + (1.0 / nominal if nominal > 0 else 1.0 / 60.0)
            last_t = float(t)
            rgb = frame.to_ndarray(format="rgb24")
            h, w = rgb.shape[:2]
            if h != pose_height:
                new_w = max(2, int(round(w * pose_height / h)) & ~1)  # even width
                rgb = cv2.resize(rgb, (new_w, pose_height), interpolation=cv2.INTER_AREA)
            frames.append(np.ascontiguousarray(rgb))
            times.append(last_t)
    finally:
        container.close()
    return frames, np.asarray(times, dtype=np.float64)


def _select_60fps_grid(times: np.ndarray, target_fps: int) -> list[int]:
    """Deterministically pick the frame nearest each 60fps grid point (ties → lower
    index), deduped — the software equivalent of ffmpeg's `fps` decimation."""
    grid_dt = 1.0 / target_fps
    selected: list[int] = []
    used: set[int] = set()
    g = float(times[0])
    last = float(times[-1])
    while g <= last + 1e-9:
        idx = int(np.argmin(np.abs(times - g)))
        if idx not in used:
            used.add(idx)
            selected.append(idx)
        g += grid_dt
    return selected


def load_normalized(
    playback_path: str,
    playback_width: int,
    playback_height: int,
    target_fps: int,
    pose_height: int,
) -> NormalizedClip:
    frames, times = _decode_frames(playback_path, pose_height)
    n = len(frames)
    if n == 0:
        raise RuntimeError("no decodable video frames")

    if n >= 2 and times[-1] > times[0]:
        eff_fps = (n - 1) / (times[-1] - times[0])
    else:
        eff_fps = float(target_fps)

    decimated = False
    if eff_fps > target_fps * 1.1 and n >= 4:
        idx = _select_60fps_grid(times, target_fps)
        frames = [frames[i] for i in idx]
        times = times[idx]
        decimated = True

    # Re-base timestamps to 0 at the first kept frame (seconds from clip start).
    times = times - times[0]

    if decimated:
        norm_conf = 1.0
        note = f"decimated ~{eff_fps:.1f}fps source to ~{target_fps}fps by nearest real timestamp"
    elif eff_fps >= target_fps * 0.95:
        norm_conf = 1.0
        note = f"native ~{eff_fps:.1f}fps (at/above target {target_fps})"
    else:
        norm_conf = _clamp(eff_fps / target_fps, 0.6, 0.98)
        note = (
            f"native sub-{target_fps}fps (~{eff_fps:.1f}fps); timing kept from real "
            f"timestamps, confidence reduced to {norm_conf:.2f}"
        )

    logger.info(
        "ingest: %d frames, eff_fps=%.2f, %s", len(frames), eff_fps, note
    )
    return NormalizedClip(
        frames=frames,
        timestamps=times,
        source_fps=float(eff_fps),
        target_fps=target_fps,
        playback_width=playback_width,
        playback_height=playback_height,
        normalization_confidence=norm_conf,
        fps_note=note,
    )
