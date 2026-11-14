"""Application service: load verified knowledge, then run the pure planner / discovery."""

from collections.abc import Iterable, Mapping

from sqlalchemy.ext.asyncio import AsyncSession

from app.knowledge.cache import TTLCache
from app.knowledge.regions import normalise_state
from app.knowledge.repository import display_names
from app.workflow.discovery import CitizenContext, DiscoveryResult, discover
from app.workflow.domain import (
    DocumentState,
    KnowledgeSnapshot,
    PlanRequest,
    PlanResult,
    ProcessState,
)
from app.workflow.errors import UnknownIdsError
from app.workflow.loader import load_snapshot
from app.workflow.planner import plan


async def load_planning_data(session: AsyncSession) -> tuple[KnowledgeSnapshot, dict[str, dict]]:
    """Verified-only snapshot plus display names (cacheable: changes only when seeding)."""
    return await load_snapshot(session), await display_names(session)


async def _load(session: AsyncSession, cache: TTLCache | None):
    async def load() -> tuple[KnowledgeSnapshot, dict[str, dict]]:
        return await load_planning_data(session)

    return await (cache.get_or_load("planning", load) if cache else load())


def _names(names: dict[str, dict], services: Iterable[str], documents: Iterable[str]) -> dict:
    return {
        "services": {
            k: names["services"][k] for k in sorted(set(services)) if k in names["services"]
        },
        "documents": {
            k: names["documents"][k] for k in sorted(set(documents)) if k in names["documents"]
        },
    }


async def plan_workflow(
    session: AsyncSession,
    target_service_ids: list[str],
    owned_document_ids: list[str],
    completed_service_ids: list[str],
    *,
    progress: Mapping[str, str] | None = None,
    document_states: Mapping[str, str] | None = None,
    state: str | None = None,
    cache: TTLCache | None = None,
) -> tuple[PlanResult, dict[str, dict]]:
    """Return the plan plus English/Hindi display names for every id it mentions."""
    snapshot, names = await _load(session, cache)
    result = plan(
        snapshot,
        PlanRequest(
            tuple(target_service_ids),
            tuple(owned_document_ids),
            tuple(completed_service_ids),
            progress={k: ProcessState(v) for k, v in (progress or {}).items()},
            document_states={k: DocumentState(v) for k, v in (document_states or {}).items()},
            citizen_state=normalise_state(state) or (state or None),
        ),
    )
    services = {s.service_id for s in result.steps} | set(result.selected_service_ids)
    services |= set(result.completed_service_ids)
    services |= {
        p for b in result.blockers for p in (*b.route_service_ids, *b.blocked_by_service_ids)
    }
    services |= {s for n in result.notices for s in (n.service_id, *n.related_service_ids)}
    reqs = [r for s in result.steps for r in s.requirements]
    documents = {d for r in reqs for d in r.document_options} | set(owned_document_ids)
    documents |= {d for s in result.steps for d in s.completion_document_ids}
    documents |= {d for c in result.completed for d in c.output_document_ids}
    documents |= set(document_states or {})
    out = _names(names, services, documents)
    out["requirements"] = {
        r.requirement_id: names["requirements"][r.requirement_id]
        for r in reqs
        if r.requirement_id in names["requirements"]
    }
    return result, out


async def discover_services(
    session: AsyncSession, context: CitizenContext, *, cache: TTLCache | None = None
) -> tuple[DiscoveryResult, str | None, dict[str, dict]]:
    """Validate the context against the knowledge base, then run deterministic discovery."""
    from app.models.enums import CitizenGoal, LifeEvent

    snapshot, names = await _load(session, cache)
    unknown_services = [s for s in context.completed_service_ids if s not in snapshot.services]
    docs = [*context.held_document_ids, *context.lacking_document_ids]
    unknown_docs = [d for d in docs if d not in snapshot.documents]
    goals = {g.value for g in CitizenGoal}
    events = {e.value for e in LifeEvent}
    bad_vocab = [g for g in context.goals if g not in goals] + [
        e for e in context.life_events if e not in events
    ]
    if unknown_services or unknown_docs or bad_vocab:
        raise UnknownIdsError([*unknown_services, *bad_vocab], unknown_docs)
    state = normalise_state(context.state)
    result = discover(
        snapshot,
        CitizenContext(
            goals=context.goals,
            life_events=context.life_events,
            state=state,
            held_document_ids=context.held_document_ids,
            lacking_document_ids=context.lacking_document_ids,
            completed_service_ids=context.completed_service_ids,
        ),
    )
    services = [c.service_id for c in result.candidates]
    documents = {d for c in result.candidates for d in c.record_document_ids}
    documents |= {d for q in result.clarifications for d in q.document_ids}
    return result, state, _names(names, services, documents)
