"""Per-client-IP rate limiting of the public AI endpoints (no Gemini: fakes count model calls)."""

import pytest
from starlette.requests import Request

from app.api.routes.assistant import get_assistant
from app.api.routes.situation import get_interpreter
from app.config import Settings, get_settings
from app.llm.situation import SituationExtraction, SituationInterpreter
from app.rag.assistant import AssistantNotReadyError
from app.ratelimit import SlidingWindowLimiter, client_ip
from tests.test_situation import FakeClient

SITUATION = "/api/situation/interpret"
ASSISTANT = "/api/assistant/query"


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def settings(**kw) -> Settings:
    return Settings(_env_file=None, database_url=None, gemini_api_key=None, **kw)


# ---------------------------------------------------------------- limiter


def test_minute_window_blocks_then_slides():
    clock = Clock()
    lim = SlidingWindowLimiter(clock)
    limits = [(2, 60.0), (100, 86_400.0)]
    assert lim.hit("s", "a", limits) is None
    clock.now += 10
    assert lim.hit("s", "a", limits) is None
    clock.now += 10
    assert lim.hit("s", "a", limits) == pytest.approx(40.0)  # first hit leaves the window at +60
    clock.now += 40
    assert lim.hit("s", "a", limits) is None


def test_rejected_requests_are_not_counted():
    clock = Clock()
    lim = SlidingWindowLimiter(clock)
    limits = [(1, 60.0)]
    assert lim.hit("s", "a", limits) is None
    for _ in range(5):
        clock.now += 5
        assert lim.hit("s", "a", limits) is not None
    clock.now = 1060.0  # 60 s after the only accepted request
    assert lim.hit("s", "a", limits) is None


def test_daily_window_and_retry_after():
    clock = Clock()
    lim = SlidingWindowLimiter(clock)
    limits = [(10, 60.0), (3, 86_400.0)]
    for _ in range(3):
        assert lim.hit("s", "a", limits) is None
        clock.now += 120
    assert lim.hit("s", "a", limits) == pytest.approx(86_400 - 360)


def test_buckets_are_per_scope_and_per_client():
    lim = SlidingWindowLimiter(Clock())
    limits = [(1, 60.0)]
    assert lim.hit("situation", "a", limits) is None
    assert lim.hit("situation", "a", limits) is not None
    assert lim.hit("assistant", "a", limits) is None
    assert lim.hit("situation", "b", limits) is None


def test_memory_is_bounded_by_dropping_the_least_recent_client():
    lim = SlidingWindowLimiter(Clock(), max_clients=2)
    limits = [(1, 60.0)]
    for ip in ("a", "b", "c"):
        assert lim.hit("s", ip, limits) is None
    assert lim.hit("s", "a", limits) is None  # "a" was evicted, so it starts afresh
    assert lim.hit("s", "c", limits) is not None


# ---------------------------------------------------------------- client IP


def _request(peer: str, xff: list[str] | None = None) -> Request:
    headers = [(b"x-forwarded-for", v.encode()) for v in (xff or [])]
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


def test_forwarded_header_is_ignored_without_trusted_proxies():
    assert client_ip(_request("10.0.0.1", ["1.2.3.4"]), 0) == "10.0.0.1"


def test_only_the_entry_added_by_the_trusted_proxy_is_used():
    # The client forged "6.6.6.6"; the proxy appended the real address on the right.
    assert client_ip(_request("10.0.0.1", ["6.6.6.6, 203.0.113.7"]), 1) == "203.0.113.7"
    assert client_ip(_request("10.0.0.1", ["6.6.6.6", "203.0.113.7"]), 1) == "203.0.113.7"
    assert client_ip(_request("10.0.0.1", ["6.6.6.6, 203.0.113.7, 10.9.9.9"]), 2) == "203.0.113.7"


def test_missing_short_or_invalid_chain_falls_back_to_the_peer():
    assert client_ip(_request("10.0.0.1"), 1) == "10.0.0.1"
    assert client_ip(_request("10.0.0.1", ["203.0.113.7"]), 2) == "10.0.0.1"
    assert client_ip(_request("10.0.0.1", ["not-an-ip"]), 1) == "10.0.0.1"


