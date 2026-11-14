"""Response schemas for verified knowledge. IDs are stable slugs, never database keys."""

from datetime import datetime

from pydantic import BaseModel

from app.models import Evidence, GovernmentService, ServiceRequirement


class EvidenceOut(BaseModel):
    id: str
    excerpt: str
    locator: str | None
    note: str | None
    source_url: str
    source_title: str | None
    source_authority: str | None
    verification_status: str
    verified_at: datetime | None

    @classmethod
    def of(cls, ev: Evidence) -> "EvidenceOut":
        return cls(
            id=ev.key,
            excerpt=ev.excerpt,
            locator=ev.locator,
            note=ev.note,
            source_url=ev.source.url,
            source_title=ev.source.title,
            source_authority=ev.source.authority,
            verification_status=ev.verification_status.value,
            verified_at=ev.verified_at,
        )


class DocumentOptionOut(BaseModel):
    document_id: str
    document_name: str
    document_name_hi: str | None
    notes: str | None
    evidence: EvidenceOut | None


class RequirementOut(BaseModel):
    id: str
    name: str
    name_hi: str | None
    description: str | None
    requirement_type: str
    is_alternative_group: bool
    condition: str | None
    notes: str | None
    verification_status: str
    options: list[DocumentOptionOut]
    evidence: list[EvidenceOut]

    @classmethod
    def of(cls, service_slug: str, r: ServiceRequirement) -> "RequirementOut":
        return cls(
            id=f"{service_slug}.{r.slug}",
            name=r.name,
            name_hi=r.name_hi,
            description=r.description,
            requirement_type=r.requirement_type.value,
            is_alternative_group=len(r.options) > 1,
            condition=r.condition,
            notes=r.notes,
            verification_status=r.verification_status.value,
            options=[
                DocumentOptionOut(
                    document_id=o.document_type.slug,
                    document_name=o.document_type.name,
                    document_name_hi=o.document_type.name_hi,
                    notes=o.notes,
                    evidence=EvidenceOut.of(o.evidence) if o.evidence else None,
                )
                for o in r.options
            ],
            evidence=[EvidenceOut.of(e) for e in r.evidence],
        )


class ServiceSummary(BaseModel):
    id: str
    name: str
    name_hi: str | None
    description: str
    description_hi: str | None
    authority: str
    jurisdiction: str
    state: str | None
    category: str
    application_form: str | None
    official_info_url: str
    application_url: str | None
    last_verified_at: datetime | None
    requirement_count: int
    mandatory_requirement_count: int
    verified_requirement_count: int

    @classmethod
    def of(cls, s: GovernmentService) -> "ServiceSummary":
        return cls(
            id=s.slug,
            name=s.name,
            name_hi=s.name_hi,
            description=s.description,
            description_hi=s.description_hi,
            authority=s.authority,
            jurisdiction=s.jurisdiction.value,
            state=s.state,
            category=s.category,
            application_form=s.application_form,
            official_info_url=s.official_info_url,
            application_url=s.application_url,
            last_verified_at=s.last_verified_at,
            requirement_count=len(s.requirements),
            mandatory_requirement_count=sum(
                1 for r in s.requirements if r.requirement_type.value == "mandatory"
            ),
            verified_requirement_count=sum(
                1 for r in s.requirements if r.verification_status.value == "verified"
            ),
        )


class OutputOut(BaseModel):
    document_id: str
    document_name: str
    document_name_hi: str | None
    evidence: EvidenceOut | None


class PrerequisiteOut(BaseModel):
    service_id: str
    service_name: str
    service_name_hi: str | None
    verification_status: str
    notes: str | None
    evidence: EvidenceOut


class ServiceDetail(ServiceSummary):
    verification_notes: str | None
    requirements: list[RequirementOut]
    outputs: list[OutputOut]
    prerequisites: list[PrerequisiteOut]
    evidence: list[EvidenceOut]

    @classmethod
    def of(cls, s: GovernmentService) -> "ServiceDetail":
        return cls(
            **ServiceSummary.of(s).model_dump(),
            verification_notes=s.verification_notes,
            requirements=[RequirementOut.of(s.slug, r) for r in s.requirements],
            outputs=[
                OutputOut(
                    document_id=o.document_type.slug,
                    document_name=o.document_type.name,
                    document_name_hi=o.document_type.name_hi,
                    evidence=EvidenceOut.of(o.evidence) if o.evidence else None,
                )
                for o in s.outputs
            ],
            prerequisites=[
                PrerequisiteOut(
                    service_id=p.prerequisite.slug,
                    service_name=p.prerequisite.name,
                    service_name_hi=p.prerequisite.name_hi,
                    verification_status=p.verification_status.value,
                    notes=p.notes,
                    evidence=EvidenceOut.of(p.evidence),
                )
                for p in s.prerequisites
            ],
            evidence=[EvidenceOut.of(e) for e in s.evidence],
        )


class DocumentOut(BaseModel):
    id: str
    name: str
    name_hi: str | None
    description: str | None
    category: str
    issued_by_service_ids: list[str]
    accepted_by_service_ids: list[str]
