from app.knowledge.cache import TTLCache


async def test_cache_reuses_value_within_ttl_and_can_be_disabled():
    calls = []

    async def load():
        calls.append(1)
        return len(calls)

    cache = TTLCache(60)
    assert await cache.get_or_load("k", load) == 1
    assert await cache.get_or_load("k", load) == 1
    cache.clear()
    assert await cache.get_or_load("k", load) == 2

    disabled = TTLCache(0)
    assert await disabled.get_or_load("k", load) == 3
    assert await disabled.get_or_load("k", load) == 4


def test_api_serves_repeated_reads_from_cache(api_client):
    first = api_client.get("/api/services").json()
    cache = api_client.app.state.knowledge_cache
    assert "services" in cache._values
    assert api_client.get("/api/services").json() == first
