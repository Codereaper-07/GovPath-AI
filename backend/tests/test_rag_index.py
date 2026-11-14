"""Incremental chunking/embedding and vector retrieval (SQLite + fake Gemini)."""

import pytest
from sqlalchemy import func, select

from app.config import Settings
from app.models import Evidence, SourceChunk, SourceDocument
from app.models.enums import SourceType, VerificationStatus
from app.rag.indexer import EmbeddingConfigError, count_pending, embed_pending, sync_chunks
from app.rag.retriever import retrieve
from tests.rag_fakes import fake_gemini, keyword_vector, quota_error

SETTINGS = Settings(
    _env_file=None, gemini_api_key=None, rag_chunk_chars=400, rag_chunk_overlap_chars=0
)

PASSPORT = "\n".join(
    ["Proof of Present Address. For Proof of Address attach one of the following documents:"]
    + [f"{c}. passport reissue proof of address item {i}" for i, c in enumerate("abcdefghijkl")]
    + ["For re-issue of passport, submit old Passport in original."] * 1
)
VOTER = "\n".join(
    ["Form 8 application for shifting of residence by an enrolled elector."]
    + [f"Voter EPIC constituency shifting residence detail {i}" for i in range(12)]
)
RC = (
    "Vehicle registration certificate change of address within 14 days. "
    "Insurance and pollution certificate."
)


async def _sources(session, verified=True):
    status = VerificationStatus.VERIFIED if verified else VerificationStatus.UNVERIFIED
    rows = [
        SourceDocument(
            url="https://passportindia.gov.in/b.pdf",
            title="Passport booklet",
            source_type=SourceType.PDF,
            content_text=PASSPORT,
            verification_status=status,
        ),
        SourceDocument(
            url="https://voters.eci.gov.in/f8.pdf",
            title="Form 8",
            source_type=SourceType.PDF,
            content_text=VOTER,
            verification_status=status,
        ),
        SourceDocument(
            url="https://parivahan.gov.in/rc",
            title="RC",
            source_type=SourceType.WEBPAGE,
            content_text=RC,
            verification_status=VerificationStatus.UNVERIFIED,
        ),
        SourceDocument(
            url="https://parivahan.gov.in/empty", title="Empty", source_type=SourceType.WEBPAGE
        ),
    ]
    session.add_all(rows)
    await session.flush()
    return rows


async def _count(session, *where):
    return (
        await session.execute(select(func.count()).select_from(SourceChunk).where(*where))
    ).scalar_one()


async def test_sync_is_idempotent_and_skips_sources_without_text(session):
    await _sources(session)
    first = await sync_chunks(session, SETTINGS)
    assert first.sources == 3 and first.created > 3 and first.deleted == 0
    second = await sync_chunks(session, SETTINGS)
    assert second.created == 0 and second.kept == first.created
    chunk = (await session.execute(select(SourceChunk).limit(1))).scalar_one()
    assert chunk.content_hash and chunk.language == "en" and chunk.source_document_id


async def test_embedding_is_incremental(session):
    await _sources(session)
    await sync_chunks(session, SETTINGS)
    client, models = fake_gemini(SETTINGS)
    total = await _count(session)

    stats = await embed_pending(session, SETTINGS, client, batch_size=3)
    assert stats.embedded == total and stats.requests == len(models.embed_calls)
    assert max(len(c["contents"]) for c in models.embed_calls) <= 3  # batched
    assert (
        await _count(
            session,
            SourceChunk.embedding_model == "gemini-embedding-2",
            SourceChunk.embedding_dim == 768,
        )
        == total
    )

    again = await embed_pending(session, SETTINGS, client)
    assert again.embedded == 0 and again.requests == 0 and again.already_current == total


async def test_changed_source_re_embeds_only_changed_chunks(session):
    passport, *_ = await _sources(session)
    await sync_chunks(session, SETTINGS)
    client, models = fake_gemini(SETTINGS)
    await embed_pending(session, SETTINGS, client)
    calls_before = len(models.embed_calls)

    passport.content_text = (
        PASSPORT
        + "\nNEW: Furnishing of Aadhaar card will expedite processing of passport applications."
    )
    sync = await sync_chunks(session, SETTINGS)
    assert sync.created >= 1 and sync.kept >= 1
    pending, _ = await count_pending(session, SETTINGS)
    assert pending == sync.created
    stats = await embed_pending(session, SETTINGS, client)
    assert stats.embedded == sync.created and len(models.embed_calls) > calls_before


