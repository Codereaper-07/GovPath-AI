"""Situation -> proposed workflow (pure: no DB, web or AI).

Composes the two existing deterministic stages and adds nothing that decides services or order:

1. `discovery.discover` turns the (reviewed) citizen context into candidate services: intended
   outcomes, from goals or life events, filtered by verified jurisdiction and existing records.
2. `planner.plan` builds the workflow for those outcomes. It alone adds supporting services
   (verified prerequisites, or services that issue a missing mandatory document), orders them,
   groups parallel steps, finds blockers and picks the next action.

The citizen may override the outcome list (add/remove supported services) and regenerate; the
result is a proposal until the citizen accepts it in the UI.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from app.workflow.discovery import CandidateStatus, CitizenContext, DiscoveryResult, discover
from app.workflow.domain import (
    DocumentState,
    KnowledgeSnapshot,
    PlanRequest,
    PlanResult,
    ProcessState,
    StepRole,
)
from app.workflow.planner import plan


class ProposalStatus(StrEnum):
    READY = "ready"  # a plan exists and nothing needs answering
    NEEDS_CLARIFICATION = "needs_clarification"  # answer the questions to complete it
    NO_SUPPORTED_SERVICES = "no_supported_services"  # the knowledge base has nothing for this
    NO_SERVICES_SELECTED = "no_services_selected"  # the citizen removed every service


@dataclass(frozen=True)
class SupportingService:
    """A service the planner added to reach the outcomes (never chosen by discovery or AI)."""

    service_id: str
    role: StepRole  # prerequisite | acquisition
    for_service_ids: tuple[str, ...]
    document_ids: tuple[str, ...] = ()  # documents it issues for those services (acquisition)


@dataclass(frozen=True)
class ProposalResult:
    status: ProposalStatus
    discovery: DiscoveryResult
    target_ids: tuple[str, ...]  # intended outcomes passed to the planner
    plan: PlanResult | None
    supporting: tuple[SupportingService, ...]
    uncovered_goals: tuple[str, ...]  # goals with no verified service in the knowledge base
    uncovered_life_events: tuple[str, ...]


def propose(
    kb: KnowledgeSnapshot,
    ctx: CitizenContext,
    *,
    document_states: Mapping[str, DocumentState] | None = None,
    progress: Mapping[str, ProcessState] | None = None,
    target_ids: tuple[str, ...] | None = None,
) -> ProposalResult:
    """`target_ids` overrides discovery's recommendation (the citizen's edited list)."""
    found = discover(kb, ctx)
    uncovered_goals = tuple(
        g for g in ctx.goals if not any(g in s.goals for s in kb.services.values())
    )
    uncovered_events = (
        ()
        if ctx.goals
        else tuple(
            e for e in ctx.life_events if not any(e in s.life_events for s in kb.services.values())
        )
    )
    targets = (
        found.recommended_target_ids if target_ids is None else tuple(dict.fromkeys(target_ids))
    )
    if not targets:
        unclear = any(c.status is CandidateStatus.NEEDS_CLARIFICATION for c in found.candidates)
        if target_ids is not None:
            status = ProposalStatus.NO_SERVICES_SELECTED
        elif unclear or not (ctx.goals or ctx.life_events):
            status = ProposalStatus.NEEDS_CLARIFICATION  # answer the questions first
        else:
            status = ProposalStatus.NO_SUPPORTED_SERVICES  # nothing verified matches: say so
        return ProposalResult(status, found, (), None, (), uncovered_goals, uncovered_events)

    result = plan(
        kb,
        PlanRequest(
            targets,
            ctx.held_document_ids,
            ctx.completed_service_ids,
            progress=dict(progress or {}),
            document_states=dict(document_states or {}),
            citizen_state=ctx.state,
        ),
    )
    supporting = []
    for step in result.steps:
        if step.role is StepRole.TARGET:
            continue
        routes = [r for r in result.acquisition_routes if r.service_id == step.service_id]
        supporting.append(
            SupportingService(
                service_id=step.service_id,
                role=step.role,
                for_service_ids=tuple(
                    sorted({r.for_service_id for r in routes} | set(step.unblocks))
                ),
                document_ids=tuple(sorted({r.document_id for r in routes})),
            )
        )
    open_questions = [
        q
        for q in found.clarifications
        if any(sid not in targets for sid in q.service_ids) or not q.service_ids
    ]
    needs = bool(open_questions or result.clarifications)
    status = ProposalStatus.NEEDS_CLARIFICATION if needs else ProposalStatus.READY
    return ProposalResult(
        status, found, targets, result, tuple(supporting), uncovered_goals, uncovered_events
    )
