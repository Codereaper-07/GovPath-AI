"""Semantic retrieval over embedded chunks (pgvector cosine distance). No generation here."""

import math
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.ingestion.verification import excerpt_in_text
from app.models import Evidence, SourceChunk, SourceDocument
from app.models.enums import VerificationStatus


@dataclass(frozen=True)
class RetrievedChunk:
    chunk_id: int
    content_hash: str
    content: str  # exact stored excerpt of the official source
    similarity: float
    source_id: int
    source_url: str
    source_title: str | None
    source_authority: str | None
    source_verified: bool
    page_start: int | None
    page_end: int | None
    section: str | None
    evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class RetrievalResult:
    chunks: list[RetrievedChunk] = field(default_factory=list)
    best_similarity: float | None = None
    confidence: str = "none"  # none | low | high


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


async def retrieve(
    session: AsyncSession,
    query_vector: list[float],
    *,
    model: str,
    dim: int,
    top_k: int = 5,
    min_similarity: float = 0.5,
    high_confidence: float = 0.65,
    max_per_source: int = 2,
    verified_only: bool = True,
) -> RetrievalResult:
    pool = max(top_k * 4, 20)
    filters = [
        SourceChunk.embedding.is_not(None),
        SourceChunk.embedding_model == model,
        SourceChunk.embedding_dim == dim,
        SourceDocument.duplicate_of_id.is_(None),
    ]
    if verified_only:
        filters.append(SourceDocument.verification_status == VerificationStatus.VERIFIED)
    source_cols = load_only(
        SourceDocument.id,
        SourceDocument.url,
        SourceDocument.title,
        SourceDocument.authority,
        SourceDocument.verification_status,
    )
    base = (
        select(SourceChunk, SourceDocument)
        .join(SourceDocument)
        .options(source_cols)
        .where(*filters)
    )

    if session.bind.dialect.name == "postgresql":
        distance = SourceChunk.embedding.cosine_distance(query_vector)
        rows = (
            await session.execute(base.add_columns(distance).order_by(distance).limit(pool))
        ).all()
        scored = [(c, s, 1.0 - float(d)) for c, s, d in rows]
    else:  # portable fallback (tests): same scoring in Python
        rows = (await session.execute(base)).all()
        scored = sorted(
            ((c, s, _cosine(query_vector, c.embedding)) for c, s in rows),
            key=lambda x: -x[2],
        )[:pool]

    best = scored[0][2] if scored else None
    picked, per_source = [], {}
    for chunk, src, sim in scored:
        if sim < min_similarity:
            break
        if per_source.get(src.id, 0) >= max_per_source:
            continue
        per_source[src.id] = per_source.get(src.id, 0) + 1
        picked.append((chunk, src, sim))
        if len(picked) >= top_k:
            break

    evidence = await _evidence_by_source(session, {s.id for _, s, _ in picked})
    chunks = [
        RetrievedChunk(
            chunk_id=c.id,
            content_hash=c.content_hash,
            content=c.content,
            similarity=round(sim, 4),
            source_id=s.id,
            source_url=s.url,
            source_title=s.title,
            source_authority=s.authority,
            source_verified=s.verification_status is VerificationStatus.VERIFIED,
            page_start=c.page_start,
            page_end=c.page_end,
            section=c.section,
            evidence_ids=tuple(
                e.key for e in evidence.get(s.id, []) if excerpt_in_text(e.excerpt, c.content)
            ),
        )
        for c, s, sim in picked
    ]
    if not chunks:
        confidence = "none"
    elif chunks[0].similarity >= high_confidence:
        confidence = "high"
    else:
        confidence = "low"
    return RetrievalResult(chunks, round(best, 4) if best is not None else None, confidence)


async def _evidence_by_source(
    session: AsyncSession, source_ids: set[int]
) -> dict[int, list[Evidence]]:
    if not source_ids:
        return {}
    rows = await session.execute(
        select(Evidence).where(
            Evidence.source_document_id.in_(source_ids),
            Evidence.verification_status == VerificationStatus.VERIFIED,
        )
    )
    out: dict[int, list[Evidence]] = {}
    for e in rows.scalars():
        out.setdefault(e.source_document_id, []).append(e)
    return out
