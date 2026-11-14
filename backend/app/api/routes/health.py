import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app import __version__
from app.config import Settings, get_settings
from app.db import get_engine
from app.schemas.health import DbHealthResponse, HealthResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/health", tags=["health"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("", response_model=HealthResponse)
async def health(settings: SettingsDep) -> HealthResponse:
    return HealthResponse(app=settings.app_name, version=__version__)


@router.get("/db", response_model=DbHealthResponse)
async def db_health(settings: SettingsDep) -> DbHealthResponse:
    if not settings.database_configured:
        return DbHealthResponse(
            status="unconfigured", database="postgresql", detail="DATABASE_URL is not set"
        )
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
            has_vector = (
                await conn.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'"))
            ).scalar() is not None
    except Exception as exc:  # report, don't crash; never echo connection strings
        logger.exception("Database health check failed")
        return DbHealthResponse(status="error", database="postgresql", detail=type(exc).__name__)
    return DbHealthResponse(status="ok", database="postgresql", pgvector=has_vector)
