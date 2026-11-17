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
from app.workflow.planner import plan, shares_record


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


class RequestOutcome(StrEnum):
    TARGET = "target"  # planned
    COMPLETED = "completed"  # already reported completed: shown as done, never as a new step
    OUTSIDE_JURISDICTION = "outside_jurisdiction"  # verified only for another state
    UNKNOWN = "unknown"  # not in the knowledge base


@dataclass(frozen=True)
class RequestedService:
    """A service the citizen explicitly asked for, and what the proposal did with it."""

    service_id: str
    outcome: RequestOutcome


@dataclass(frozen=True)
class Grounding:
    """Evidence coverage of a plan: every requirement and dependency must cite official
    evidence that is present in the plan's evidence list."""

    requirements: int
    requirements_grounded: int
    dependencies: int
    dependencies_grounded: int
    ungrounded: tuple[str, ...]  # requirement ids / "service->service" dependencies

    @property
    def complete(self) -> bool:
        return not self.ungrounded


def grounding(result: PlanResult) -> Grounding:
    known = {e.id for e in result.evidence}
    reqs = {r.requirement_id: r for s in result.steps for r in s.requirements}
    bad_reqs = [
        rid for rid, r in reqs.items() if not (set(r.evidence_ids) and set(r.evidence_ids) <= known)
    ]
    deps = [(s.service_id, d) for s in result.steps for d in s.depends_on]
    bad_deps = [
        f"{d.service_id}->{sid}"
        for sid, d in deps
        if not (ids := {*d.evidence_ids, *d.acceptance_evidence_ids}) or not ids <= known
    ]
    return Grounding(
        requirements=len(reqs),
        requirements_grounded=len(reqs) - len(bad_reqs),
        dependencies=len(deps),
        dependencies_grounded=len(deps) - len(bad_deps),
        ungrounded=tuple(sorted(bad_reqs) + bad_deps),
    )


@dataclass(frozen=True)
class ProposalResult:
    status: ProposalStatus
    discovery: DiscoveryResult
    target_ids: tuple[str, ...]  # intended outcomes passed to the planner
    plan: PlanResult | None
    supporting: tuple[SupportingService, ...]
    uncovered_goals: tuple[str, ...]  # goals with no verified service in the knowledge base
    uncovered_life_events: tuple[str, ...]
    requested: tuple[RequestedService, ...] = ()
    # Discovered services the citizen did not ask for (shown as suggestions, not planned).
    suggested_ids: tuple[str, ...] = ()


def _requested(
    kb: KnowledgeSnapshot, ctx: CitizenContext, requested_ids: tuple[str, ...]
) -> tuple[RequestedService, ...]:
    out = []
    for sid in dict.fromkeys(requested_ids):
        spec = kb.services.get(sid)
        if spec is None:
            outcome = RequestOutcome.UNKNOWN
        elif sid in ctx.completed_service_ids:
            outcome = RequestOutcome.COMPLETED
        elif spec.available_in(ctx.state) is False:
            outcome = RequestOutcome.OUTSIDE_JURISDICTION
        else:
            outcome = RequestOutcome.TARGET
        out.append(RequestedService(sid, outcome))
    return tuple(out)


def propose(
    kb: KnowledgeSnapshot,
    ctx: CitizenContext,
    *,
    document_states: Mapping[str, DocumentState] | None = None,
    progress: Mapping[str, ProcessState] | None = None,
    target_ids: tuple[str, ...] | None = None,
    requested_ids: tuple[str, ...] = (),
) -> ProposalResult:
    """`target_ids` overrides everything (the citizen's edited list). Otherwise, services the
    citizen explicitly asked for (`requested_ids`, validated here) are the outcomes and other
    discovered services become suggestions; without requests, discovery's recommendation."""
    found = discover(kb, ctx)
    requested = _requested(kb, ctx, requested_ids)
    # Completed requests stay in the plan as completed (like discovery's completed candidates).
    asked = tuple(
        r.service_id
        for r in requested
        if r.outcome in (RequestOutcome.TARGET, RequestOutcome.COMPLETED)
    )
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
    driven_by_request = target_ids is None and bool(asked)
    if target_ids is not None:
        targets = tuple(dict.fromkeys(target_ids))
    elif asked:
        targets = asked
    else:
        targets = found.recommended_target_ids
    open_statuses = (CandidateStatus.INCLUDED, CandidateStatus.NEEDS_CLARIFICATION)
    suggested = (
        tuple(
            c.service_id
            for c in found.candidates
            if c.status in open_statuses and c.service_id not in targets
        )
        if target_ids is None and asked
        else ()
    )
    if not targets:
        unclear = any(c.status is CandidateStatus.NEEDS_CLARIFICATION for c in found.candidates)
        if target_ids is not None:
            status = ProposalStatus.NO_SERVICES_SELECTED
        elif unclear or not (ctx.goals or ctx.life_events):
            status = ProposalStatus.NEEDS_CLARIFICATION  # answer the questions first
        else:
            status = ProposalStatus.NO_SUPPORTED_SERVICES  # nothing verified matches: say so
        return ProposalResult(
            status, found, (), None, (), uncovered_goals, uncovered_events, requested, suggested
        )

    def run(targets: tuple[str, ...]):
        return plan(
            kb,
            PlanRequest(
                targets,
                ctx.held_document_ids,
                ctx.completed_service_ids,
                progress=dict(progress or {}),
                document_states=dict(document_states or {}),
                citizen_state=ctx.state,
                lacking_document_ids=ctx.lacking_document_ids,
            ),
        )

    result = run(targets)
    # A document the citizen explicitly said they lack, issued only by an update of a record they
    # already rely on (e.g. "my mobile is not registered with Aadhaar"), makes that update a
    # service they chose: it is kept in the saved plan, which is re-evaluated without this text.
    chosen = tuple(
        dict.fromkeys(
            r.service_id
            for r in result.acquisition_routes
            if r.document_id in ctx.lacking_document_ids
            and shares_record(kb, r.for_service_id, r.service_id)
        )
    )
    if chosen:
        targets = (*targets, *(c for c in chosen if c not in targets))
        result = run(targets)
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
    # When the citizen named the services, discovery's questions only concern suggestions
    # (or the goal, which naming services answers); the planner still asks for a missing state.
    open_questions = (
        []
        if driven_by_request
        else [
            q
            for q in found.clarifications
            if any(sid not in targets for sid in q.service_ids) or not q.service_ids
        ]
    )
    needs = bool(open_questions or result.clarifications)
    status = ProposalStatus.NEEDS_CLARIFICATION if needs else ProposalStatus.READY
    return ProposalResult(
        status,
        found,
        targets,
        result,
        tuple(supporting),
        uncovered_goals,
        uncovered_events,
        requested,
        suggested,
    )
