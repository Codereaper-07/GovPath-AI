from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.knowledge.cache import TTLCache, get_knowledge_cache
from app.knowledge.regions import STATES_AND_UTS, normalise_state
from app.models.enums import CitizenGoal, LifeEvent
from app.schemas.workflow import (
    DiscoverIn,
    DiscoverResponse,
    PlanRequestIn,
    PlanResponse,
    ProposalResponse,
    ProposeIn,
    SupportingServiceOut,
    VocabularyOut,
    build_plan_response,
    document_names_out,
    service_names_out,
)
from app.workflow.discovery import CitizenContext
from app.workflow.errors import DependencyCycleError, EmptySelectionError, UnknownIdsError
from app.workflow.service import discover_services, plan_workflow, propose_workflow

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


_service_names = service_names_out
_document_names = document_names_out


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
    try:
        result, state, names = await discover_services(session, _context(body), cache=cache)
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


def _context(body: DiscoverIn) -> CitizenContext:
    return CitizenContext(
        goals=tuple(body.goals),
        life_events=tuple(body.life_events),
        state=body.state,
        held_document_ids=tuple(body.held_document_ids),
        lacking_document_ids=tuple(body.lacking_document_ids),
        completed_service_ids=tuple(body.completed_service_ids),
    )


_plan_response = build_plan_response


@router.post("/propose", response_model=ProposalResponse)
async def propose(
    body: ProposeIn,
    session: Annotated[AsyncSession, Depends(get_session)],
    cache: Annotated[TTLCache, Depends(get_knowledge_cache)],
) -> ProposalResponse:
    """Reviewed situation -> discovered outcomes -> deterministic plan (a proposal, not saved)."""
    try:
        result, names = await propose_workflow(
            session,
            _context(body.context),
            document_states=body.document_states,
            progress=body.progress,
            target_ids=body.target_service_ids,
            cache=cache,
        )
    except UnknownIdsError as exc:
        raise _unknown(exc) from exc
    except DependencyCycleError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": "dependency_cycle", "message": str(exc), "cycle": exc.cycle},
        ) from exc
    found = result.discovery
    discovery = DiscoverResponse.model_validate(
        {
            "state": normalise_state(body.context.state),
            "candidates": [c.__dict__ for c in found.candidates],
            "clarifications": [q.__dict__ for q in found.clarifications],
            "recommended_target_ids": list(found.recommended_target_ids),
        }
    )
    discovery.services = _service_names(names["services"])
    discovery.documents = _document_names(names["documents"])
    return ProposalResponse(
        status=result.status.value,
        discovery=discovery,
        target_service_ids=list(result.target_ids),
        supporting=[SupportingServiceOut.model_validate(s) for s in result.supporting],
        plan=_plan_response(result.plan, names) if result.plan else None,
        uncovered_goals=list(result.uncovered_goals),
        uncovered_life_events=list(result.uncovered_life_events),
    )


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
    return _plan_response(result, names)
