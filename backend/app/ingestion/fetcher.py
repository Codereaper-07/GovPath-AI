"""Fetch stage: polite, allowlist- and robots.txt-aware HTTP fetching with httpx."""

import asyncio
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from app.ingestion.allowlist import normalize_url

USER_AGENT = "GovPathAI-Ingest/0.1 (official-source evidence collection; respects robots.txt)"
DEFAULT_TIMEOUT = httpx.Timeout(20.0, connect=10.0)
DEFAULT_MAX_BYTES = 15 * 1024 * 1024
MAX_REDIRECTS = 5


class FetchErrorKind(StrEnum):
    NOT_ALLOWLISTED = "not_allowlisted"
    ROBOTS_DISALLOWED = "robots_disallowed"
    TIMEOUT = "timeout"
    HTTP_ERROR = "http_error"
    NETWORK_ERROR = "network_error"
    TOO_LARGE = "too_large"
    TOO_MANY_REDIRECTS = "too_many_redirects"


class FetchError(Exception):
    def __init__(
        self, kind: FetchErrorKind, url: str, message: str, status_code: int | None = None
    ):
        super().__init__(f"{kind}: {message} ({url})")
        self.kind = kind
        self.url = url
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class FetchResult:
    requested_url: str
    final_url: str
    status_code: int
    content_type: str
    content: bytes
    fetched_at: datetime


class RobotsPolicy:
    """Caches one robots.txt per origin.

    Per RFC 9309: 4xx -> no restrictions; 5xx or unreachable -> treat as fully disallowed.
    A robots.txt served as HTML (SPA fallback) contains no rules and therefore allows all.
    """

    def __init__(self, client: httpx.AsyncClient, user_agent: str = USER_AGENT):
        self._client = client
        self._ua = user_agent
        self._cache: dict[str, RobotFileParser | bool] = {}

    async def can_fetch(self, url: str) -> bool:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._cache:
            self._cache[origin] = await self._load(origin)
        policy = self._cache[origin]
        if isinstance(policy, bool):
            return policy
        return policy.can_fetch(self._ua, url)

    async def _load(self, origin: str) -> RobotFileParser | bool:
        try:
            res = await self._client.get(f"{origin}/robots.txt", follow_redirects=True)
        except httpx.HTTPError:
            return False
        if 400 <= res.status_code < 500:
            return True
        if res.status_code >= 500:
            return False
        parser = RobotFileParser()
        parser.parse(res.text.splitlines())
        return parser


class Fetcher:
    def __init__(
        self,
        client: httpx.AsyncClient,
        is_allowed,
        *,
        respect_robots: bool = True,
        max_bytes: int = DEFAULT_MAX_BYTES,
        min_delay_seconds: float = 1.0,
    ):
        self._client = client
        self._is_allowed = is_allowed
        self._robots = RobotsPolicy(client) if respect_robots else None
        self._max_bytes = max_bytes
        self._min_delay = min_delay_seconds
        self._last_request: dict[str, float] = {}

    @staticmethod
    def create_client() -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=DEFAULT_TIMEOUT,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.5",
            },
            follow_redirects=False,
        )

    async def fetch(self, url: str) -> FetchResult:
        requested = normalize_url(url)
        current = requested
        for _ in range(MAX_REDIRECTS + 1):
            await self._check_permitted(current)
            await self._politeness_wait(current)
            res = await self._get(current)
            if res.is_redirect and res.headers.get("location"):
                current = normalize_url(urljoin(current, res.headers["location"]))
                continue
            if res.status_code >= 400:
                raise FetchError(
                    FetchErrorKind.HTTP_ERROR, current, f"HTTP {res.status_code}", res.status_code
                )
            return FetchResult(
                requested_url=requested,
                final_url=current,
                status_code=res.status_code,
                content_type=res.headers.get("content-type", "").split(";")[0].strip().lower(),
                content=res.content,
                fetched_at=datetime.now(UTC),
            )
        raise FetchError(FetchErrorKind.TOO_MANY_REDIRECTS, requested, "redirect limit exceeded")

    async def _check_permitted(self, url: str) -> None:
        if not self._is_allowed(url):
            raise FetchError(FetchErrorKind.NOT_ALLOWLISTED, url, "URL is not on the allowlist")
        if self._robots is not None and not await self._robots.can_fetch(url):
            raise FetchError(FetchErrorKind.ROBOTS_DISALLOWED, url, "disallowed by robots.txt")

    async def _politeness_wait(self, url: str) -> None:
        host = urlsplit(url).netloc
        last = self._last_request.get(host)
        if last is not None and self._min_delay > 0:
            wait = self._min_delay - (time.monotonic() - last)
            if wait > 0:
                await asyncio.sleep(wait)
        self._last_request[host] = time.monotonic()

    async def _get(self, url: str) -> httpx.Response:
        try:
            return await self._get_once(url, headers=None)
        except httpx.DecodingError:
            # Some government servers send malformed gzip; retry uncompressed once.
            try:
                return await self._get_once(url, headers={"Accept-Encoding": "identity"})
            except httpx.DecodingError as exc:
                raise FetchError(FetchErrorKind.NETWORK_ERROR, url, "undecodable response") from exc

    async def _get_once(self, url: str, headers: dict[str, str] | None) -> httpx.Response:
        try:
            async with self._client.stream("GET", url, headers=headers) as res:
                declared = res.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > self._max_bytes:
                    raise FetchError(FetchErrorKind.TOO_LARGE, url, f"{declared} bytes")
                body = bytearray()
                async for chunk in res.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > self._max_bytes:
                        raise FetchError(FetchErrorKind.TOO_LARGE, url, "body exceeds limit")
                return httpx.Response(
                    res.status_code, headers=res.headers, content=bytes(body), request=res.request
                )
        except httpx.TimeoutException as exc:
            raise FetchError(FetchErrorKind.TIMEOUT, url, type(exc).__name__) from exc
        except httpx.DecodingError:
            raise
        except httpx.HTTPError as exc:
            raise FetchError(FetchErrorKind.NETWORK_ERROR, url, type(exc).__name__) from exc
