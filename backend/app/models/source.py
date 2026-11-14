"""Official source documents and the evidence excerpts taken from them."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, JSONType, TimestampMixin, enum_column
from app.models.enums import SourceType, VerificationStatus


class SourceDocument(TimestampMixin, Base):
    __tablename__ = "source_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(sa.String(2000), unique=True)
    title: Mapped[str | None] = mapped_column(sa.String(500))
    authority: Mapped[str | None] = mapped_column(sa.String(200))
    source_type: Mapped[SourceType] = mapped_column(enum_column(SourceType, "source_type"))

    # Extracted content (populated by the ingestion pipeline)
    content_text: Mapped[str | None] = mapped_column(sa.Text)
    content_hash: Mapped[str | None] = mapped_column(sa.String(64), index=True)
    previous_content_hash: Mapped[str | None] = mapped_column(sa.String(64))
    extracted_metadata: Mapped[dict | None] = mapped_column(JSONType)
    http_status: Mapped[int | None]
    last_error: Mapped[str | None] = mapped_column(sa.String(500))

    first_retrieved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    retrieved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    last_changed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    verification_status: Mapped[VerificationStatus] = mapped_column(
        enum_column(VerificationStatus, "source_verification_status"),
        default=VerificationStatus.UNVERIFIED,
        server_default=VerificationStatus.UNVERIFIED.value,
    )
    verified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    parent_source_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("source_documents.id", ondelete="SET NULL")
    )
    duplicate_of_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("source_documents.id", ondelete="SET NULL")
    )

    evidence: Mapped[list["Evidence"]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )


class Evidence(TimestampMixin, Base):
    """A verbatim excerpt from an official source supporting one or more facts."""

    __tablename__ = "evidence"
    __table_args__ = (sa.UniqueConstraint("source_document_id", "excerpt_hash"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(sa.String(120), unique=True)  # stable curation key
    source_document_id: Mapped[int] = mapped_column(
        sa.ForeignKey("source_documents.id", ondelete="CASCADE"), index=True
    )
    excerpt: Mapped[str] = mapped_column(sa.Text)
    excerpt_hash: Mapped[str] = mapped_column(sa.String(64))
    locator: Mapped[str | None] = mapped_column(sa.String(300))  # e.g. "List IV, Sl. No. 20"
    note: Mapped[str | None] = mapped_column(sa.Text)

    verification_status: Mapped[VerificationStatus] = mapped_column(
        enum_column(VerificationStatus, "evidence_verification_status"),
        default=VerificationStatus.UNVERIFIED,
        server_default=VerificationStatus.UNVERIFIED.value,
    )
    verified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    verified_by: Mapped[str | None] = mapped_column(sa.String(100))
    # Result of the last automated check that the excerpt still appears in the source text.
    excerpt_found_in_source: Mapped[bool | None]
    excerpt_checked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    source: Mapped[SourceDocument] = relationship(back_populates="evidence")
