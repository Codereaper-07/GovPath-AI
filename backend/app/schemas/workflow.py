"""Workflow planning request/response schemas (mirror app.workflow.domain results)."""

from typing import Any, Literal

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
    # Documents the citizen explicitly said they do not have (vs. simply not declared).
    lacking_document_ids: list[str] = Field(default_factory=list, max_length=200)

    @field_validator(
        "target_service_ids", "owned_document_ids", "completed_service_ids", "lacking_document_ids"
    )
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
    route_needs_document_ids: list[str] = []


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
    document_id: str | None = None
    route_service_ids: list[str] = []


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


def service_names_out(names: dict) -> dict[str, NameOut]:
    return {k: NameOut(name=n, name_hi=hi) for k, (n, hi) in names.items()}


def document_names_out(names: dict) -> dict[str, DocumentNameOut]:
    return {k: DocumentNameOut(name=n, name_hi=hi, category=c) for k, (n, hi, c) in names.items()}


def build_plan_response(result: object, names: dict) -> PlanResponse:
    """PlanResponse for a planner result plus its display names (see workflow.service)."""
    response = PlanResponse.model_validate(result)
    response.services = service_names_out(names["services"])
    response.requirements = {
        k: NameOut(name=n, name_hi=hi) for k, (n, hi) in names["requirements"].items()
    }
    response.documents = document_names_out(names["documents"])
    return response


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


class ProposeIn(BaseModel):
    """Reviewed situation -> proposed workflow. `target_service_ids` (optional) is the citizen's
    edited outcome list; when omitted, discovery's recommendation is used."""

    model_config = ConfigDict(extra="forbid")

    context: DiscoverIn
    document_states: dict[str, DocumentStateIn] = Field(default_factory=dict, max_length=200)
    progress: dict[str, ProcessStateIn] = Field(default_factory=dict, max_length=40)
    target_service_ids: list[str] | None = Field(default=None, max_length=20)
    # Services the citizen explicitly asked for (validated against the knowledge base).
    requested_service_ids: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("target_service_ids")
    @classmethod
    def _strip(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else _clean_ids(v)

    @field_validator("requested_service_ids")
    @classmethod
    def _strip_requested(cls, v: list[str]) -> list[str]:
        return _clean_ids(v)

    @field_validator("progress", "document_states")
    @classmethod
    def _keys(cls, v: dict) -> dict:
        _clean_ids(list(v))
        return {k.strip(): s for k, s in v.items()}


class SupportingServiceOut(_Out):
    service_id: str
    role: str  # prerequisite | acquisition (added by the planner, never by AI)
    for_service_ids: list[str]
    document_ids: list[str]


class RequestedServiceOut(BaseModel):
    service_id: str
    outcome: str  # target | completed | outside_jurisdiction | unknown


class GroundingOut(BaseModel):
    """Every requirement and dependency in the plan cites official evidence (checked here)."""

    requirements: int
    requirements_grounded: int
    dependencies: int
    dependencies_grounded: int
    ungrounded: list[str]


class ProposalResponse(BaseModel):
    """A proposal only: the citizen reviews it and accepts it in the UI before it is saved."""

    generated_by: Literal["deterministic-discovery+planner"] = "deterministic-discovery+planner"
    status: str  # ready | needs_clarification | no_supported_services | no_services_selected
    discovery: DiscoverResponse
    target_service_ids: list[str]
    supporting: list[SupportingServiceOut]
    plan: PlanResponse | None
    uncovered_goals: list[str]
    uncovered_life_events: list[str]
    requested: list[RequestedServiceOut] = []
    suggested_service_ids: list[str] = []
    grounding: GroundingOut | None = None


def build_proposal_response(result: Any, names: dict, state: str | None) -> "ProposalResponse":
    """Response for a `ProposalResult` plus display names (shared by guest and account routes)."""
    from app.workflow.proposal import grounding

    found = result.discovery
    discovery = DiscoverResponse.model_validate(
        {
            "state": state,
            "candidates": [c.__dict__ for c in found.candidates],
            "clarifications": [q.__dict__ for q in found.clarifications],
            "recommended_target_ids": list(found.recommended_target_ids),
        }
    )
    discovery.services = service_names_out(names["services"])
    discovery.documents = document_names_out(names["documents"])
    g = grounding(result.plan) if result.plan else None
    return ProposalResponse(
        status=result.status.value,
        discovery=discovery,
        target_service_ids=list(result.target_ids),
        supporting=[SupportingServiceOut.model_validate(s) for s in result.supporting],
        plan=build_plan_response(result.plan, names) if result.plan else None,
        uncovered_goals=list(result.uncovered_goals),
        uncovered_life_events=list(result.uncovered_life_events),
        requested=[
            RequestedServiceOut(service_id=r.service_id, outcome=r.outcome.value)
            for r in result.requested
        ],
        suggested_service_ids=list(result.suggested_ids),
        grounding=GroundingOut(
            requirements=g.requirements,
            requirements_grounded=g.requirements_grounded,
            dependencies=g.dependencies,
            dependencies_grounded=g.dependencies_grounded,
            ungrounded=list(g.ungrounded),
        )
        if g
        else None,
    )


class VocabularyOut(BaseModel):
    goals: list[str]
    life_events: list[str]
    states: list[str]
