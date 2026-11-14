from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.knowledge import repository
from app.knowledge.cache import TTLCache, get_knowledge_cache
from app.schemas.knowledge import DocumentOut

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    session: Annotated[AsyncSession, Depends(get_session)],
    cache: Annotated[TTLCache, Depends(get_knowledge_cache)],
) -> list[DocumentOut]:
    async def load() -> list[DocumentOut]:
        return [
            DocumentOut(
                id=d.slug,
                name=d.name,
                name_hi=d.name_hi,
                description=d.description,
                category=d.category.value,
                issued_by_service_ids=issued,
                accepted_by_service_ids=accepted,
            )
            for d, issued, accepted in await repository.list_documents(session)
        ]

    return await cache.get_or_load("documents", load)
