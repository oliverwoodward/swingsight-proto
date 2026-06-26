"""Cloud Run HTTP entrypoint for the SwingSight CV worker.

Flow:
  1. A Supabase Edge Function (on-swing-insert) POSTs /analyze when a swing_analyses
     row is queued with its raw clip uploaded, authenticated with the invoker token.
  2. The worker downloads the raw clip from R2, runs the deterministic CV pipeline
     (transcode → pose → events → metrics → fault gates → score), writes the playback
     clip + annotated keyframes to R2 and the result onto the swing_analyses row via
     the Supabase service role. The app receives it over Realtime.

This is the MEASUREMENT layer only (governing law: CV measures, the AI explains, the
fault library localises). The Claude Haiku coaching call is Phase 5 — not here.

`determinism` is imported first so the single-thread env is set before numpy/OpenCV/
MediaPipe load anywhere in the process.
"""

from __future__ import annotations

from . import determinism  # noqa: F401  (must be first — sets thread env on import)

import logging

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .config import get_settings
from .process import process_analysis

logging.basicConfig(level=get_settings().log_level)
logger = logging.getLogger("swingsight.worker")

app = FastAPI(title="SwingSight CV Worker", version="0.3.0")


class AnalyzeRequest(BaseModel):
    """The job the Edge Function hands the worker."""

    analysis_id: str = Field(..., description="swing_analyses row id")
    profile_id: str
    view: str = Field(..., description="'face_on' | 'dtl'")
    handedness: str = Field(..., description="'RH' | 'LH'")
    raw_object_key: str = Field(..., description="R2 key of the uploaded raw clip")
    previous_analysis_id: str | None = Field(
        default=None, description="for the drill-recheck comparison"
    )


class AnalyzeAck(BaseModel):
    analysis_id: str
    accepted: bool
    status: str


def verify_invoker(authorization: str | None = Header(default=None)) -> None:
    """Authenticate the caller (the on-swing-insert Edge Function).

    When `worker_invoker_token` is configured, /analyze requires
    `Authorization: Bearer <token>`. When it is empty (local dev), the check is
    skipped so the worker can be exercised directly.
    """
    expected = get_settings().worker_invoker_token
    if not expected:
        return
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="invalid invoker token")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "version": app.version}


@app.post("/analyze", response_model=AnalyzeAck)
def analyze(req: AnalyzeRequest, _auth: None = Depends(verify_invoker)) -> AnalyzeAck:
    """Run the full measurement pipeline synchronously and write results back.

    Returns 200 once a terminal status has been recorded on the row (the truth lives
    in the DB / Realtime, not the HTTP body), so the Edge Function and pg_net never
    retry-storm. Only an auth failure is a non-2xx.
    """
    logger.info("analyze: %s view=%s handedness=%s", req.analysis_id, req.view, req.handedness)
    status = process_analysis(
        get_settings(),
        analysis_id=req.analysis_id,
        profile_id=req.profile_id,
        view=req.view,
        handedness=req.handedness,
        raw_object_key=req.raw_object_key,
        previous_analysis_id=req.previous_analysis_id,
    )
    return AnalyzeAck(analysis_id=req.analysis_id, accepted=status != "failed", status=status)
