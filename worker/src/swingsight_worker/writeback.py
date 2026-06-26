"""Write results back to Supabase with the SERVICE-ROLE key.

The service role bypasses RLS and the swing_analyses column-guard trigger (which
freezes worker-owned columns from client writes) — this is the only writer allowed to
set keypoints/metrics/faults/score/quality. Column names mirror the Phase-2 schema;
the jsonb payloads mirror the camelCase domain types (the app reads them directly).

Status is advanced processing → complete | unreadable | failed; the app receives each
change over Realtime. Child rows are written before swing_analyses flips to `complete`
so a report that reacts to `complete` always finds its keypoints/metrics present.
"""

from __future__ import annotations

import logging

from .config import Settings
from .pipeline.types import MeasurementResult

logger = logging.getLogger("swingsight.worker.writeback")

_KEYPOINT_CHUNK = 100


def get_client(settings: Settings):
    from supabase import create_client

    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def mark_processing(client, analysis_id: str) -> None:
    client.table("swing_analyses").update({"status": "processing"}).eq(
        "id", analysis_id
    ).execute()
    logger.info("writeback: %s -> processing", analysis_id)


def write_unreadable(client, analysis_id: str, quality: dict, fault_library_version: str) -> None:
    client.table("swing_analyses").update(
        {
            "status": "unreadable",
            "quality": quality,
            "fault_library_version": fault_library_version,
        }
    ).eq("id", analysis_id).execute()
    logger.info("writeback: %s -> unreadable (%s)", analysis_id, quality.get("reason"))


def write_failed(client, analysis_id: str, error_reason: str) -> None:
    client.table("swing_analyses").update(
        {"status": "failed", "error_reason": error_reason[:500]}
    ).eq("id", analysis_id).execute()
    logger.info("writeback: %s -> failed (%s)", analysis_id, error_reason[:120])


def write_coaching(client, analysis_id: str, coaching: dict) -> None:
    """Write ONLY the `coaching` jsonb column (the interpretation layer's output).

    Status is untouched — this runs after the row is already `complete`, so it surfaces
    as a second Realtime update on the same row (the report fills its coaching section
    when it arrives). Updating only `coaching` does not re-fire the queued-swing webhook
    (that trigger keys on a status transition to `queued`). Service role bypasses the
    column guard, so writing a worker-owned column is allowed.
    """
    client.table("swing_analyses").update({"coaching": coaching}).eq(
        "id", analysis_id
    ).execute()
    logger.info(
        "writeback: %s -> coaching (source=%s, fault=%s)",
        analysis_id, coaching.get("source"), coaching.get("chosenFaultId"),
    )


def write_drill_recheck(client, row: dict) -> None:
    """Insert the deterministic drill-recheck comparison (Phase 6 / spec §12).

    Idempotent: clear any prior recheck for this current analysis first, so a re-run
    replaces rather than duplicates it. `drill_recheck` is not Realtime-replicated (only
    swing_analyses is) — the report fetches it on load, shortly after `complete`.
    """
    current_analysis_id = row["current_analysis_id"]
    client.table("drill_recheck").delete().eq(
        "current_analysis_id", current_analysis_id
    ).execute()
    client.table("drill_recheck").insert(row).execute()
    logger.info(
        "writeback: drill_recheck %s (metric=%s delta=%s improved=%s)",
        current_analysis_id, row["target_metric_key"], row["delta"], row["improved"],
    )


def _metric_row(analysis_id: str, m: dict) -> dict:
    return {
        "analysis_id": analysis_id,
        "metric_key": m["key"],
        "label": m["label"],
        "value": m["value"],
        "unit": m["unit"],
        "status": m["status"],
        "reliability_tag": m["reliabilityTag"],
        "confidence": m["confidence"],
        "ideal": m["ideal"],
        "friendly_min": m["friendlyRange"]["min"],
        "friendly_max": m["friendlyRange"]["max"],
        "in_range": m["inRange"],
    }


def write_complete(
    client,
    analysis_id: str,
    result: MeasurementResult,
    playback_key: str,
    keyframe_keys: dict[str, str],
) -> None:
    """Persist a complete measurement: child rows first, then flip to `complete`."""
    # Idempotent: clear any prior child rows for this analysis (re-run safe).
    for table in ("swing_metrics", "swing_keyframes", "swing_keypoints"):
        client.table(table).delete().eq("analysis_id", analysis_id).execute()

    if result.metrics:
        client.table("swing_metrics").insert(
            [_metric_row(analysis_id, m) for m in result.metrics]
        ).execute()

    if result.events:
        client.table("swing_keyframes").insert(
            [
                {
                    "analysis_id": analysis_id,
                    "event_name": e["name"],
                    "frame_index": e["frameIndex"],
                    "t": e["t"],
                    "confidence": e["confidence"],
                    "frame_object_key": keyframe_keys.get(e["name"]),
                }
                for e in result.events
            ]
        ).execute()

    rows = [
        {
            "analysis_id": analysis_id,
            "frame_index": i,
            "t": frame["t"],
            "landmarks": frame["landmarks"],
        }
        for i, frame in enumerate(result.keypoint_frames)
    ]
    for start in range(0, len(rows), _KEYPOINT_CHUNK):
        client.table("swing_keypoints").insert(rows[start : start + _KEYPOINT_CHUNK]).execute()

    client.table("swing_analyses").update(
        {
            "status": "complete",
            "playback_video_url": playback_key,
            "keypoints_meta": result.keypoints_meta,
            "faults": result.faults,
            "primary_fault_id": result.primary_fault_id,
            "score": result.score,
            "quality": result.quality,
            "fault_library_version": result.fault_library_version,
        }
    ).eq("id", analysis_id).execute()

    logger.info(
        "writeback: %s -> complete (%d metrics, %d keyframes, %d keypoint frames)",
        analysis_id, len(result.metrics), len(result.events), len(result.keypoint_frames),
    )
