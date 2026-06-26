"""Runtime configuration, read from the environment (Cloud Run secrets/env vars).

Nothing secret is ever hardcoded. The Anthropic key, the Supabase service-role key,
and the R2 credentials all arrive as env vars injected by Cloud Run.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- service ---
    log_level: str = "INFO"
    # Shared bearer token the on-swing-insert Edge Function presents when calling
    # /analyze. When set, /analyze requires it; when empty (local dev), the check
    # is skipped. Set this as a Cloud Run secret AND as the Edge Function's
    # WORKER_INVOKER_TOKEN so both ends agree.
    worker_invoker_token: str = ""

    # --- Cloudflare R2 (S3-compatible) ---
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    # Derived endpoint, e.g. https://<account>.r2.cloudflarestorage.com
    r2_endpoint: str = ""

    # --- Supabase (write results back) ---
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # --- Coaching / interpretation layer (Phase 5; provider-abstracted) ---
    # The LLM call is config, not code: switch provider/model without touching the report.
    # An empty key (or a non-anthropic provider) makes the worker use the deterministic
    # template fallback — so local runs and a keyless deploy still produce coaching.
    coaching_provider: str = "anthropic"
    anthropic_api_key: str = ""
    coaching_model: str = "claude-haiku-4-5"

    # --- pipeline knobs ---
    target_fps: int = 60
    fault_library_version: str = "2026.06.0"
    # Working resolution pose runs at (frames retained for keyframe JPEGs). Coords are
    # normalised so this only trades precision vs memory; 480 is ample for coaching.
    pose_height: int = 480
    # BlazePose model complexity: 0 = Lite, 1 = Full (fits latency budget), 2 = Heavy.
    pose_model_complexity: int = 1
    # Directory holding the bundled pose_landmarker_*.task model files (Tasks API).
    pose_model_dir: str = "/app/models"


@lru_cache
def get_settings() -> Settings:
    return Settings()
