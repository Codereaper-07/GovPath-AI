"""Per-client-IP rate limiting for the public Gemini-backed endpoints.

In memory and per process: limits reset when the process restarts and are NOT shared between
instances or workers. That fits the single-instance deployment (one Render web service, one
worker). It sits in front of the per-process daily Gemini caps (`llm.client.UsageGuard`), which
stay in force: this limiter stops one client from using up the shared daily cap.

Client IP: by default the direct peer address. Behind a reverse proxy, set
RATE_LIMIT_TRUSTED_PROXY_HOPS to the number of proxies that append to X-Forwarded-For. Only the
entry appended by the outermost trusted proxy is used; entries to its left are client-supplied
and never trusted (a client cannot pick its own bucket by sending a forged header).
"""

import ipaddress
import logging
import math
import time
from collections import deque
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

MAX_TRACKED_CLIENTS = 10_000  # bounds memory; the oldest idle clients are dropped first


def client_ip(request: Request, trusted_hops: int) -> str:
    """The client address, honouring X-Forwarded-For only from `trusted_hops` trusted proxies."""
    peer = request.client.host if request.client else "unknown"
    if trusted_hops <= 0:
        return peer
    header = ",".join(request.headers.getlist("x-forwarded-for"))
    hops = [h.strip() for h in header.split(",") if h.strip()]
    if len(hops) < trusted_hops:
        return peer  # not (fully) proxied: never trust a partial chain
    candidate = hops[-trusted_hops]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return peer


class SlidingWindowLimiter:
    """Sliding-window counters keyed by (scope, client). Single event loop, so no locking."""

    def __init__(
        self, clock: Callable[[], float] = time.monotonic, max_clients: int = MAX_TRACKED_CLIENTS
    ):
        self._clock = clock
        self._max_clients = max_clients
        self._hits: dict[tuple[str, str], deque[float]] = {}

    def hit(self, scope: str, client: str, limits: list[tuple[int, float]]) -> float | None:
        """Record a request if every (max_requests, window_seconds) limit allows it.

        Returns None when allowed, else the seconds until the next request would be allowed
        (the rejected request is not recorded)."""
        now = self._clock()
        key = (scope, client)
        hits = self._hits.pop(key, None) or deque()  # re-insert below: dict order = recency
        longest = max((w for _, w in limits), default=0)
        while hits and hits[0] <= now - longest:
            hits.popleft()
        wait = 0.0
        for max_requests, window in limits:
            in_window = [t for t in hits if t > now - window]
            if len(in_window) >= max_requests:
                # allowed again once the oldest request that still counts leaves the window
                wait = max(wait, in_window[-max_requests] + window - now)
        if wait <= 0:
            hits.append(now)
        if hits:
            self._hits[key] = hits
        self._evict()
        return wait if wait > 0 else None

    def _evict(self) -> None:
        while len(self._hits) > self._max_clients:
            del self._hits[next(iter(self._hits))]  # least recently seen client


def get_rate_limiter(request: Request) -> SlidingWindowLimiter:
    return request.app.state.rate_limiter


def limit_ai_requests(scope: str):
    """Dependency for a public AI endpoint: raises 429 (with Retry-After) before the handler runs,
    so Gemini is never called for a rejected request. Each endpoint has its own bucket."""

    async def dependency(
        request: Request,
        settings: Annotated[Settings, Depends(get_settings)],
        limiter: Annotated[SlidingWindowLimiter, Depends(get_rate_limiter)],
    ) -> None:
        if not settings.rate_limit_enabled:
            return
        limits = [
            (settings.rate_limit_ai_per_minute, 60.0),
            (settings.rate_limit_ai_per_day, 86_400.0),
        ]
        ip = client_ip(request, settings.rate_limit_trusted_proxy_hops)
        wait = limiter.hit(scope, ip, limits)
        if wait is not None:
            logger.warning("rate limit reached for %s", scope)  # no client address in logs
            raise HTTPException(
                429,
                {
                    "code": "rate_limited",
                    "message": "Too many requests. Please wait and try again.",
                },
                headers={"Retry-After": str(max(1, math.ceil(wait)))},
            )

    return dependency
