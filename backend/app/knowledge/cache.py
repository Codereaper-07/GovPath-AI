"""Small in-process TTL cache for read-only knowledge (services, documents, planning snapshot).

Knowledge only changes when the curated seed runs, while each uncached read costs several
database round-trips. One cache lives on each FastAPI app instance (``app.state``), so tests
stay isolated. ``ttl_seconds <= 0`` disables caching.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request


class TTLCache:
    def __init__(self, ttl_seconds: float):
        self.ttl = ttl_seconds
        self._values: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def get_or_load[T](self, key: str, loader: Callable[[], Awaitable[T]]) -> T:
        if self.ttl <= 0:
            return await loader()
        hit = self._values.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:  # one loader per key at a time
            hit = self._values.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1]
            value = await loader()
            self._values[key] = (time.monotonic() + self.ttl, value)
            return value

    def has(self, key: str) -> bool:
        """True if a fresh value is cached (never true when caching is disabled)."""
        hit = self._values.get(key)
        return self.ttl > 0 and hit is not None and hit[0] > time.monotonic()

    def clear(self) -> None:
        self._values.clear()


def get_knowledge_cache(request: Request) -> TTLCache:
    return request.app.state.knowledge_cache
