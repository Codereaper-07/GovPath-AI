"""Read queries over the verified knowledge base (no AI, no planning logic)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    DocumentType,
    Evidence,
    GovernmentService,
    RequirementOption,
    ServiceOutput,
    ServicePrerequisite,
    ServiceRequirement,
    SourceDocument,
)


def _source(rel):
    """Join an evidence row's source without its (large) extracted text."""
    return rel.joinedload(Evidence.source).load_only(
        SourceDocument.id,
        SourceDocument.url,
        SourceDocument.title,
        SourceDocument.authority,
        SourceDocument.verification_status,
    )


def _service_loader_options():
    """Collections via selectin (one query each); many-to-one via JOIN (no extra round-trip)."""
    req = selectinload(GovernmentService.requirements)
    opt = req.selectinload(ServiceRequirement.options)
    out = selectinload(GovernmentService.outputs)
    pre = selectinload(GovernmentService.prerequisites)
    return (
        _source(selectinload(GovernmentService.evidence)),
        _source(req.selectinload(ServiceRequirement.evidence)),
        opt.joinedload(RequirementOption.document_type),
        _source(opt.joinedload(RequirementOption.evidence)),
        out.joinedload(ServiceOutput.document_type),
        _source(out.joinedload(ServiceOutput.evidence)),
        pre.joinedload(ServicePrerequisite.prerequisite),
        _source(pre.joinedload(ServicePrerequisite.evidence)),
    )


async def list_services(
    session: AsyncSession, *, active_only: bool = True
) -> list[GovernmentService]:
    stmt = (
        select(GovernmentService)
        .options(*_service_loader_options())
        .order_by(GovernmentService.slug)
    )
    if active_only:
        stmt = stmt.where(GovernmentService.is_active.is_(True))
    return list((await session.execute(stmt)).scalars().all())


async def get_service(session: AsyncSession, slug: str) -> GovernmentService | None:
    stmt = (
        select(GovernmentService)
        .options(*_service_loader_options())
        .where(GovernmentService.slug == slug, GovernmentService.is_active.is_(True))
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def display_names(session: AsyncSession) -> dict[str, dict]:
    """English/Hindi display names keyed by public id, for services, requirements, documents."""
    services = await session.execute(
        select(GovernmentService.slug, GovernmentService.name, GovernmentService.name_hi)
    )
    reqs = await session.execute(
        select(
            GovernmentService.slug,
            ServiceRequirement.slug,
            ServiceRequirement.name,
            ServiceRequirement.name_hi,
        ).join(GovernmentService, ServiceRequirement.service_id == GovernmentService.id)
    )
    docs = await session.execute(
        select(DocumentType.slug, DocumentType.name, DocumentType.name_hi, DocumentType.category)
    )
    return {
        "services": {s: (n, hi) for s, n, hi in services.all()},
        "requirements": {f"{s}.{r}": (n, hi) for s, r, n, hi in reqs.all()},
        "documents": {d: (n, hi, c.value) for d, n, hi, c in docs.all()},
    }


async def list_documents(session: AsyncSession) -> list[tuple[DocumentType, list[str], list[str]]]:
    """Each document with the active services that issue it and the services that accept it."""
    docs = (await session.execute(select(DocumentType).order_by(DocumentType.slug))).scalars().all()
    produced = await session.execute(
        select(ServiceOutput.document_type_id, GovernmentService.slug)
        .join(GovernmentService)
        .where(GovernmentService.is_active.is_(True))
    )
    accepted = await session.execute(
        select(RequirementOption.document_type_id, GovernmentService.slug)
        .join(ServiceRequirement, RequirementOption.requirement_id == ServiceRequirement.id)
        .join(GovernmentService, ServiceRequirement.service_id == GovernmentService.id)
        .where(GovernmentService.is_active.is_(True))
    )
    issued_by: dict[int, set[str]] = {}
    for doc_id, slug in produced.all():
        issued_by.setdefault(doc_id, set()).add(slug)
    used_by: dict[int, set[str]] = {}
    for doc_id, slug in accepted.all():
        used_by.setdefault(doc_id, set()).add(slug)
    return [(d, sorted(issued_by.get(d.id, ())), sorted(used_by.get(d.id, ()))) for d in docs]
