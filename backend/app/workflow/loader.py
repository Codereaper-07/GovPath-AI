"""Build a planning snapshot from the verified knowledge base.

This is the only workflow module that touches the database. It filters to verified facts:
unverified/needs-review requirements, prerequisites and outputs are never used for planning.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.knowledge.repository import list_documents, list_services
from app.models import Evidence
from app.models.enums import VerificationStatus
from app.workflow.domain import (
    DocumentSpec,
    EvidenceRef,
    Kind,
    KnowledgeSnapshot,
    RequirementSpec,
    ServiceSpec,
)

VERIFIED = VerificationStatus.VERIFIED


def _ref(ev: Evidence) -> EvidenceRef:
    return EvidenceRef(
        id=ev.key,
        source_url=ev.source.url,
        source_title=ev.source.title,
        excerpt=ev.excerpt,
        locator=ev.locator,
        verified_at=ev.verified_at.date().isoformat() if ev.verified_at else None,
    )


def _verified(ev: Evidence | None) -> bool:
    return ev is not None and ev.verification_status is VERIFIED


async def load_snapshot(session: AsyncSession) -> KnowledgeSnapshot:
    services = await list_services(session, active_only=True)
    documents = await list_documents(session)
    evidence: dict[str, EvidenceRef] = {}

    def keep(evs) -> tuple[str, ...]:
        out = []
        for ev in evs:
            if _verified(ev):
                evidence.setdefault(ev.key, _ref(ev))
                out.append(ev.key)
        return tuple(dict.fromkeys(out))

    specs: dict[str, ServiceSpec] = {}
    for svc in services:
        reqs = []
        for r in svc.requirements:
            if r.verification_status is not VERIFIED:
                continue
            option_evidence = [o.evidence for o in r.options if o.evidence]
            reqs.append(
                RequirementSpec(
                    id=f"{svc.slug}.{r.slug}",
                    service_id=svc.slug,
                    name=r.name,
                    kind=Kind(r.requirement_type.value),
                    document_ids=tuple(o.document_type.slug for o in r.options),
                    description=r.description,
                    condition=r.condition,
                    notes=r.notes,
                    evidence_ids=keep([*r.evidence, *option_evidence]),
                )
            )
        outputs = [o for o in svc.outputs if _verified(o.evidence)]
        prereqs = [
            p
            for p in svc.prerequisites
            if p.verification_status is VERIFIED
            and _verified(p.evidence)
            and p.prerequisite.is_active
        ]
        specs[svc.slug] = ServiceSpec(
            id=svc.slug,
            name=svc.name,
            requirements=tuple(reqs),
            outputs=tuple(o.document_type.slug for o in outputs),
            prerequisites=tuple(p.prerequisite.slug for p in prereqs),
            evidence_ids=keep(svc.evidence),
            output_evidence={o.document_type.slug: keep([o.evidence]) for o in outputs},
            prerequisite_evidence={p.prerequisite.slug: keep([p.evidence]) for p in prereqs},
        )

    docs = {d.slug: DocumentSpec(d.slug, d.name, d.category.value) for d, _, _ in documents}
    return KnowledgeSnapshot(services=specs, documents=docs, evidence=evidence)
