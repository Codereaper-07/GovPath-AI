from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.routes import (
    account,
    assistant,
    documents,
    health,
    internal,
    profile,
    services,
    situation,
    workflows,
)
from app.auth import build_token_verifier
from app.config import get_settings
from app.db import dispose_engine
from app.knowledge.cache import TTLCache
from app.llm.client import GeminiClient, UsageGuard
from app.llm.situation import SituationInterpreter
from app.rag.assistant import Assistant
from app.ratelimit import SlidingWindowLimiter


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)
    app.state.knowledge_cache = TTLCache(settings.knowledge_cache_seconds)
    app.state.rate_limiter = SlidingWindowLimiter()  # public AI endpoints, per client IP
    # Gemini is only contacted on an explicit assistant request (never at startup).
    guard = UsageGuard(
        min_interval=settings.gemini_min_interval_seconds,
        daily_limits={
            "generation": settings.gemini_daily_generation_limit,
            "query_embedding": settings.gemini_daily_embedding_limit,
        },
    )
    gemini = GeminiClient(settings, guard=guard)  # one client: shared caps and throttle
    app.state.assistant = Assistant(settings, gemini)
    app.state.situation_interpreter = SituationInterpreter(gemini)
    # Supabase Auth token verification (signing keys fetched lazily on the first request).
    app.state.token_verifier = build_token_verifier(settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    routers = (
        health.router,
        services.router,
        documents.router,
        workflows.router,
        situation.router,
        assistant.router,
        profile.router,
        account.router,
        internal.router,
    )
    for router in routers:
        app.include_router(router, prefix="/api")
    return app


app = create_app()
