"""Retrieval chunks of official source text, with pgvector embeddings."""

from datetime import datetime

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.source import SourceDocument

# Size of the vector column. Settings.embedding_dim must match; changing it needs a migration
# and re-embedding. 768 is a recommended gemini-embedding-2 output size (128-3072 supported).
EMBEDDING_COLUMN_DIM = 768

# pgvector on PostgreSQL; JSON elsewhere (SQLite in tests).
EmbeddingType = Vector(EMBEDDING_COLUMN_DIM).with_variant(sa.JSON(), "sqlite")


class SourceChunk(TimestampMixin, Base):
    __tablename__ = "source_chunks"
    __table_args__ = (
        sa.UniqueConstraint("source_document_id", "content_hash"),
        sa.Index(
            "ix_source_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_document_id: Mapped[int] = mapped_column(
        sa.ForeignKey("source_documents.id", ondelete="CASCADE"), index=True
    )
    chunk_index: Mapped[int]
    content: Mapped[str] = mapped_column(sa.Text)
    content_hash: Mapped[str] = mapped_column(sa.String(64))
    char_start: Mapped[int]
    char_end: Mapped[int]
    page_start: Mapped[int | None]
    page_end: Mapped[int | None]
    section: Mapped[str | None] = mapped_column(sa.String(300))
    language: Mapped[str] = mapped_column(sa.String(8))

    embedding: Mapped[list[float] | None] = mapped_column(EmbeddingType)
    embedding_model: Mapped[str | None] = mapped_column(sa.String(100))
    embedding_dim: Mapped[int | None]
    embedded_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    source: Mapped[SourceDocument] = relationship()
