"""End-to-end orchestration for one analysis (the IO wrapper around the pure
measurement core). Used by main.py's /analyze.

Flow: mark processing → download raw from R2 → transcode playback → run the
deterministic measurement → on `unreadable` write the quality report; on `complete`
upload the playback clip + annotated keyframes to R2 and write all results to
Supabase. Any unexpected error is captured as `failed` with a reason, never a crash
that leaves the row stuck in `processing`.

The heavy work runs synchronously inside the request: Cloud Run guarantees CPU during
request handling (scale-to-zero between jobs), so a single analysis completes before
the response. Deploy with a generous request timeout and concurrency=1 (see README).
"""

from __future__ import annotations

import logging
import os
import tempfile

from .config import Settings
from .pipeline import assemble, keyframes, transcode
from . import coaching, recheck, storage, writeback

logger = logging.getLogger("swingsight.worker.process")


def process_analysis(
    settings: Settings,
    analysis_id: str,
    profile_id: str,
    view: str,
    handedness: str,
    raw_object_key: str,
    previous_analysis_id: str | None = None,
) -> str:
    client = writeback.get_client(settings)
    tmpdir = tempfile.mkdtemp(prefix=f"swing-{analysis_id}-")
    try:
        writeback.mark_processing(client, analysis_id)

        raw_path = os.path.join(tmpdir, "raw_input")
        storage.download_raw(settings, raw_object_key, raw_path)

        playback_path = os.path.join(tmpdir, "playback.mp4")
        width, height = transcode.make_playback_clip(raw_path, playback_path)

        run = assemble.run_measurement(
            playback_path,
            width,
            height,
            view,
            handedness,
            settings.target_fps,
            settings.pose_height,
            settings.pose_model_complexity,
            settings.pose_model_dir,
        )
        result = run.result

        if result.status == "unreadable":
            writeback.write_unreadable(
                client, analysis_id, result.quality, result.fault_library_version
            )
            return "unreadable"

        playback_key = storage.playback_key(profile_id, analysis_id)
        storage.upload_file(settings, playback_key, playback_path, "video/mp4")

        keyframe_keys: dict[str, str] = {}
        rendered = keyframes.render_keyframes(run.clip, run.pose, run.events)
        for kf in rendered:
            key = storage.keyframe_key(profile_id, analysis_id, kf.event_name)
            storage.upload_bytes(settings, key, kf.jpeg, "image/jpeg")
            keyframe_keys[kf.event_name] = key

        writeback.write_complete(client, analysis_id, result, playback_key, keyframe_keys)

        # --- Phase 5: the interpretation layer (the ONLY non-deterministic step) ---
        # Runs AFTER write_complete so a full measurement always lands even if the LLM
        # fails, and writes ONLY the `coaching` jsonb. We reuse the already-rendered
        # annotated keyframe JPEGs (no R2 round-trip). Wrapped so a coaching failure can
        # never knock the row off `complete` — generate_coaching itself never raises, but
        # the write-back could, and the measurement is the source of truth.
        try:
            coaching_result = coaching.generate_coaching(
                settings, result, rendered, view, handedness
            )
            writeback.write_coaching(client, analysis_id, coaching_result)
        except Exception:  # noqa: BLE001
            logger.exception("coaching step failed for %s (row stays complete)", analysis_id)

        # --- Phase 6: the drill-then-recheck step (DETERMINISTIC; a couple of DB reads +
        # arithmetic, no LLM). Like coaching it runs AFTER write_complete and writes its
        # own table, so it stays OUT of the determinism payload + run_local.py. Compares
        # the previous same-view analysis's tracked metric to this one; writes nothing if
        # there's no honest comparison (first swing, missing/cross-view prior, etc.).
        if previous_analysis_id:
            try:
                recheck.compute_and_write_recheck(
                    client,
                    analysis_id=analysis_id,
                    profile_id=profile_id,
                    view=view,
                    result=result,
                    previous_analysis_id=previous_analysis_id,
                )
            except Exception:  # noqa: BLE001
                logger.exception("recheck step failed for %s (row stays complete)", analysis_id)

        return "complete"

    except Exception as exc:  # noqa: BLE001 — record, never leave row in 'processing'
        logger.exception("process_analysis failed for %s", analysis_id)
        try:
            writeback.write_failed(client, analysis_id, str(exc))
        except Exception:  # pragma: no cover
            logger.exception("could not even write 'failed' for %s", analysis_id)
        return "failed"
    finally:
        _cleanup(tmpdir)


def _cleanup(tmpdir: str) -> None:
    import shutil

    shutil.rmtree(tmpdir, ignore_errors=True)
