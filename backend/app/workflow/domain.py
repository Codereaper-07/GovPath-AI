"""Pure domain types for planning. No database, web framework or AI imports."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum


class Kind(StrEnum):
    MANDATORY = "mandatory"
    OPTIONAL = "optional"
    CONDITIONAL = "conditional"


class ProcessState(StrEnum):
    """Where the citizen is with a government process (reported by the citizen)."""

    NOT_STARTED = "not_started"
    STARTED = "started"
    SUBMITTED = "submitted"
    COMPLETED = "completed"


class CompletionSource(StrEnum):
    """Who vouches for a completion. GovPath has no departmental integration, so every
    completion it records is USER_REPORTED; OFFICIAL is reserved for a future read-only
    status integration and is never produced today."""

    USER_REPORTED = "user_reported"
    OFFICIAL = "official"


class DocumentState(StrEnum):
    """The citizen's own assessment of a document they hold. Only AVAILABLE satisfies a
    requirement; the other states are reported but treated as not held."""

    AVAILABLE = "available"
    EXPIRED = "expired"
    INVALID = "invalid"
    UNSURE = "unsure"


@dataclass(frozen=True)
class EvidenceRef:
    id: str
    source_url: str
    source_title: str | None
    excerpt: str
    locator: str | None = None
    verified_at: str | None = None


@dataclass(frozen=True)
class DocumentSpec:
    id: str
    name: str
    category: str

    @property
    def is_existing_record(self) -> bool:
        return self.category == "existing_record"


@dataclass(frozen=True)
class RequirementSpec:
    """A requirement whose `document_ids` form an OR group (any one satisfies it)."""

    id: str
    service_id: str
    name: str
    kind: Kind
    document_ids: tuple[str, ...]
    description: str | None = None
    condition: str | None = None
    notes: str | None = None
    evidence_ids: tuple[str, ...] = ()

    @property
    def is_alternative_group(self) -> bool:
        return len(self.document_ids) > 1

    @property
    def blocks_progress(self) -> bool:
        return self.kind is Kind.MANDATORY


@dataclass(frozen=True)
class ServiceSpec:
    id: str
    name: str
    requirements: tuple[RequirementSpec, ...] = ()
    outputs: tuple[str, ...] = ()  # document ids this service issues/updates
    prerequisites: tuple[str, ...] = ()  # VERIFIED prerequisite service ids only
    evidence_ids: tuple[str, ...] = ()
    output_evidence: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    prerequisite_evidence: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    authority: str = ""
    region: str | None = None  # set when the verified facts cover one state/UT only
    goals: tuple[str, ...] = ()
    life_events: tuple[str, ...] = ()

    def available_in(self, state: str | None) -> bool | None:
        """True/False if the service's verified coverage includes `state`; None if unknown."""
        if self.region is None:
            return True
        if not state:
            return None
        return self.region.strip().casefold() == state.strip().casefold()


@dataclass(frozen=True)
class KnowledgeSnapshot:
    services: Mapping[str, ServiceSpec]
    documents: Mapping[str, DocumentSpec]
    evidence: Mapping[str, EvidenceRef] = field(default_factory=dict)

    def producers_of(self, document_id: str) -> list[str]:
        return sorted(s.id for s in self.services.values() if document_id in s.outputs)


@dataclass(frozen=True)
class PlanRequest:
    target_service_ids: tuple[str, ...]
    owned_document_ids: tuple[str, ...] = ()
    completed_service_ids: tuple[str, ...] = ()  # user-reported completions (legacy field)
    progress: Mapping[str, ProcessState] = field(default_factory=dict)
    document_states: Mapping[str, DocumentState] = field(default_factory=dict)
    citizen_state: str | None = None  # state/UT the citizen lives in, if known


# ---------------------------------------------------------------- results


class StepRole(StrEnum):
    TARGET = "target"
    PREREQUISITE = "prerequisite"
    ACQUISITION = "acquisition"


class StepStatus(StrEnum):
    READY = "ready"  # can be started now
    WAITING = "waiting"  # pending: waits for another step in the plan
    BLOCKED = "blocked"  # a mandatory document has no route, or a dependency is blocked
    IN_PROGRESS = "in_progress"  # the citizen reported it started or submitted


class RequirementState(StrEnum):
    SATISFIED = "satisfied"  # an owned document satisfies it
    PENDING_ACQUISITION = "pending_acquisition"  # another plan step will produce a document
    MISSING = "missing"  # mandatory, no owned document, no known acquisition route
    NOT_PROVIDED = "not_provided"  # optional/conditional and not owned (never blocks)


class DependencyReason(StrEnum):
    PREREQUISITE = "prerequisite"
    ACQUISITION = "acquisition"


class BlockerCode(StrEnum):
    MISSING_DOCUMENT_NO_ROUTE = "missing_document_no_route"
    # A known service issues the document, but its verified coverage excludes the citizen's state.
    ROUTE_OUTSIDE_JURISDICTION = "missing_document_route_outside_jurisdiction"
    DEPENDENCY_BLOCKED = "dependency_blocked"


class NoticeCode(StrEnum):
    STARTED_BEFORE_DEPENDENCIES = "started_before_dependencies"
    TARGET_OUTSIDE_JURISDICTION = "target_outside_jurisdiction"
    # Reported started/submitted, but the service is not part of this plan (e.g. the state changed
    # or the document it would issue is no longer needed). Shown, never silently dropped.
    PROGRESS_OUTSIDE_PLAN = "progress_outside_plan"


