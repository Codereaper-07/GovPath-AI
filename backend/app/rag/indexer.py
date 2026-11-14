"""Incremental, idempotent chunking + embedding of already-ingested official sources.

- `sync_chunks` re-chunks stored source text (no website fetching). Chunks are keyed by
  (source, content hash): unchanged chunks are kept with their embeddings, new ones inserted,
  vanished ones deleted.
- `embed_pending` embeds only chunks with no embedding, or one made by a different model or
  dimension. Batched; each batch is committed so progress survives quota exhaustion.
Never runs automatically: only `python -m scripts.embed` calls it.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.llm.client import GeminiClient, LLMQuotaExhaustedError, LLMRateLimitedError
from app.models import SourceChunk, SourceDocument
from app.models.chunk import EMBEDDING_COLUMN_DIM
from app.rag.chunking import chunk_text
from app.rag.embeddings import format_document


class EmbeddingConfigError(RuntimeError):
    pass


def check_embedding_config(settings: Settings) -> None:
    if settings.embedding_dim != EMBEDDING_COLUMN_DIM:
        raise EmbeddingConfigError(
            f"EMBEDDING_DIM={settings.embedding_dim} does not match the vector column "
            f"({EMBEDDING_COLUMN_DIM}). Add a migration for the new size, then re-embed."
        )


@dataclass
class SyncStats:
    sources: int = 0
    created: int = 0
    kept: int = 0
    deleted: int = 0


@dataclass
class EmbedStats:
    embedded: int = 0
    already_current: int = 0
    requests: int = 0
    stopped_reason: str | None = None
    errors: list[str] = field(default_factory=list)


def _stale(model: str, dim: int):
    return or_(
        SourceChunk.embedding.is_(None),
        SourceChunk.embedding_model.is_distinct_from(model),
        SourceChunk.embedding_dim.is_distinct_from(dim),
    )


async def sync_chunks(
    session: AsyncSession, settings: Settings, *, source_urls: list[str] | None = None
) -> SyncStats:
    stmt = select(SourceDocument).where(
        SourceDocument.content_text.is_not(None), SourceDocument.duplicate_of_id.is_(None)
    )
    if source_urls:
        stmt = stmt.where(SourceDocument.url.in_(source_urls))
    stats = SyncStats()
    for src in (await session.execute(stmt.order_by(SourceDocument.id))).scalars():
        stats.sources += 1
        meta = src.extracted_metadata or {}
        chunks = chunk_text(
            src.content_text or "",
            headings=meta.get("headings"),
            page_char_counts=meta.get("page_char_counts"),
            target_chars=settings.rag_chunk_chars,
            overlap_chars=settings.rag_chunk_overlap_chars,
        )
        existing = {
            c.content_hash: c
            for c in (
                await session.execute(
                    select(SourceChunk).where(SourceChunk.source_document_id == src.id)
                )
            ).scalars()
        }
        wanted = {c.content_hash for c in chunks}
        for row in existing.values():
            if row.content_hash not in wanted:
                await session.delete(row)
                stats.deleted += 1
        for c in chunks:
            row = existing.get(c.content_hash)
            if row is None:
                row = SourceChunk(source_document_id=src.id, content_hash=c.content_hash)
                session.add(row)
                stats.created += 1
            else:
                stats.kept += 1
            row.chunk_index, row.content = c.index, c.content
            row.char_start, row.char_end = c.char_start, c.char_end
            row.page_start, row.page_end = c.page_start, c.page_end
            row.section, row.language = c.section, c.language
        await session.flush()
    return stats


async def count_pending(session: AsyncSession, settings: Settings) -> tuple[int, int]:
    """(chunks needing embedding, total chunks)."""
    total = (await session.execute(select(func.count()).select_from(SourceChunk))).scalar_one()
    pending = (
        await session.execute(
            select(func.count())
            .select_from(SourceChunk)
            .where(_stale(settings.gemini_embedding_model, settings.embedding_dim))
        )
    ).scalar_one()
    return pending, total


async def embed_pending(
    session: AsyncSession,
    settings: Settings,
    client: GeminiClient,
    *,
    limit: int | None = None,
    batch_size: int | None = None,
) -> EmbedStats:
    check_embedding_config(settings)
    model, dim = settings.gemini_embedding_model, settings.embedding_dim
    batch_size = batch_size or settings.rag_embed_batch_size
    stats = EmbedStats()
    pending, total = await count_pending(session, settings)
    stats.already_current = total - pending
    remaining = pending if limit is None else min(pending, limit)

    while remaining > 0:
        rows = (
            await session.execute(
                select(SourceChunk, SourceDocument.title)
                .join(SourceDocument)
                .where(_stale(model, dim))
                .order_by(SourceChunk.id)
                .limit(min(batch_size, remaining))
            )
        ).all()
        if not rows:
            break
        texts = [
            format_document(c.content, " — ".join(x for x in (title, c.section) if x) or None)
            for c, title in rows
        ]
        try:
            stats.requests += 1
            vectors = await client.embed(texts, purpose="embedding")
        except LLMQuotaExhaustedError:
            stats.stopped_reason = "quota_exhausted"
            break
        except LLMRateLimitedError:
            stats.stopped_reason = "rate_limited"
            break
        now = datetime.now(UTC)
        for (chunk, _), vector in zip(rows, vectors, strict=True):
            chunk.embedding, chunk.embedding_model, chunk.embedding_dim = vector, model, dim
            chunk.embedded_at = now
        await session.commit()  # keep progress even if a later batch fails
        stats.embedded += len(rows)
        remaining -= len(rows)
    return stats


async def indexed_chunk_count(session: AsyncSession, settings: Settings) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(SourceChunk)
            .where(
                SourceChunk.embedding.is_not(None),
                SourceChunk.embedding_model == settings.gemini_embedding_model,
                SourceChunk.embedding_dim == settings.embedding_dim,
            )
        )
    ).scalar_one()
