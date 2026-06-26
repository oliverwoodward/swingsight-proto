"""Playback transcode + normalisation (spec §8 step 2; PRD Phase 3 item 2).

One ffmpeg pass turns the raw upload into the canonical clip the rest of the
pipeline uses: auto-rotated upright, scaled to 720p, H.264/yuv420p, faststart. We
deliberately PRESERVE the source presentation timestamps (`-vsync passthrough`) so
ingest can read REAL per-frame times (true tempo on VFR clips) — we do not resample
to CFR here. This same clip is the report's playback video, which guarantees the
skeleton overlay (drawn from normalised coords on this exact image) cannot drift
from what the user watches.

Why one pass for both: if pose ran on raw (un-rotated) frames while the player
showed an auto-rotated clip, the overlay would be mirrored/rotated. Sharing one
upright, known-orientation clip removes that whole failure class.
"""

from __future__ import annotations

import json
import logging
import subprocess

logger = logging.getLogger("swingsight.worker.transcode")

PLAYBACK_HEIGHT = 720


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=True)


def probe_dimensions(path: str) -> tuple[int, int]:
    """Return (width, height) of the first video stream via ffprobe."""
    out = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            path,
        ]
    ).stdout
    stream = json.loads(out)["streams"][0]
    return int(stream["width"]), int(stream["height"])


def make_playback_clip(raw_path: str, out_path: str) -> tuple[int, int]:
    """Transcode raw -> upright 720p H.264 playback clip. Returns (width, height).

    Single-threaded x264 for reproducibility (concurrency is 1 per instance anyway).
    Drops audio (not needed; privacy) and strips rotation metadata after auto-rotate
    so a downstream player never double-rotates.
    """
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        raw_path,
        "-vf",
        f"scale=-2:{PLAYBACK_HEIGHT}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "1",
        "-vsync",
        "passthrough",
        "-an",
        "-movflags",
        "+faststart",
        "-map_metadata",
        "-1",
        "-metadata:s:v:0",
        "rotate=0",
        out_path,
    ]
    logger.info("transcoding playback clip: %s -> %s", raw_path, out_path)
    try:
        _run(cmd)
    except subprocess.CalledProcessError as exc:  # surfaced as 'unreadable' upstream
        raise RuntimeError(f"ffmpeg transcode failed: {exc.stderr[-500:]}") from exc
    return probe_dimensions(out_path)
