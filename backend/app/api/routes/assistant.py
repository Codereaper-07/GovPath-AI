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
from app.rag.assistant import Assistant, AssistantNotReadyError, WorkflowInput
from app.ratelimit import limit_ai_requests
from app.schemas.assistant import (
    AssistantAnswerOut,
    AssistantQueryIn,
    CitationOut,
    WorkflowContextOut,
    WorkflowStepOut,
)
from app.schemas.workflow import NextActionOut
from app.workflow.errors import PlanningError, UnknownIdsError

router = APIRouter(prefix="/assistant", tags=["assistant"])


def get_assistant(request: Request) -> Assistant:
    return request.app.state.assistant


def _error(code: int, key: str, message: str, headers: dict | None = None) -> HTTPException:
    return HTTPException(code, {"code": key, "message": message}, headers=headers)


@router.post(
    "/query",
    response_model=AssistantAnswerOut,
    dependencies=[Depends(limit_ai_requests("assistant"))],  # 429 before any model call
)
async def query(
    body: AssistantQueryIn,
    session: Annotated[AsyncSession, Depends(get_session)],
    assistant: Annotated[Assistant, Depends(get_assistant)],
    cache: Annotated[TTLCache, Depends(get_knowledge_cache)],
) -> AssistantAnswerOut:
    workflow = (
        WorkflowInput(
            body.workflow.target_service_ids,
            body.workflow.owned_document_ids,
            body.workflow.completed_service_ids,
            progress=dict(body.workflow.progress),
            document_states=dict(body.workflow.document_states),
            state=body.workflow.state,
        )
        if body.workflow
        else None
    )
    try:
        result = await assistant.answer(
            session, body.question, language=body.language, workflow=workflow, knowledge_cache=cache
        )
    except LLMNotConfiguredError as exc:
        raise _error(
            503, "assistant_not_configured", "The AI assistant is not configured."
        ) from exc
    except AssistantNotReadyError as exc:
        raise _error(
            503, "index_not_built", "The assistant's source index has not been built yet."
        ) from exc
    except LLMQuotaExhaustedError as exc:
        raise _error(
            429, "quota_exhausted", "The AI assistant has reached its usage limit. Try again later."
        ) from exc
    except LLMRateLimitedError as exc:
        retry = {"Retry-After": str(int(exc.retry_after))} if exc.retry_after else None
        raise _error(
            429, "rate_limited", "Too many requests. Please wait and try again.", retry
        ) from exc
    except LLMUnavailableError as exc:
        raise _error(
            503, "model_unavailable", "The AI service is temporarily unavailable."
        ) from exc
    except LLMError as exc:
        raise _error(502, "model_error", "The AI service could not produce an answer.") from exc
    except UnknownIdsError as exc:
        raise _error(422, "unknown_ids", str(exc)) from exc
    except PlanningError as exc:
        raise _error(422, "invalid_workflow", str(exc)) from exc

    workflow_out = None
    if result.plan is not None:
        workflow_out = WorkflowContextOut(
            next_action=NextActionOut.model_validate(result.plan.next_action),
            steps=[
                WorkflowStepOut(
                    service_id=s.service_id, status=s.status.value, stage=s.stage, role=s.role.value
                )
                for s in result.plan.steps
            ],
        )
    return AssistantAnswerOut(
        answer=result.answer,
        language=result.language,
        generated_by="ai" if result.used_ai else "none",
        model=result.model,
        evidence_status=result.evidence_status,
        citations=[CitationOut.model_validate(c) for c in result.citations],
        retrieval_confidence=result.retrieval_confidence,
        best_similarity=result.best_similarity,
        cached=result.cached,
        workflow=workflow_out,
    )
