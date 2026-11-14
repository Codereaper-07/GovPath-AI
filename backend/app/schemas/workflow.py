"""Workflow planning request/response schemas (mirror app.workflow.domain results)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ProcessStateIn = Literal["not_started", "started", "submitted", "completed"]
DocumentStateIn = Literal["available", "expired", "invalid", "unsure"]


def _clean_ids(v: list[str]) -> list[str]:
    cleaned = [s.strip() for s in v]
    if any(not s or len(s) > 100 for s in cleaned):
        raise ValueError("ids must be non-empty strings of at most 100 characters")
    return cleaned


class PlanRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_service_ids: list[str] = Field(min_length=1, max_length=20)
    owned_document_ids: list[str] = Field(default_factory=list, max_length=200)
    # User-reported completions (kept for compatibility; same as progress == "completed").
    completed_service_ids: list[str] = Field(default_factory=list, max_length=20)
    # Process progress reported by the citizen, per service.
    progress: dict[str, ProcessStateIn] = Field(default_factory=dict, max_length=40)
    # The citizen's assessment of documents they hold (only "available" satisfies).
    document_states: dict[str, DocumentStateIn] = Field(default_factory=dict, max_length=200)
    # State/UT the citizen lives in (for region-specific services); None if unknown.
    state: str | None = Field(default=None, max_length=100)

    @field_validator("target_service_ids", "owned_document_ids", "completed_service_ids")
    @classmethod
    def _strip(cls, v: list[str]) -> list[str]:
        return _clean_ids(v)

    @field_validator("progress", "document_states")
    @classmethod
    def _keys(cls, v: dict) -> dict:
        _clean_ids(list(v))
        return {k.strip(): s for k, s in v.items()}


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class DependencyOut(_Out):
    service_id: str
    reason: str
    document_id: str | None
    requirement_id: str | None
    evidence_ids: list[str]
    acceptance_evidence_ids: list[str]


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
    unusable_document_ids: list[str]


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
    process_state: str
    authority: str
    region: str | None
    completion_document_ids: list[str]
    completion_evidence_ids: list[str]


class BlockerOut(_Out):
    code: str
    service_id: str
    message: str
    requirement_id: str | None
    document_options: list[str]
    blocked_by_service_ids: list[str]
    route_service_ids: list[str]
    evidence_ids: list[str]


class CompletedServiceOut(_Out):
    service_id: str
    source: str  # "user_reported" (GovPath never verifies completion with a department)
    output_document_ids: list[str]


class NoticeOut(_Out):
    code: str
    service_id: str
    message: str
    related_service_ids: list[str]


class PlanClarificationOut(_Out):
    code: str
    service_id: str
    region: str | None


class ProgressOut(_Out):
    total_services: int
    completed: int
    completed_user_reported: int
    completed_verified: int
    in_progress: int
    ready: int
    waiting: int
    blocked: int


class UnusableDocumentOut(_Out):
    document_id: str
    state: str


class DocumentSummaryOut(_Out):
    mandatory_requirements: int
    satisfied: int
    will_be_produced: int
    missing: int
    unusable: list[UnusableDocumentOut]


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
    acceptance_evidence_ids: list[str]


class ReasonOut(_Out):
    code: str
    message: str
    unblocks: list[str]
    parallel_with: list[str]
    documents_used: list[str]
    document_options: list[str]
    evidence_ids: list[str] = []


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
    completed: list[CompletedServiceOut] = []
    progress: ProgressOut | None = None
    document_summary: DocumentSummaryOut | None = None
    notices: list[NoticeOut] = []
    clarifications: list[PlanClarificationOut] = []
    citizen_state: str | None = None
    # Display names (English + Hindi) for every id the plan mentions.
    services: dict[str, NameOut] = {}
    requirements: dict[str, NameOut] = {}
    documents: dict[str, DocumentNameOut] = {}


# ---------------------------------------------------------------- discovery


class DiscoverIn(BaseModel):
    """Structured citizen context (from a form, or from the AI interpreter after review)."""

    model_config = ConfigDict(extra="forbid")

    goals: list[str] = Field(default_factory=list, max_length=10)
    life_events: list[str] = Field(default_factory=list, max_length=10)
    state: str | None = Field(default=None, max_length=100)
    held_document_ids: list[str] = Field(default_factory=list, max_length=200)
    lacking_document_ids: list[str] = Field(default_factory=list, max_length=200)
    completed_service_ids: list[str] = Field(default_factory=list, max_length=20)

    @field_validator(
        "goals", "life_events", "held_document_ids", "lacking_document_ids", "completed_service_ids"
    )
    @classmethod
    def _strip(cls, v: list[str]) -> list[str]:
        return _clean_ids(v)


class CandidateOut(_Out):
    service_id: str
    status: str  # included | needs_clarification | excluded | completed
    matched_goals: list[str]
    matched_life_events: list[str]
    region: str | None
    exclusion: str | None
    record_document_ids: list[str]


class DiscoveryClarificationOut(_Out):
    code: str  # goal_required | state_required | record_held
    service_ids: list[str]
    document_ids: list[str]


class DiscoverResponse(_Out):
    generated_by: str = "deterministic-discovery"
    state: str | None
    candidates: list[CandidateOut]
    clarifications: list[DiscoveryClarificationOut]
    recommended_target_ids: list[str]
    services: dict[str, NameOut] = {}
    documents: dict[str, DocumentNameOut] = {}


class VocabularyOut(BaseModel):
    goals: list[str]
    life_events: list[str]
    states: list[str]
