"""Assessment / verification stage: change + duplicate detection and evidence checks.

Pure functions (no I/O). Scraped content never becomes verified knowledge here; this stage
only decides outcomes and downgrades verification status when sources change.
"""

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from enum import StrEnum

from app.models.enums import VerificationStatus

_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-"})


class IngestOutcome(StrEnum):
    NEW = "new"  # first time this URL was fetched
    UNCHANGED = "unchanged"  # same content hash as last fetch
    CHANGED = "changed"  # content hash differs from last fetch
    DUPLICATE = "duplicate"  # identical content already stored under another URL
    FAILED = "failed"  # fetch or extraction failed
    DRY_RUN = "dry_run"  # extracted but not persisted


@dataclass(frozen=True)
class ExistingSource:
    content_hash: str | None
    verification_status: VerificationStatus


@dataclass(frozen=True)
class Assessment:
    outcome: IngestOutcome
    verification_status: VerificationStatus


def assess(
    existing: ExistingSource | None, new_hash: str, duplicate_of_other_url: bool
) -> Assessment:
    if existing is None or existing.content_hash is None:
        # Never fetched before (or only curated so far): keep any curated status.
        status = existing.verification_status if existing else VerificationStatus.UNVERIFIED
        outcome = IngestOutcome.DUPLICATE if duplicate_of_other_url else IngestOutcome.NEW
        return Assessment(outcome, status)
    if existing.content_hash == new_hash:
        return Assessment(IngestOutcome.UNCHANGED, existing.verification_status)
    # Content changed: anything previously verified must be re-reviewed by a human.
    status = (
        VerificationStatus.NEEDS_REVIEW
        if existing.verification_status
        in (VerificationStatus.VERIFIED, VerificationStatus.NEEDS_REVIEW)
        else existing.verification_status
    )
    return Assessment(IngestOutcome.CHANGED, status)


def normalize_for_match(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_QUOTES)
    return re.sub(r"\s+", " ", text).strip().casefold()


def excerpt_in_text(excerpt: str, text: str) -> bool:
    """Whitespace-, case- and quote-insensitive containment check."""
    needle = normalize_for_match(excerpt)
    return bool(needle) and needle in normalize_for_match(text)


def excerpt_hash(excerpt: str) -> str:
    return hashlib.sha256(normalize_for_match(excerpt).encode("utf-8")).hexdigest()
