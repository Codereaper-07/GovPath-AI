"""Quota protection: error classification, bounded retries, throttling, daily caps."""

import asyncio

import httpx
import pytest
from pydantic import BaseModel

from app.config import Settings
from app.llm.client import (
    GeminiClient,
    LLMNotConfiguredError,
    LLMQuotaExhaustedError,
    LLMRateLimitedError,
    LLMRequestError,
    LLMUnavailableError,
    LocalLimitError,
    RetryPolicy,
    UsageGuard,
    classify,
    with_retries,
)
from tests.rag_fakes import api_error, fake_gemini, quota_error, rate_limit_error


def test_classification():
    assert classify(quota_error()) == ("quota", None)
    assert classify(rate_limit_error("7s")) == ("rate_limit", 7.0)
    assert classify(api_error(429, "RESOURCE_EXHAUSTED")) == ("rate_limit", None)
    assert classify(api_error(503, "UNAVAILABLE"))[0] == "transient"
    assert classify(api_error(400, "INVALID_ARGUMENT"))[0] == "fatal"
    assert classify(httpx.ReadTimeout("slow"))[0] == "transient"
    assert classify(TimeoutError())[0] == "transient"
    assert classify(ValueError("x"))[0] == "fatal"


class Flaky:
    def __init__(self, *errors):
        self.errors = list(errors)
        self.calls = 0

    async def __call__(self):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return "ok"


async def test_transient_errors_are_retried_with_backoff():
    sleeps = []

    async def sleep(s):
        sleeps.append(s)

    call = Flaky(api_error(503, "UNAVAILABLE"), httpx.ConnectError("x"))
    assert await with_retries(call, RetryPolicy(3, 2, 30), sleep) == "ok"
    assert call.calls == 3
    assert len(sleeps) == 2 and sleeps[0] < sleeps[1] <= 30  # exponential, capped


async def test_retries_are_bounded():
    call = Flaky(*[api_error(500, "INTERNAL")] * 10)
    with pytest.raises(LLMUnavailableError):
        await with_retries(call, RetryPolicy(2, 0.01, 0.01), lambda s: asyncio.sleep(0))
    assert call.calls == 3  # 1 + 2 retries, never indefinite


async def test_daily_quota_exhaustion_is_never_retried():
    call = Flaky(quota_error(), quota_error())
    with pytest.raises(LLMQuotaExhaustedError):
        await with_retries(call, RetryPolicy(5, 0, 0), lambda s: asyncio.sleep(0))
    assert call.calls == 1


async def test_rate_limit_honours_retry_delay_then_gives_up():
    sleeps = []

    async def sleep(s):
        sleeps.append(s)

    ok = Flaky(rate_limit_error("3s"))
    assert await with_retries(ok, RetryPolicy(3, 0.1, 30), sleep) == "ok"
    assert sleeps[0] >= 3

    too_long = Flaky(rate_limit_error("120s"))
    with pytest.raises(LLMRateLimitedError) as exc:
        await with_retries(too_long, RetryPolicy(3, 0.1, 30), sleep)
    assert too_long.calls == 1 and exc.value.retry_after == 120


async def test_fatal_errors_are_not_retried_and_do_not_leak_details():
    call = Flaky(api_error(400, "INVALID_ARGUMENT"))
    with pytest.raises(LLMRequestError) as exc:
        await with_retries(call, RetryPolicy(3, 0, 0), lambda s: asyncio.sleep(0))
    assert call.calls == 1 and "INVALID_ARGUMENT" not in str(exc.value)


async def test_usage_guard_daily_limit_and_throttle():
    waits = []

    async def sleep(s):
        waits.append(s)

    t = [100.0]
    guard = UsageGuard(
        min_interval=1.0, daily_limits={"generation": 2}, clock=lambda: t[0], sleep=sleep
    )
    await guard.acquire("generation")
    await guard.acquire("generation")
    assert waits and waits[0] == pytest.approx(1.0)
    with pytest.raises(LocalLimitError):
        await guard.acquire("generation")
    await guard.acquire("query_embedding")  # other purposes have their own budget
    assert guard.used("generation") == 2


class Out(BaseModel):
    reply: str


async def test_generate_json_uses_configured_model_limits_and_thinking():
    client, models = fake_gemini()
    models.answer = '{"reply": "ok"}'
    out = await client.generate_json(system="sys", prompt="p", schema=Out)
    assert out.reply == "ok"
    call = models.generate_calls[0]
    assert call["model"] == "gemini-3.6-flash"
    cfg = call["config"]
    assert cfg.system_instruction == "sys" and cfg.max_output_tokens == 2048
    assert cfg.response_mime_type == "application/json" and cfg.response_schema is Out
    assert cfg.thinking_config.thinking_level.value == "LOW"


async def test_generate_json_rejects_unusable_output():
    client, models = fake_gemini()
    models.answer = "not json"
    with pytest.raises(LLMRequestError):
        await client.generate_json(system="s", prompt="p", schema=Out)


async def test_sdk_quota_error_maps_to_quota_exhausted_after_one_attempt():
    client, models = fake_gemini(daily_limits={"generation": 10})
    models.generate_errors = [quota_error()]
    with pytest.raises(LLMQuotaExhaustedError):
        await client.generate_json(system="s", prompt="p", schema=Out)
    assert len(models.generate_calls) == 1
    assert client.guard.used("generation") == 1  # attempts count toward local caps


def test_missing_api_key_is_reported_without_network():
    client = GeminiClient(Settings(_env_file=None, gemini_api_key=None))
    assert not client.configured
    with pytest.raises(LLMNotConfiguredError):
        client._sdk()


async def test_provider_failures_are_logged_safely_once_per_attempt(caplog):
    client, models = fake_gemini(
        Settings(_env_file=None, database_url=None, gemini_api_key=None, gemini_max_retries=0)
    )
    models.generate_errors = [api_error(503, "UNAVAILABLE")]
    with caplog.at_level("WARNING", logger="app.llm.client"), pytest.raises(LLMUnavailableError):
        await client.generate_json(
            system="s", prompt="I got married; secret-prompt-text", schema=Out
        )
    [line] = [r.getMessage() for r in caplog.records]
    assert "http_status=503 provider_status=UNAVAILABLE" in line
    assert "operation=generation" in line and "model=gemini-3.6-flash" in line
    assert "attempt=1/1" in line
    assert "secret-prompt-text" not in line and "married" not in line  # no prompt / message

    caplog.clear()

    async def timeout():
        raise httpx.ConnectTimeout("details with user text")

    with caplog.at_level("WARNING", logger="app.llm.client"), pytest.raises(LLMUnavailableError):
        await with_retries(timeout, RetryPolicy(0, 0, 0), label="operation=embedding")
    [line] = [r.getMessage() for r in caplog.records]
    assert "error=ConnectTimeout" in line and "kind=transient" in line
    assert "details with user text" not in line
