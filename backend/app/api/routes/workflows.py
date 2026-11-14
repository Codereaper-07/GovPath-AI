from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.knowledge.cache import TTLCache, get_knowledge_cache
from app.knowledge.regions import STATES_AND_UTS
from app.models.enums import CitizenGoal, LifeEvent
from app.schemas.workflow import (
    DiscoverIn,
    DiscoverResponse,
    DocumentNameOut,
    NameOut,
    PlanRequestIn,
    PlanResponse,
    VocabularyOut,
)
from app.workflow.discovery import CitizenContext
from app.workflow.errors import DependencyCycleError, EmptySelectionError, UnknownIdsError
from app.workflow.service import discover_services, plan_workflow

router = APIRouter(prefix="/workflows", tags=["workflows"])


def _unknown(exc: UnknownIdsError) -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        {
            "code": "unknown_ids",
            "message": str(exc),
            "unknown_service_ids": exc.unknown_service_ids,
            "unknown_document_ids": exc.unknown_document_ids,
        },
    )


def _service_names(names: dict) -> dict[str, NameOut]:
    return {k: NameOut(name=n, name_hi=hi) for k, (n, hi) in names.items()}


def _document_names(names: dict) -> dict[str, DocumentNameOut]:
    return {k: DocumentNameOut(name=n, name_hi=hi, category=c) for k, (n, hi, c) in names.items()}


@router.get("/vocabulary", response_model=VocabularyOut)
async def vocabulary() -> VocabularyOut:
    """Closed vocabularies for describing a situation (goals, life events, states/UTs)."""
    return VocabularyOut(
        goals=[g.value for g in CitizenGoal],
        life_events=[e.value for e in LifeEvent],
        states=list(STATES_AND_UTS),
    )


@router.post("/discover", response_model=DiscoverResponse)
async def discover(
    body: DiscoverIn,
    session: Annotated[AsyncSession, Depends(get_session)],
    cache: Annotated[TTLCache, Depends(get_knowledge_cache)],
) -> DiscoverResponse:
    """Deterministic service discovery from a structured citizen context."""
    context = CitizenContext(
        goals=tuple(body.goals),
        life_events=tuple(body.life_events),
        state=body.state,
        held_document_ids=tuple(body.held_document_ids),
        lacking_document_ids=tuple(body.lacking_document_ids),
        completed_service_ids=tuple(body.completed_service_ids),
    )
    try:
        result, state, names = await discover_services(session, context, cache=cache)
    except UnknownIdsError as exc:
        raise _unknown(exc) from exc
    response = DiscoverResponse.model_validate(
        {
            "state": state,
            "candidates": [c.__dict__ for c in result.candidates],
            "clarifications": [q.__dict__ for q in result.clarifications],
            "recommended_target_ids": list(result.recommended_target_ids),
        }
    )
    response.services = _service_names(names["services"])
    response.documents = _document_names(names["documents"])
    return response


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
            progress=body.progress,
            document_states=body.document_states,
            state=body.state,
            cache=cache,
        )
    except UnknownIdsError as exc:
        raise _unknown(exc) from exc
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
    response.services = _service_names(names["services"])
    response.requirements = {
        k: NameOut(name=n, name_hi=hi) for k, (n, hi) in names["requirements"].items()
    }
    response.documents = _document_names(names["documents"])
    return response
