"""Workflow planning request/response schemas (mirror app.workflow.domain results)."""

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PlanRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_service_ids: list[str] = Field(min_length=1, max_length=20)
    owned_document_ids: list[str] = Field(default_factory=list, max_length=200)
    completed_service_ids: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("target_service_ids", "owned_document_ids", "completed_service_ids")
    @classmethod
    def _strip(cls, v: list[str]) -> list[str]:
        cleaned = [s.strip() for s in v]
        if any(not s or len(s) > 100 for s in cleaned):
            raise ValueError("ids must be non-empty strings of at most 100 characters")
        return cleaned


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class DependencyOut(_Out):
    service_id: str
    reason: str
    document_id: str | None
    requirement_id: str | None
    evidence_ids: list[str]


class RequirementStatusOut(_Out):
    requirement_id: str
    service_id: str
    name: str
    kind: str
    state: str
    document_options: list[str]
    is_alternative_group: bool
    satisfied_by_document_id: str | None
    acquired_via_service_id: str | None
    acquired_document_id: str | None
    condition: str | None
    notes: str | None
    evidence_ids: list[str]


class PlanStepOut(_Out):
    step_number: int
    stage: int
    service_id: str
    service_name: str
    role: str
    status: str
    depends_on: list[DependencyOut]
    unblocks: list[str]
    requirements: list[RequirementStatusOut]
    evidence_ids: list[str]


class BlockerOut(_Out):
    code: str
    service_id: str
    message: str
    requirement_id: str | None
    document_options: list[str]
    blocked_by_service_ids: list[str]


class MissingDocumentOut(_Out):
    requirement_id: str
    service_id: str
    document_options: list[str]
    acquisition_service_id: str | None


class AcquisitionRouteOut(_Out):
    service_id: str
    document_id: str
    for_service_id: str
    for_requirement_id: str
    evidence_ids: list[str]


class ReasonOut(_Out):
    code: str
    message: str
    unblocks: list[str]
    parallel_with: list[str]
    documents_used: list[str]
    document_options: list[str]


class NextActionOut(_Out):
    type: str
    reason: ReasonOut
    service_id: str | None
    requirement_id: str | None
    document_options: list[str]


class EvidenceRefOut(_Out):
    id: str
    source_url: str
    source_title: str | None
    excerpt: str
    locator: str | None
    verified_at: str | None


class NameOut(BaseModel):
    name: str
    name_hi: str | None = None


class DocumentNameOut(NameOut):
    category: str


class PlanResponse(_Out):
    """Deterministic plan. Contains only verified facts and rule-based reasoning (no AI text)."""

    generated_by: str = "deterministic-planner"
    selected_service_ids: list[str]
    completed_service_ids: list[str]
    steps: list[PlanStepOut]
    parallel_groups: list[list[str]]
    required_documents: list[RequirementStatusOut]
    satisfied_requirements: list[RequirementStatusOut]
    missing_documents: list[MissingDocumentOut]
    optional_documents: list[RequirementStatusOut]
    prerequisite_services: list[DependencyOut]
    acquisition_routes: list[AcquisitionRouteOut]
    blockers: list[BlockerOut]
    next_action: NextActionOut
    evidence: list[EvidenceRefOut]
    # Display names (English + Hindi) for every id the plan mentions.
    services: dict[str, NameOut] = {}
    requirements: dict[str, NameOut] = {}
    documents: dict[str, DocumentNameOut] = {}
