"""Allowlist of official government domains and the source URLs to ingest."""

import json
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urldefrag, urlsplit

DEFAULT_ALLOWLIST_PATH = Path(__file__).resolve().parents[3] / "data" / "sources" / "allowlist.json"


class AllowlistError(ValueError):
    pass


@dataclass(frozen=True)
class SourceConfig:
    url: str
    authority: str
    title: str | None = None
    follow_pdfs: bool = False
    max_linked_pdfs: int = 0


@dataclass(frozen=True)
class Allowlist:
    domains: tuple[str, ...]
    sources: tuple[SourceConfig, ...] = field(default_factory=tuple)

    def is_allowed(self, url: str) -> bool:
        return is_url_allowed(url, self.domains)


def normalize_url(url: str) -> str:
    """Strip the fragment and surrounding whitespace; keep the query string."""
    return urldefrag(url.strip())[0]


def is_url_allowed(url: str, domains: tuple[str, ...] | list[str]) -> bool:
    """HTTPS only, and host must equal an allowlisted domain or be a subdomain of one."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        return False
    host = parts.hostname.lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in (x.lower() for x in domains))


def load_allowlist(path: Path = DEFAULT_ALLOWLIST_PATH) -> Allowlist:
    raw = json.loads(path.read_text(encoding="utf-8"))
    domains = tuple(d.lower().strip() for d in raw.get("allowed_domains", []))
    if not domains:
        raise AllowlistError("allowed_domains must not be empty")
    for d in domains:
        if not d.endswith(".gov.in") and not d.endswith(".nic.in"):
            raise AllowlistError(f"{d!r} is not an official Indian government domain")
    sources = []
    for s in raw.get("sources", []):
        url = normalize_url(s["url"])
        if not is_url_allowed(url, domains):
            raise AllowlistError(f"source URL is not on the allowlist: {url}")
        sources.append(
            SourceConfig(
                url=url,
                authority=s["authority"],
                title=s.get("title"),
                follow_pdfs=bool(s.get("follow_pdfs", False)),
                max_linked_pdfs=int(s.get("max_linked_pdfs", 0)),
            )
        )
    return Allowlist(domains=domains, sources=tuple(sources))