# ---------------------------------------------------------------- endpoints


@pytest.fixture
def fake_models(api_client):
    situation = FakeClient(SituationExtraction(goals=["update-address"], state="Maharashtra"))
    api_client.app.dependency_overrides[get_interpreter] = lambda: SituationInterpreter(situation)

    class FakeAssistant:
        calls = 0

        async def answer(self, *a, **kw):
            FakeAssistant.calls += 1
            raise AssistantNotReadyError("no index")  # 503: proves the handler ran

    api_client.app.dependency_overrides[get_assistant] = lambda: FakeAssistant()
    return situation, FakeAssistant


def test_situation_limit_returns_429_before_the_model_is_called(api_client, fake_models):
    situation, _ = fake_models
    body = {"text": "I moved to Pune", "language": "en"}
    for _ in range(5):  # default: 5 per minute
        assert api_client.post(SITUATION, json=body).status_code == 200
    r = api_client.post(SITUATION, json=body)
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "rate_limited"
    assert 1 <= int(r.headers["Retry-After"]) <= 60
    assert len(situation.calls) == 5  # the rejected request never reached the model


def test_assistant_has_its_own_bucket_and_other_endpoints_are_unaffected(api_client, fake_models):
    situation, assistant = fake_models
    api_client.app.dependency_overrides[get_settings] = lambda: settings(rate_limit_ai_per_minute=2)
    for _ in range(2):
        assert api_client.post(SITUATION, json={"text": "I moved"}).status_code == 200
    assert api_client.post(SITUATION, json={"text": "I moved"}).status_code == 429
    q = {"question": "Passport proof of address?"}
    assert [api_client.post(ASSISTANT, json=q).status_code for _ in range(3)] == [503, 503, 429]
    assert assistant.calls == 2
    for _ in range(5):
        assert api_client.get("/api/services").status_code == 200
        r = api_client.post("/api/workflows/plan", json={"target_service_ids": ["instant-e-pan"]})
        assert r.status_code == 200


def test_daily_limit(api_client, fake_models):
    api_client.app.dependency_overrides[get_settings] = lambda: settings(
        rate_limit_ai_per_minute=10, rate_limit_ai_per_day=3
    )
    codes = [api_client.post(SITUATION, json={"text": "I moved"}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


def test_forged_forwarded_header_cannot_reset_the_bucket(api_client, fake_models):
    api_client.app.dependency_overrides[get_settings] = lambda: settings(rate_limit_ai_per_minute=1)
    assert api_client.post(SITUATION, json={"text": "I moved"}).status_code == 200
    r = api_client.post(SITUATION, json={"text": "I moved"}, headers={"X-Forwarded-For": "9.9.9.9"})
    assert r.status_code == 429


def test_behind_a_trusted_proxy_each_client_gets_its_own_bucket(api_client, fake_models):
    api_client.app.dependency_overrides[get_settings] = lambda: settings(
        rate_limit_ai_per_minute=1, rate_limit_trusted_proxy_hops=1
    )

    def post(chain):
        return api_client.post(
            SITUATION, json={"text": "I moved"}, headers={"X-Forwarded-For": chain}
        )

    assert post("203.0.113.7").status_code == 200
    assert post("203.0.113.8").status_code == 200
    assert post("203.0.113.7").status_code == 429
    assert post("1.1.1.1, 203.0.113.7").status_code == 429  # forged prefix ignored


def test_limits_can_be_disabled(api_client, fake_models):
    api_client.app.dependency_overrides[get_settings] = lambda: settings(
        rate_limit_enabled=False, rate_limit_ai_per_minute=1
    )
    assert all(
        api_client.post(SITUATION, json={"text": "I moved"}).status_code == 200 for _ in range(3)
    )


def test_limits_must_be_positive():
    with pytest.raises(ValueError):
        settings(rate_limit_ai_per_minute=0)
    with pytest.raises(ValueError):
        settings(rate_limit_trusted_proxy_hops=-1)
