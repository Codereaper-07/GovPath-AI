"""Deterministic service discovery: structured citizen context -> candidate services.

Pure (no DB, web or AI). The context may come from a form or from the AI situation interpreter;
either way only this module decides which services are candidates, using verified knowledge:

- goals: each service lists the citizen goals it directly serves (curated classification);
  without goals, life events give broader candidates;
- jurisdiction: a service whose verified facts cover one state/UT only is excluded when the
  citizen lives elsewhere, and needs clarification when the state is unknown;
- records: a service that requires an existing record no service issues (e.g. an existing
  driving licence for a licence update) is excluded when the citizen says they do not hold it,
  and needs clarification when that is unknown.

Nothing here orders services or decides readiness: that is the planner's job.
"""

from dataclasses import dataclass
from enum import StrEnum

from app.workflow.domain import KnowledgeSnapshot
from app.workflow.planner import record_groups


class CandidateStatus(StrEnum):
    INCLUDED = "included"
    NEEDS_CLARIFICATION = "needs_clarification"
    EXCLUDED = "excluded"
    COMPLETED = "completed"


class ExclusionCode(StrEnum):
    OUTSIDE_VERIFIED_JURISDICTION = "outside_verified_jurisdiction"
    LACKS_REQUIRED_RECORD = "lacks_required_record"


class DiscoveryQuestion(StrEnum):
    GOAL_REQUIRED = "goal_required"
    STATE_REQUIRED = "state_required"
    RECORD_HELD = "record_held"


@dataclass(frozen=True)
class CitizenContext:
    goals: tuple[str, ...] = ()
    life_events: tuple[str, ...] = ()
    state: str | None = None
    held_document_ids: tuple[str, ...] = ()
    lacking_document_ids: tuple[str, ...] = ()  # documents the citizen says they do not have
    completed_service_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class ServiceCandidate:
    service_id: str
    status: CandidateStatus
    matched_goals: tuple[str, ...]
    matched_life_events: tuple[str, ...]
    region: str | None = None
    exclusion: ExclusionCode | None = None
    record_document_ids: tuple[str, ...] = ()  # records lacking (excluded) or to confirm


@dataclass(frozen=True)
class Clarification:
    code: DiscoveryQuestion
    service_ids: tuple[str, ...] = ()
    document_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class DiscoveryResult:
    candidates: tuple[ServiceCandidate, ...]
    clarifications: tuple[Clarification, ...]
    recommended_target_ids: tuple[str, ...]


def _record_groups(kb: KnowledgeSnapshot, service_id: str) -> list[tuple[str, ...]]:
    """Mandatory requirements satisfiable only by existing records that no service issues (the
    planner's own rule, so discovery and route selection always agree)."""
    return record_groups(kb, service_id)


def discover(kb: KnowledgeSnapshot, ctx: CitizenContext) -> DiscoveryResult:
    goals, events = set(ctx.goals), set(ctx.life_events)
    held, lacking = (
        set(ctx.held_document_ids),
        set(ctx.lacking_document_ids) - set(ctx.held_document_ids),
    )
    if not goals and not events:
        return DiscoveryResult((), (Clarification(DiscoveryQuestion.GOAL_REQUIRED),), ())

    candidates: list[ServiceCandidate] = []
    need_state: list[str] = []
    record_questions: dict[tuple[str, ...], list[str]] = {}
    for sid in sorted(kb.services):
        spec = kb.services[sid]
        matched_goals = tuple(sorted(goals & set(spec.goals)))
        matched_events = tuple(sorted(events & set(spec.life_events)))
        if goals and not matched_goals:
            continue
        if not goals and not matched_events:
            continue
        base = dict(
            service_id=sid,
            matched_goals=matched_goals,
            matched_life_events=matched_events,
            region=spec.region,
        )
        if sid in ctx.completed_service_ids:
            candidates.append(ServiceCandidate(status=CandidateStatus.COMPLETED, **base))
            continue
        coverage = spec.available_in(ctx.state)
        if coverage is False:
            candidates.append(
                ServiceCandidate(
                    status=CandidateStatus.EXCLUDED,
                    exclusion=ExclusionCode.OUTSIDE_VERIFIED_JURISDICTION,
                    **base,
                )
            )
            continue
        lacking_records: list[str] = []
        unknown_records: list[tuple[str, ...]] = []
        for group in _record_groups(kb, sid):
            if held & set(group):
                continue
            if set(group) <= lacking:
                lacking_records.extend(group)
            else:
                unknown_records.append(group)
        if lacking_records:
            candidates.append(
                ServiceCandidate(
                    status=CandidateStatus.EXCLUDED,
                    exclusion=ExclusionCode.LACKS_REQUIRED_RECORD,
                    record_document_ids=tuple(lacking_records),
                    **base,
                )
            )
            continue
        if coverage is None:
            need_state.append(sid)
        for group in unknown_records:
            record_questions.setdefault(group, []).append(sid)
        unclear = coverage is None or bool(unknown_records)
        candidates.append(
            ServiceCandidate(
                status=CandidateStatus.NEEDS_CLARIFICATION if unclear else CandidateStatus.INCLUDED,
                record_document_ids=tuple(d for g in unknown_records for d in g),
                **base,
            )
        )

    clarifications: list[Clarification] = []
    if need_state:
        clarifications.append(Clarification(DiscoveryQuestion.STATE_REQUIRED, tuple(need_state)))
    for group, sids in sorted(record_questions.items()):
        clarifications.append(Clarification(DiscoveryQuestion.RECORD_HELD, tuple(sids), group))
    recommended = tuple(
        c.service_id
        for c in candidates
        if c.status in (CandidateStatus.INCLUDED, CandidateStatus.COMPLETED)
    )
    return DiscoveryResult(tuple(candidates), tuple(clarifications), recommended)
