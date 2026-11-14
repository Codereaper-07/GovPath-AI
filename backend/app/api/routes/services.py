from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.knowledge import repository
from app.knowledge.cache import TTLCache, get_knowledge_cache
from app.schemas.knowledge import ServiceDetail, ServiceSummary

router = APIRouter(prefix="/services", tags=["services"])
SessionDep = Annotated[AsyncSession, Depends(get_session)]
CacheDep = Annotated[TTLCache, Depends(get_knowledge_cache)]


@router.get("", response_model=list[ServiceSummary])
async def list_services(session: SessionDep, cache: CacheDep) -> list[ServiceSummary]:
    async def load() -> list[ServiceSummary]:
        return [ServiceSummary.of(s) for s in await repository.list_services(session)]

    return await cache.get_or_load("services", load)


@router.get("/{service_id}", response_model=ServiceDetail)
async def get_service(
    session: SessionDep,
    cache: CacheDep,
    service_id: Annotated[str, Path(max_length=100, pattern=r"^[a-z0-9-]+$")],
) -> ServiceDetail:
    async def load() -> ServiceDetail | None:
        service = await repository.get_service(session, service_id)
        return ServiceDetail.of(service) if service else None

    detail = await cache.get_or_load(f"service:{service_id}", load)
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Service '{service_id}' not found")
    return detail
