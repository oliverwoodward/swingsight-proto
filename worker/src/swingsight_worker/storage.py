"""Cloudflare R2 access (S3 API) — download the raw clip, upload playback + frames.

R2 speaks S3, so this is boto3 with the R2 endpoint and `region_name='auto'`. The
worker writes to the lifecycle-managed prefixes (raw 2d / frames 7d / playback 30d)
so retention is enforced by R2 rules, not app code:

  raw/<uid>/<name>.mov            (read; uploaded by the app)
  playback/<uid>/<analysis>/...   (write; the H.264 playback clip)
  frames/<uid>/<analysis>/...     (write; the annotated keyframe JPEGs)

playback_video_url stores the OBJECT KEY (not a URL): the bucket is private, so the
report mints a short-lived presigned GET on demand (Phase 4/5), rather than persisting
a long-lived URL that would outlive its signature or leak in logs.
"""

from __future__ import annotations

import logging

from .config import Settings

logger = logging.getLogger("swingsight.worker.storage")


def _client(settings: Settings):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
    )


def playback_key(uid: str, analysis_id: str) -> str:
    return f"playback/{uid}/{analysis_id}/playback.mp4"


def keyframe_key(uid: str, analysis_id: str, event_name: str) -> str:
    return f"frames/{uid}/{analysis_id}/{event_name}.jpg"


def download_raw(settings: Settings, key: str, dest_path: str) -> None:
    logger.info("R2 download: %s -> %s", key, dest_path)
    _client(settings).download_file(settings.r2_bucket, key, dest_path)


def upload_file(settings: Settings, key: str, path: str, content_type: str) -> None:
    logger.info("R2 upload (file): %s", key)
    _client(settings).upload_file(
        path, settings.r2_bucket, key, ExtraArgs={"ContentType": content_type}
    )


def upload_bytes(settings: Settings, key: str, data: bytes, content_type: str) -> None:
    logger.info("R2 upload (bytes, %d): %s", len(data), key)
    _client(settings).put_object(
        Bucket=settings.r2_bucket, Key=key, Body=data, ContentType=content_type
    )
