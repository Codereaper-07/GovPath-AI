"""Thin, quota-aware wrapper around the official Google GenAI SDK (no LangChain).

- Bounded retries with exponential backoff for transient failures (5xx, timeouts, short 429s).
- Daily-quota exhaustion (RESOURCE_EXHAUSTED with a per-day quota) is never retried.
- A per-process UsageGuard throttles calls and enforces configurable daily caps.
- Never switches to another model or provider.
"""

import asyncio
import random
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx
from google import genai
from google.genai import errors, types
from pydantic import BaseModel

from app.config import Settings

# ------------------------------------------------------------------ errors (safe to show)


class LLMError(Exception):
    """Base class. Messages never contain API keys, prompts or raw provider payloads."""


class LLMNotConfiguredError(LLMError):
    pass


class LLMQuotaExhaustedError(LLMError):
    """Provider quota used up (e.g. free-tier requests per day). Not retried."""


class LLMRateLimitedError(LLMError):
    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class LocalLimitError(LLMRateLimitedError):
    """GovPath's own daily cap for this process was reached."""


class LLMUnavailableError(LLMError):
    """Transient provider failure that persisted after bounded retries."""


class LLMRequestError(LLMError):
    """Non-retryable request/response problem (bad request, invalid output, auth)."""


# ------------------------------------------------------------------ retry policy


@dataclass(frozen=True)
class RetryPolicy:
    max_retries: int = 3
    base_delay: float = 2.0
    max_delay: float = 30.0

    def delay(self, attempt: int, hint: float | None = None) -> float:
        backoff = min(self.max_delay, self.base_delay * (2**attempt))
        jittered = backoff * (0.8 + 0.4 * random.random())
        return min(self.max_delay, max(hint or 0.0, jittered))


_DELAY = re.compile(r"^(\d+(?:\.\d+)?)s$")


def _error_details(exc: errors.APIError) -> list[dict]:
    payload: Any = exc.details
    if isinstance(payload, dict) and "error" in payload:
        payload = payload["error"]
    details = payload.get("details") if isinstance(payload, dict) else None
    return [d for d in details or [] if isinstance(d, dict)]


def classify(exc: BaseException) -> tuple[str, float | None]:
    """Return (kind, retry_after). kind: quota | rate_limit | transient | fatal."""
    if isinstance(exc, errors.APIError):
        if exc.code == 429 or exc.status == "RESOURCE_EXHAUSTED":
            retry_after = None
            per_day = False
            for d in _error_details(exc):
                kind = str(d.get("@type", ""))
                if kind.endswith("RetryInfo"):
                    m = _DELAY.match(str(d.get("retryDelay", "")))
                    retry_after = float(m.group(1)) if m else None
                if kind.endswith("QuotaFailure"):
                    for v in d.get("violations", []) or []:
                        if "perday" in str(v.get("quotaId", "")).lower():
                            per_day = True
            return ("quota", None) if per_day else ("rate_limit", retry_after)
        if exc.code in (408, 500, 502, 503, 504):
            return "transient", None
        return "fatal", None
    if isinstance(exc, (httpx.TimeoutException, httpx.TransportError, asyncio.TimeoutError)):
        return "transient", None
    return "fatal", None


