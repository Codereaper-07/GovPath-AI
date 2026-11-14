"""Runs the ingestion stages for allowlisted sources: fetch, extract, assess, persist."""

from dataclasses import dataclass, field

from app.ingestion.allowlist import Allowlist, SourceConfig
from app.ingestion.extract import ExtractedContent, ExtractionError, extract
from app.ingestion.fetcher import Fetcher, FetchError
from app.ingestion.persistence import SourceStore
from app.ingestion.verification import Assessment, IngestOutcome, assess


@dataclass
class SourceResult:
    url: str
    outcome: IngestOutcome
    title: str | None = None
    source_type: str | None = None
    content_hash: str | None = None
    chars: int = 0
    error: str | None = None
    verification_status: str | None = None
    evidence_checked: int = 0
    evidence_missing: int = 0
    parent_url: str | None = None


@dataclass
class IngestionReport:
    results: list[SourceResult] = field(default_factory=list)

    def count(self, outcome: IngestOutcome) -> int:
        return sum(1 for r in self.results if r.outcome is outcome)

    @property
    def summary(self) -> dict[str, int]:
        return {o.value: self.count(o) for o in IngestOutcome if self.count(o)}


class IngestionPipeline:
    def __init__(self, allowlist: Allowlist, fetcher: Fetcher, store: SourceStore | None):
        """`store=None` runs a dry run: fetch + extract only, nothing persisted."""
        self.allowlist = allowlist
        self.fetcher = fetcher
        self.store = store

    async def run(self, sources: list[SourceConfig] | None = None) -> IngestionReport:
        report = IngestionReport()
        configs = list(sources if sources is not None else self.allowlist.sources)
        # Configured sources are fetched in their own right, never again as linked PDFs.
        seen: set[str] = {cfg.url for cfg in configs}
        for cfg in configs:
            result, extracted = await self.ingest_url(cfg.url, cfg.authority)
            report.results.append(result)
            if extracted is None or not cfg.follow_pdfs:
                continue
            followed = 0
            for link in extracted.pdf_links:
                if followed >= cfg.max_linked_pdfs:
                    break
                if link in seen or not self.allowlist.is_allowed(link):
                    continue
                seen.add(link)
                followed += 1
                child, _ = await self.ingest_url(link, cfg.authority, parent_url=cfg.url)
                report.results.append(child)
        return report

    async def ingest_url(
        self, url: str, authority: str, parent_url: str | None = None
    ) -> tuple[SourceResult, ExtractedContent | None]:
        try:
            fetched = await self.fetcher.fetch(url)
            extracted = extract(fetched.content, fetched.content_type, fetched.final_url)
        except (FetchError, ExtractionError) as exc:
            message = f"{type(exc).__name__}: {exc}"
            if self.store is not None:
                await self.store.record_failure(url, message)
            return SourceResult(
                url, IngestOutcome.FAILED, error=message, parent_url=parent_url
            ), None

        result = SourceResult(
            url=url,
            outcome=IngestOutcome.DRY_RUN,
            title=extracted.title,
            source_type=extracted.source_type.value,
            content_hash=extracted.content_hash,
            chars=len(extracted.text),
            parent_url=parent_url,
        )
        if self.store is None:
            return result, extracted

        existing = await self.store.existing(url)
        duplicate = await self.store.find_duplicate(extracted.content_hash, exclude_url=url)
        assessment: Assessment = assess(existing, extracted.content_hash, duplicate is not None)
        stored = await self.store.save(
            url,
            authority,
            extracted,
            assessment,
            http_status=fetched.status_code,
            fetched_at=fetched.fetched_at,
            duplicate_of_id=duplicate.id if duplicate else None,
            parent_url=parent_url,
        )
        result.outcome = stored.outcome
        result.verification_status = stored.verification_status.value
        result.evidence_checked = stored.evidence_checked
        result.evidence_missing = stored.evidence_missing
        return result, extracted
