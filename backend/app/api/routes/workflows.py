from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.knowledge.cache import TTLCache, get_knowledge_cache
from app.schemas.workflow import DocumentNameOut, NameOut, PlanRequestIn, PlanResponse
from app.workflow.errors import DependencyCycleError, EmptySelectionError, UnknownIdsError
from app.workflow.service import plan_workflow

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.post("/plan", response_model=PlanResponse)
async def create_plan(
    body: PlanRequestIn,
    session: Annotated[AsyncSession, Depends(get_session)],
    cache: Annotated[TTLCache, Depends(get_knowledge_cache)],
) -> PlanResponse:
    try:
        result, names = await plan_workflow(
            session,
            body.target_service_ids,
            body.owned_document_ids,
            body.completed_service_ids,
            cache=cache,
        )
    except UnknownIdsError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {
                "code": "unknown_ids",
                "message": str(exc),
                "unknown_service_ids": exc.unknown_service_ids,
                "unknown_document_ids": exc.unknown_document_ids,
            },
        ) from exc
    except EmptySelectionError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, {"code": "empty_selection", "message": str(exc)}
        ) from exc
    except DependencyCycleError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": "dependency_cycle", "message": str(exc), "cycle": exc.cycle},
        ) from exc
    response = PlanResponse.model_validate(result)
    response.services = {k: NameOut(name=n, name_hi=hi) for k, (n, hi) in names["services"].items()}
    response.requirements = {
        k: NameOut(name=n, name_hi=hi) for k, (n, hi) in names["requirements"].items()
    }
    response.documents = {
        k: DocumentNameOut(name=n, name_hi=hi, category=c)
        for k, (n, hi, c) in names["documents"].items()
    }
    return response