async def test_model_or_dimension_change_triggers_re_embedding(session):
    await _sources(session)
    await sync_chunks(session, SETTINGS)
    client, _ = fake_gemini(SETTINGS)
    await embed_pending(session, SETTINGS, client)
    other = SETTINGS.model_copy(update={"gemini_embedding_model": "gemini-embedding-future"})
    pending, total = await count_pending(session, other)
    assert pending == total > 0

    bad_dim = SETTINGS.model_copy(update={"embedding_dim": 1536})
    with pytest.raises(EmbeddingConfigError):
        await embed_pending(session, bad_dim, client)


async def test_quota_exhaustion_stops_and_keeps_progress(session):
    await _sources(session)
    await sync_chunks(session, SETTINGS)
    client, models = fake_gemini(SETTINGS)
    original = models.embed_content
    calls = {"n": 0}

    async def flaky(**kw):
        calls["n"] += 1
        if calls["n"] == 2:
            raise quota_error()
        return await original(**kw)

    models.embed_content = flaky
    stats = await embed_pending(session, SETTINGS, client, batch_size=2)
    assert stats.stopped_reason == "quota_exhausted"
    assert stats.embedded == 2 and calls["n"] == 2  # no retry after quota exhaustion
    pending, total = await count_pending(session, SETTINGS)
    assert pending == total - 2


async def _indexed(session, verified=True):
    rows = await _sources(session, verified)
    session.add(
        Evidence(
            key="pp-poa-list",
            source=rows[0],
            excerpt=PASSPORT.split("\n")[0],
            excerpt_hash="h",
            verification_status=VerificationStatus.VERIFIED,
        )
    )
    await sync_chunks(session, SETTINGS)
    client, _ = fake_gemini(SETTINGS)
    await embed_pending(session, SETTINGS, client)
    return rows


def _kw(**overrides):
    base = dict(model="gemini-embedding-2", dim=768, top_k=5, min_similarity=0.3, max_per_source=2)
    return base | overrides


async def test_retrieval_ranks_relevant_chunks_with_source_metadata(session):
    await _indexed(session)
    result = await retrieve(
        session, keyword_vector("What proof of address for passport reissue?"), **_kw()
    )
    top = result.chunks[0]
    assert (
        top.source_url == "https://passportindia.gov.in/b.pdf"
        and top.source_title == "Passport booklet"
    )
    assert top.content in PASSPORT  # exact stored excerpt
    assert "pp-poa-list" in result.chunks[0].evidence_ids or any(
        "pp-poa-list" in c.evidence_ids for c in result.chunks
    )
    assert result.confidence in ("high", "low") and result.best_similarity == top.similarity


async def test_retrieval_caps_results_per_source_and_top_k(session):
    await _indexed(session)
    result = await retrieve(
        session,
        keyword_vector("passport proof of address"),
        **_kw(max_per_source=1, min_similarity=0.0),
    )
    assert len({c.source_id for c in result.chunks}) == len(result.chunks)
    limited = await retrieve(
        session, keyword_vector("passport"), **_kw(top_k=1, min_similarity=0.0)
    )
    assert len(limited.chunks) == 1


async def test_threshold_filters_irrelevant_questions(session):
    await _indexed(session)
    result = await retrieve(
        session, keyword_vector("What is the weather in Mumbai today?"), **_kw(min_similarity=0.5)
    )
    assert result.chunks == [] and result.confidence == "none"


async def test_unverified_sources_excluded_by_default(session):
    await _indexed(session)
    rc_query = keyword_vector("vehicle registration certificate insurance pollution")
    verified = await retrieve(session, rc_query, **_kw(min_similarity=0.0))
    assert all(c.source_verified for c in verified.chunks)
    everything = await retrieve(session, rc_query, **_kw(min_similarity=0.0, verified_only=False))
    assert any(c.source_url.endswith("/rc") for c in everything.chunks)


async def test_retrieval_ignores_other_models_and_empty_index(session):
    assert (await retrieve(session, keyword_vector("passport"), **_kw())).chunks == []
    await _indexed(session)
    other = await retrieve(session, keyword_vector("passport"), **_kw(model="another-model"))
    assert other.chunks == []
