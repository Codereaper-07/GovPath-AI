"""Application service: load verified knowledge, then run the pure planner."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.knowledge.cache import TTLCache
from app.knowledge.repository import display_names
from app.workflow.domain import KnowledgeSnapshot, PlanRequest, PlanResult
from app.workflow.loader import load_snapshot
from app.workflow.planner import plan


async def load_planning_data(session: AsyncSession) -> tuple[KnowledgeSnapshot, dict[str, dict]]:
    """Verified-only snapshot plus display names (cacheable: changes only when seeding)."""
    return await load_snapshot(session), await display_names(session)


async def plan_workflow(
    session: AsyncSession,
    target_service_ids: list[str],
    owned_document_ids: list[str],
    completed_service_ids: list[str],
    *,
    cache: TTLCache | None = None,
) -> tuple[PlanResult, dict[str, dict]]:
    """Return the plan plus English/Hindi display names for every id it mentions."""

    async def load() -> tuple[KnowledgeSnapshot, dict[str, dict]]:
        return await load_planning_data(session)

    snapshot, names = await (cache.get_or_load("planning", load) if cache else load())
    result = plan(
        snapshot,
        PlanRequest(
            tuple(target_service_ids), tuple(owned_document_ids), tuple(completed_service_ids)
        ),
    )
    services = {s.service_id for s in result.steps} | set(result.selected_service_ids)
    services |= set(result.completed_service_ids)
    reqs = [r for s in result.steps for r in s.requirements]
    documents = {d for r in reqs for d in r.document_options} | set(owned_document_ids)
    return result, {
        "services": {k: names["services"][k] for k in sorted(services) if k in names["services"]},
        "requirements": {
            r.requirement_id: names["requirements"][r.requirement_id]
            for r in reqs
            if r.requirement_id in names["requirements"]
        },
        "documents": {
            k: names["documents"][k] for k in sorted(documents) if k in names["documents"]
        },
    }
