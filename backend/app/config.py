"""Application settings, loaded from environment variables / backend/.env."""

from functools import lru_cache
from typing import Annotated
from urllib.parse import quote, unquote

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "GovPath AI"
    app_env: str = "development"
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    # Database: None/empty means "not configured yet"; the app still starts.
    database_url: str | None = None
    db_sslmode: str = "require"
    db_echo: bool = False
    # Seconds to cache read-only knowledge in the API process (0 disables).
    knowledge_cache_seconds: float = 60

    # Supabase Auth (email). Only the project URL is needed: access tokens are verified against
    # the project's public signing keys (JWKS). Never put the service-role key here.
    supabase_url: str | None = None
    supabase_jwt_audience: str = "authenticated"
    supabase_jwks_cache_seconds: int = 600
    # Shared secret for POST /api/internal/expire-documents (external scheduler). Unset = disabled.
    cron_secret: str | None = None

    # Gemini
    gemini_api_key: str | None = None
    # gemini-3.8-flash returned 503/504 for every request during validation (2026-11-14);
    # gemini-3.6-flash (Stable, free tier, structured output, thinking "low") was verified working.
    gemini_model: str = "gemini-3.6-flash"
    gemini_embedding_model: str = "gemini-embedding-2"
    embedding_dim: int = 768  # must equal the vector column size (app.models.chunk)
    gemini_timeout_seconds: float = 30
    gemini_max_retries: int = 3  # bounded; quota exhaustion is never retried
    gemini_backoff_base_seconds: float = 2
    gemini_backoff_max_seconds: float = 30
    gemini_min_interval_seconds: float = 1.0  # throttle between calls from one process
    gemini_daily_generation_limit: int = 200  # per API process, resets at UTC midnight
    gemini_daily_embedding_limit: int = 500  # query embeddings per API process per day
    gemini_max_output_tokens: int = 2048  # includes thinking tokens
    gemini_thinking_level: str = "low"  # gemini-3.6-flash: minimal | low | medium | high
    gemini_temperature: float = 0.2

    # Retrieval-augmented assistant
    rag_chunk_chars: int = 1200
    rag_chunk_overlap_chars: int = 200
    rag_embed_batch_size: int = 16
    rag_top_k: int = 5
    # Tuned on data/evaluation (gemini-embedding-2 cosine scores cluster in 0.62-0.84; see
    # docs/evaluation.md): 0.66 is the lowest value that drops clearly off-topic chunks while
    # leaving ranking metrics unchanged.
    rag_min_similarity: float = 0.66
    rag_high_confidence_similarity: float = 0.75
    rag_max_chunks_per_source: int = 2
    rag_max_context_chars: int = 9000
    rag_verified_sources_only: bool = True
    assistant_cache_seconds: float = 86400
    assistant_max_question_chars: int = 1000

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("database_url", "gemini_api_key", "supabase_url", "cron_secret", mode="before")
    @classmethod
    def _empty_to_none(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @property
    def database_configured(self) -> bool:
        return self.database_url is not None

    @property
    def auth_configured(self) -> bool:
        return self.supabase_url is not None

    @property
    def sqlalchemy_database_url(self) -> str:
        """DATABASE_URL rewritten to use the psycopg (v3) driver."""
        if self.database_url is None:
            raise RuntimeError("DATABASE_URL is not configured")
        return to_psycopg_url(self.database_url)


def to_psycopg_url(url: str) -> str:
    """Rewrite to the psycopg driver and percent-encode credentials.

    Supabase passwords often contain characters such as '@' that break URL parsing when
    pasted unencoded. The host is taken after the *last* '@'; user and password are
    decoded then re-encoded, so already-encoded URLs are left unchanged.
    """
    for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            rest = url[len(prefix) :]
            userinfo, sep, hostpart = rest.rpartition("@")
            if sep:
                user, colon, password = userinfo.partition(":")
                userinfo = _requote(user) + (colon + _requote(password) if colon else "")
                rest = f"{userinfo}@{hostpart}"
            return "postgresql+psycopg://" + rest
    raise ValueError("DATABASE_URL must be a postgresql:// URL")


def _requote(value: str) -> str:
    return quote(unquote(value), safe="")


@lru_cache
def get_settings() -> Settings:
    return Settings()