async def with_retries[T](
    call: Callable[[], Awaitable[T]],
    policy: RetryPolicy,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    attempt = 0
    while True:
        try:
            return await call()
        except LLMError:
            raise
        except Exception as exc:  # classified below; never leaks raw details
            kind, hint = classify(exc)
            if kind == "quota":
                raise LLMQuotaExhaustedError("Gemini API quota exhausted") from exc
            if kind == "fatal":
                raise LLMRequestError(f"Gemini request failed ({type(exc).__name__})") from exc
            if attempt >= policy.max_retries or (hint is not None and hint > policy.max_delay):
                if kind == "rate_limit":
                    raise LLMRateLimitedError("Gemini API rate limit reached", hint) from exc
                raise LLMUnavailableError("Gemini API temporarily unavailable") from exc
            await sleep(policy.delay(attempt, hint))
            attempt += 1


# ------------------------------------------------------------------ throttle + daily caps


@dataclass
class UsageGuard:
    min_interval: float = 1.0
    daily_limits: dict[str, int] = field(default_factory=dict)  # purpose -> max calls/day
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    _day: str = ""
    _counts: dict[str, int] = field(default_factory=dict)
    _last: float | None = None
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def used(self, purpose: str) -> int:
        self._roll_day()
        return self._counts.get(purpose, 0)

    def _roll_day(self) -> None:
        today = datetime.now(UTC).date().isoformat()
        if today != self._day:
            self._day, self._counts = today, {}

    async def acquire(self, purpose: str) -> None:
        async with self._lock:
            self._roll_day()
            limit = self.daily_limits.get(purpose)
            if limit is not None and self._counts.get(purpose, 0) >= limit:
                raise LocalLimitError(f"daily {purpose} limit reached")
            if self._last is not None and self.min_interval > 0:
                wait = self.min_interval - (self.clock() - self._last)
                if wait > 0:
                    await self.sleep(wait)
            self._counts[purpose] = self._counts.get(purpose, 0) + 1
            self._last = self.clock()


# ------------------------------------------------------------------ client


class GeminiClient:
    """Generation (JSON-schema output) and embeddings with the configured models only."""

    def __init__(
        self,
        settings: Settings,
        *,
        client: Any | None = None,
        guard: UsageGuard | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self.settings = settings
        self._client = client
        self.guard = guard or UsageGuard(min_interval=settings.gemini_min_interval_seconds)
        self.policy = RetryPolicy(
            settings.gemini_max_retries,
            settings.gemini_backoff_base_seconds,
            settings.gemini_backoff_max_seconds,
        )
        self._sleep = sleep

    @property
    def configured(self) -> bool:
        return self._client is not None or bool(self.settings.gemini_api_key)

    def _sdk(self) -> Any:
        if self._client is None:
            if not self.settings.gemini_api_key:
                raise LLMNotConfiguredError("GEMINI_API_KEY is not configured")
            self._client = genai.Client(
                api_key=self.settings.gemini_api_key,
                http_options=types.HttpOptions(
                    timeout=int(self.settings.gemini_timeout_seconds * 1000)
                ),
            )
        return self._client

    async def _call(self, purpose: str, fn: Callable[[], Awaitable[Any]]) -> Any:
        sdk_timeout = self.settings.gemini_timeout_seconds + 5

        async def attempt():
            await self.guard.acquire(purpose)  # every attempt counts toward the caps
            return await asyncio.wait_for(fn(), timeout=sdk_timeout)

        return await with_retries(attempt, self.policy, self._sleep)

    async def generate_json[M: BaseModel](
        self, *, system: str, prompt: str, schema: type[M], purpose: str = "generation"
    ) -> M:
        sdk = self._sdk()
        s = self.settings
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=s.gemini_temperature,
            max_output_tokens=s.gemini_max_output_tokens,
            response_mime_type="application/json",
            response_schema=schema,
            thinking_config=types.ThinkingConfig(thinking_level=s.gemini_thinking_level.upper()),
        )
        response = await self._call(
            purpose,
            lambda: sdk.aio.models.generate_content(
                model=s.gemini_model, contents=prompt, config=config
            ),
        )
        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, schema):
            return parsed
        try:
            return schema.model_validate_json(response.text or "")
        except Exception as exc:
            raise LLMRequestError("Gemini returned an unusable response") from exc

    async def embed(self, texts: list[str], *, purpose: str = "embedding") -> list[list[float]]:
        """One vector per input text, at the configured output dimensionality."""
        if not texts:
            return []
        sdk = self._sdk()
        s = self.settings
        # gemini-embedding-2 aggregates plain multi-part input into ONE embedding; wrapping each
        # text in its own Content returns a separate embedding per text.
        contents = [types.Content(parts=[types.Part(text=t)]) for t in texts]
        response = await self._call(
            purpose,
            lambda: sdk.aio.models.embed_content(
                model=s.gemini_embedding_model,
                contents=contents,
                config=types.EmbedContentConfig(output_dimensionality=s.embedding_dim),
            ),
        )
        vectors = [list(e.values or []) for e in response.embeddings or []]
        if len(vectors) != len(texts) or any(len(v) != s.embedding_dim for v in vectors):
            raise LLMRequestError(
                f"embedding response mismatch: expected {len(texts)} x {s.embedding_dim}"
            )
        return vectors