class ClarificationCode(StrEnum):
    STATE_REQUIRED = "state_required"  # a region-specific service is in play; state unknown


class NextActionType(StrEnum):
    START_SERVICE = "start_service"
    OBTAIN_DOCUMENT = "obtain_document"
    FOLLOW_UP = "follow_up"  # nothing to start: an in-progress process must finish first
    NONE = "none"


class ReasonCode(StrEnum):
    UNBLOCKS_DOWNSTREAM = "unblocks_downstream"
    READY_INDEPENDENT = "ready_independent"
    RESOLVE_BLOCKER = "resolve_blocker"
    AWAIT_IN_PROGRESS = "await_in_progress"
    ALL_COMPLETE = "all_complete"


@dataclass(frozen=True)
class Dependency:
    service_id: str
    reason: DependencyReason
    document_id: str | None = None
    requirement_id: str | None = None
    evidence_ids: tuple[str, ...] = ()  # prerequisite rule, or "service X issues document D"
    acceptance_evidence_ids: tuple[str, ...] = ()  # "this service accepts document D"


@dataclass(frozen=True)
class RequirementStatus:
    requirement_id: str
    service_id: str
    name: str
    kind: Kind
    state: RequirementState
    document_options: tuple[str, ...]
    is_alternative_group: bool
    satisfied_by_document_id: str | None = None
    acquired_via_service_id: str | None = None
    acquired_document_id: str | None = None
    condition: str | None = None
    notes: str | None = None
    evidence_ids: tuple[str, ...] = ()
    # Options the citizen holds but marked expired/invalid/unsure (they do not satisfy it).
    unusable_document_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class PlanStep:
    step_number: int
    stage: int
    service_id: str
    service_name: str
    role: StepRole
    status: StepStatus
    depends_on: tuple[Dependency, ...]
    unblocks: tuple[str, ...]  # direct dependents
    requirements: tuple[RequirementStatus, ...]
    evidence_ids: tuple[str, ...]
    process_state: ProcessState = ProcessState.NOT_STARTED
    authority: str = ""
    region: str | None = None
    # Completion condition: the verified document(s) the service issues when it is done.
    completion_document_ids: tuple[str, ...] = ()
    completion_evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class CompletedService:
    service_id: str
    source: CompletionSource
    output_document_ids: tuple[str, ...]


@dataclass(frozen=True)
class Notice:
    code: NoticeCode
    service_id: str
    message: str
    related_service_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class Clarification:
    code: ClarificationCode
    service_id: str
    region: str | None = None


@dataclass(frozen=True)
class ProgressSummary:
    """Process progress only: documents never count as progress."""

    total_services: int
    completed: int
    completed_user_reported: int
    completed_verified: int
    in_progress: int
    ready: int
    waiting: int
    blocked: int


@dataclass(frozen=True)
class UnusableDocument:
    document_id: str
    state: DocumentState


@dataclass(frozen=True)
class DocumentSummary:
    """Document readiness for the plan's mandatory requirements (separate from progress)."""

    mandatory_requirements: int
    satisfied: int
    will_be_produced: int
    missing: int
    unusable: tuple[UnusableDocument, ...] = ()


@dataclass(frozen=True)
class Blocker:
    code: BlockerCode
    service_id: str
    message: str
    requirement_id: str | None = None
    document_options: tuple[str, ...] = ()
    blocked_by_service_ids: tuple[str, ...] = ()
    route_service_ids: tuple[str, ...] = ()  # out-of-jurisdiction producers, if any
    evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class MissingDocument:
    requirement_id: str
    service_id: str
    document_options: tuple[str, ...]
    acquisition_service_id: str | None  # None => blocker


@dataclass(frozen=True)
class AcquisitionRoute:
    service_id: str  # step that produces the document
    document_id: str
    for_service_id: str
    for_requirement_id: str
    evidence_ids: tuple[str, ...] = ()
    acceptance_evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class Reason:
    code: ReasonCode
    message: str
    unblocks: tuple[str, ...] = ()
    parallel_with: tuple[str, ...] = ()
    documents_used: tuple[str, ...] = ()
    document_options: tuple[str, ...] = ()
    evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class NextAction:
    type: NextActionType
    reason: Reason
    service_id: str | None = None
    requirement_id: str | None = None
    document_options: tuple[str, ...] = ()


@dataclass(frozen=True)
class PlanResult:
    selected_service_ids: tuple[str, ...]
    completed_service_ids: tuple[str, ...]
    steps: tuple[PlanStep, ...]
    parallel_groups: tuple[tuple[str, ...], ...]
    required_documents: tuple[RequirementStatus, ...]
    satisfied_requirements: tuple[RequirementStatus, ...]
    missing_documents: tuple[MissingDocument, ...]
    optional_documents: tuple[RequirementStatus, ...]
    prerequisite_services: tuple[Dependency, ...]
    acquisition_routes: tuple[AcquisitionRoute, ...]
    blockers: tuple[Blocker, ...]
    next_action: NextAction
    evidence: tuple[EvidenceRef, ...]
    completed: tuple[CompletedService, ...] = ()
    progress: ProgressSummary | None = None
    document_summary: DocumentSummary | None = None
    notices: tuple[Notice, ...] = ()
    clarifications: tuple[Clarification, ...] = ()
    citizen_state: str | None = None
