"""Local measurement harness — the determinism checkpoint entrypoint.

Runs transcode + the pure measurement core on a LOCAL video file and prints the
canonical measurement JSON to stdout, with NO R2 or Supabase IO. Running it twice on
the same clip (inside the same container) must produce byte-identical stdout — that is
the Phase-3 determinism contract. See scripts/determinism_check.sh.

Usage:
  python -m swingsight_worker.run_local VIDEO [--view face_on|dtl] [--handedness RH|LH]
                                        [--out-dir DIR]   # also write playback+keyframes

`determinism` is imported first so the single-thread env is set before numpy/OpenCV/
MediaPipe load.
"""

from __future__ import annotations

from . import determinism  # noqa: F401  (must be first — sets thread env on import)

import argparse
import os
import sys
import tempfile

from .config import get_settings
from .pipeline import assemble, keyframes, transcode
from .serialize import measurement_json


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="SwingSight local measurement harness")
    parser.add_argument("video", help="path to a local swing video")
    parser.add_argument("--view", choices=["face_on", "dtl"], default="face_on")
    parser.add_argument("--handedness", choices=["RH", "LH"], default="RH")
    parser.add_argument("--out-dir", default=None, help="also write playback.mp4 + keyframe JPEGs here")
    args = parser.parse_args(argv)

    settings = get_settings()
    tmpdir = tempfile.mkdtemp(prefix="swing-local-")
    playback_path = (
        os.path.join(args.out_dir, "playback.mp4") if args.out_dir else os.path.join(tmpdir, "playback.mp4")
    )
    if args.out_dir:
        os.makedirs(args.out_dir, exist_ok=True)

    width, height = transcode.make_playback_clip(args.video, playback_path)
    run = assemble.run_measurement(
        playback_path,
        width,
        height,
        args.view,
        args.handedness,
        settings.target_fps,
        settings.pose_height,
        settings.pose_model_complexity,
        settings.pose_model_dir,
    )

    if args.out_dir and run.events is not None and run.result.status == "complete":
        for kf in keyframes.render_keyframes(run.clip, run.pose, run.events):
            with open(os.path.join(args.out_dir, f"keyframe_{kf.event_name}.jpg"), "wb") as fh:
                fh.write(kf.jpeg)

    sys.stdout.write(measurement_json(run.result))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
