from collections.abc import AsyncIterator

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.db
import app.llm.client
from app.config import Settings, get_settings
from app.db import get_session
from app.knowledge.seed import apply_seed, load_seed_data
from app.main import create_app
from app.models import Base


@pytest.fixture(autouse=True)
def _never_touch_real_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests must never connect to the database configured in backend/.env (Supabase)."""

    def _refuse(*_a, **_kw):
        raise RuntimeError("tests must not connect to the configured database")

    monkeypatch.setattr(app.db, "build_engine", _refuse)


@pytest.fixture(autouse=True)
def _never_call_real_gemini(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests must never create a real Gemini client (protects the free-tier quota)."""

    def _refuse(*_a, **_kw):
        raise RuntimeError("tests must not call the real Gemini API")

    monkeypatch.setattr(app.llm.client.genai, "Client", _refuse)


@pytest.fixture(autouse=True)
def _never_fetch_real_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests must never fetch signing keys from Supabase (use tests/auth_fakes.py)."""

    def _refuse(*_a, **_kw):
        raise RuntimeError("tests must not contact Supabase Auth")

    monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", _refuse)


@pytest.fixture
def unconfigured_settings() -> Settings:
    # _env_file=None: ignore any local backend/.env so tests never hit real services.
    return Settings(_env_file=None, database_url=None, gemini_api_key=None)


@pytest.fixture
def client(unconfigured_settings: Settings) -> TestClient:
    application = create_app()
    application.dependency_overrides[get_settings] = lambda: unconfigured_settings
    return TestClient(application)


@pytest.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Fresh, isolated in-memory SQLite database per test."""
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def session(session_factory) -> AsyncIterator[AsyncSession]:
    async with session_factory() as s:
        yield s


@pytest.fixture(scope="session")
def seed_data():
    return load_seed_data()


@pytest.fixture
async def seeded_factory(session_factory, seed_data):
    async with session_factory() as s:
        await apply_seed(s, seed_data)
        await s.commit()
    return session_factory


@pytest.fixture
def api_client(seeded_factory, unconfigured_settings) -> TestClient:
    application = create_app()

    async def _session():
        async with seeded_factory() as s:
            yield s

    application.dependency_overrides[get_session] = _session
    application.dependency_overrides[get_settings] = lambda: unconfigured_settings
    return TestClient(application)


RAG_SETTINGS = Settings(
    _env_file=None,
    database_url=None,
    gemini_api_key=None,
    rag_min_similarity=0.3,
    knowledge_cache_seconds=0,
)


@pytest.fixture
async def rag_factory(seeded_factory):
    """Seeded knowledge base whose sources carry text (their evidence excerpts), chunked and
    embedded with the offline keyword embedder."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models import SourceDocument
    from app.rag.indexer import embed_pending, sync_chunks
    from tests.rag_fakes import fake_gemini

    async with seeded_factory() as s:
        sources = (
            await s.execute(select(SourceDocument).options(selectinload(SourceDocument.evidence)))
        ).scalars()
        for src in sources:
            src.content_text = "\n".join(e.excerpt for e in src.evidence)
        await s.flush()
        await sync_chunks(s, RAG_SETTINGS)
        client, _ = fake_gemini(RAG_SETTINGS)
        await embed_pending(s, RAG_SETTINGS, client)
        await s.commit()
    return seeded_factory
