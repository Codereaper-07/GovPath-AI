"""Persistence stage: store extracted source content as SourceDocument rows."""

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ingestion.extract import ExtractedContent
from app.ingestion.verification import (
    Assessment,
    ExistingSource,
    IngestOutcome,
    excerpt_in_text,
)
from app.models import SourceDocument
from app.models.enums import VerificationStatus


@dataclass(frozen=True)
class StoredSource:
    id: int
    outcome: IngestOutcome
    verification_status: VerificationStatus
    evidence_checked: int
    evidence_missing: int


class SourceStore:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, url: str) -> SourceDocument | None:
        stmt = (
            select(SourceDocument)
            .options(selectinload(SourceDocument.evidence))
            .where(SourceDocument.url == url)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def existing(self, url: str) -> ExistingSource | None:
        row = await self.get(url)
        return ExistingSource(row.content_hash, row.verification_status) if row else None

    async def find_duplicate(self, content_hash: str, exclude_url: str) -> SourceDocument | None:
        stmt = select(SourceDocument).where(
            SourceDocument.content_hash == content_hash,
            SourceDocument.url != exclude_url,
            SourceDocument.duplicate_of_id.is_(None),
        )
        return (await self.session.execute(stmt.limit(1))).scalar_one_or_none()

    async def save(
        self,
        url: str,
        authority: str,
        extracted: ExtractedContent,
        assessment: Assessment,
        *,
        http_status: int,
        fetched_at: datetime,
        duplicate_of_id: int | None = None,
        parent_url: str | None = None,
    ) -> StoredSource:
        # Look everything up before adding a new row, so autoflush never sees a partial row.
        parent = await self.get(parent_url) if parent_url else None
        row = await self.get(url)
        is_new = row is None
        if row is None:
            row = SourceDocument(url=url, evidence=[])

        row.authority = row.authority or authority
        row.title = row.title or extracted.title
        row.source_type = extracted.source_type
        row.http_status = http_status
        row.last_error = None
        row.retrieved_at = fetched_at
        row.first_retrieved_at = row.first_retrieved_at or fetched_at
        row.parent_source_id = parent.id if parent else row.parent_source_id
        row.verification_status = assessment.verification_status

        if assessment.outcome is IngestOutcome.DUPLICATE:
            # Same text already stored under another URL: keep a pointer, not a second copy.
            row.duplicate_of_id = duplicate_of_id
            row.content_text = None
            row.content_hash = extracted.content_hash
        elif assessment.outcome is not IngestOutcome.UNCHANGED:
            if assessment.outcome is IngestOutcome.CHANGED:
                row.previous_content_hash = row.content_hash
            row.content_hash = extracted.content_hash
            row.content_text = extracted.text
            row.extracted_metadata = {
                "headings": extracted.headings[:200],
                "links": extracted.links[:500],
                "pdf_links": extracted.pdf_links[:100],
                **extracted.metadata,
            }
            row.last_changed_at = fetched_at
            row.duplicate_of_id = None

        if is_new:
            self.session.add(row)
        checked = missing = 0
        if row.content_text:
            for ev in row.evidence:
                found = excerpt_in_text(ev.excerpt, row.content_text)
                ev.excerpt_found_in_source = found
                ev.excerpt_checked_at = datetime.now(UTC)
                checked += 1
                if not found:
                    missing += 1
                    if ev.verification_status is VerificationStatus.VERIFIED:
                        ev.verification_status = VerificationStatus.NEEDS_REVIEW
                elif assessment.outcome is IngestOutcome.CHANGED and (
                    ev.verification_status is VerificationStatus.VERIFIED
                ):
                    ev.verification_status = VerificationStatus.NEEDS_REVIEW
        await self.session.flush()
        return StoredSource(row.id, assessment.outcome, row.verification_status, checked, missing)

    async def record_failure(self, url: str, error: str) -> None:
        """Remember the failure on an existing row; never create rows for failed fetches."""
        row = await self.get(url)
        if row is not None:
            row.last_error = error[:500]
            await self.session.flush()
