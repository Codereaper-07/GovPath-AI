"""Scheduler hooks. Not for browsers: protected by a shared secret header (CRON_SECRET)."""

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.account.service import expire_all, today
from app.config import Settings, get_settings
from app.db import get_session
from app.knowledge.cache import TTLCache, get_knowledge_cache

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


@router.post("/expire-documents")
async def expire_documents(
    session: Annotated[AsyncSession, Depends(get_session)],
    cache: Annotated[TTLCache, Depends(get_knowledge_cache)],
    settings: Annotated[Settings, Depends(get_settings)],
    x_cron_secret: Annotated[str | None, Header()] = None,
) -> dict:
    """Process every vault document whose expiry date has passed (idempotent; safe to retry)."""
    if not settings.cron_secret:
        raise HTTPException(404, "Not found")
    if not x_cron_secret or not hmac.compare_digest(x_cron_secret, settings.cron_secret):
        raise HTTPException(401, {"code": "invalid_cron_secret", "message": "Unauthorised."})
    run = await expire_all(session, cache)
    return {"date": today().isoformat(), **run.__dict__}
