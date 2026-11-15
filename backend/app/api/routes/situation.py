from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.knowledge.cache import TTLCache, get_knowledge_cache
from app.llm.client import (
    LLMError,
    LLMNotConfiguredError,
    LLMQuotaExhaustedError,
    LLMRateLimitedError,
    LLMUnavailableError,
)
from app.llm.situation import SituationContext, SituationInterpreter, SituationVocabulary
from app.models.enums import CitizenGoal, LifeEvent
from app.schemas.situation import SituationIn, SituationOut
from app.workflow.service import load_planning_data

router = APIRouter(prefix="/situation", tags=["situation"])

# English descriptions given to the model for the closed vocabularies.
GOAL_TEXT = {
    CitizenGoal.UPDATE_ADDRESS: "update the address on identity/vehicle documents after moving",
    CitizenGoal.UPDATE_NAME_AFTER_MARRIAGE: "change name/surname on documents after marriage",
    CitizenGoal.REGISTER_MARRIAGE: "register a marriage and get a marriage certificate",
    CitizenGoal.ENROL_CHILD_AADHAAR: "get Aadhaar for a young child",
    CitizenGoal.GET_PAN: "get a PAN card",
}
EVENT_TEXT = {
    LifeEvent.RELOCATION_IDENTITY: "moving home / keeping identity documents current",
    LifeEvent.MARRIAGE_FAMILY: "marriage and family",
    LifeEvent.BIRTH_PARENTHOOD: "birth of a child / parenthood",
    LifeEvent.EMPLOYMENT_CAREER: "starting a job / career",
    LifeEvent.STARTING_BUSINESS: "starting a business",
}


def get_interpreter(request: Request) -> SituationInterpreter:
    return request.app.state.situation_interpreter


def _error(code: int, key: str, message: str, headers: dict | None = None) -> HTTPException:
    return HTTPException(code, {"code": key, "message": message}, headers=headers)


async def situation_vocabulary(session: AsyncSession, cache: TTLCache) -> SituationVocabulary:
    snapshot, _ = await cache.get_or_load("planning", lambda: load_planning_data(session))
    return SituationVocabulary(
        goals={g.value: t for g, t in GOAL_TEXT.items()},
        life_events={e.value: t for e, t in EVENT_TEXT.items()},
        documents={d.id: d.name for d in snapshot.documents.values()},
        services={s.id: s.name for s in snapshot.services.values()},
    )


async def run_interpreter(
    interpreter: SituationInterpreter,
    body: SituationIn,
    vocab: SituationVocabulary,
    context: SituationContext | None = None,
) -> SituationOut:
    """Call the model (explicit user action only) and map provider errors to HTTP errors."""
    try:
        result = await interpreter.interpret(body.text, vocab, context, body.previous)
    except LLMNotConfiguredError as exc:
        raise _error(503, "assistant_not_configured", "The AI service is not configured.") from exc
    except LLMQuotaExhaustedError as exc:
        raise _error(429, "quota_exhausted", "The AI usage limit has been reached.") from exc
    except LLMRateLimitedError as exc:
        headers = {"Retry-After": str(int(exc.retry_after))} if exc.retry_after else None
        raise _error(429, "rate_limited", "Too many requests; try again shortly.", headers) from exc
    except LLMUnavailableError as exc:
        raise _error(503, "model_unavailable", "The AI service is unavailable.") from exc
    except LLMError as exc:
        raise _error(502, "model_error", "The AI service returned an error.") from exc
    return SituationOut(model=interpreter.model, **result.__dict__)


@router.post("/interpret", response_model=SituationOut)
async def interpret(
    body: SituationIn,
    session: Annotated[AsyncSession, Depends(get_session)],
    interpreter: Annotated[SituationInterpreter, Depends(get_interpreter)],
    cache: Annotated[TTLCache, Depends(get_knowledge_cache)],
) -> SituationOut:
    """AI extraction of structured facts from free text. Never decides services or order."""
    return await run_interpreter(interpreter, body, await situation_vocabulary(session, cache))
