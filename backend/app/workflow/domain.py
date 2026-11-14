"""Pure domain types for planning. No database, web framework or AI imports."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum


class Kind(StrEnum):
    MANDATORY = "mandatory"
    OPTIONAL = "optional"
    CONDITIONAL = "conditional"


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
    completed_service_ids: tuple[str, ...] = ()


# ---------------------------------------------------------------- results


class StepRole(StrEnum):
    TARGET = "target"
    PREREQUISITE = "prerequisite"
    ACQUISITION = "acquisition"


class StepStatus(StrEnum):
    READY = "ready"
    WAITING = "waiting"
    BLOCKED = "blocked"


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
    DEPENDENCY_BLOCKED = "dependency_blocked"


class NextActionType(StrEnum):
    START_SERVICE = "start_service"
    OBTAIN_DOCUMENT = "obtain_document"
    NONE = "none"


class ReasonCode(StrEnum):
    UNBLOCKS_DOWNSTREAM = "unblocks_downstream"
    READY_INDEPENDENT = "ready_independent"
    RESOLVE_BLOCKER = "resolve_blocker"
    ALL_COMPLETE = "all_complete"


@dataclass(frozen=True)
class Dependency:
    service_id: str
    reason: DependencyReason
    document_id: str | None = None
    requirement_id: str | None = None
    evidence_ids: tuple[str, ...] = ()


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


@dataclass(frozen=True)
class Blocker:
    code: BlockerCode
    service_id: str
    message: str
    requirement_id: str | None = None
    document_options: tuple[str, ...] = ()
    blocked_by_service_ids: tuple[str, ...] = ()


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


@dataclass(frozen=True)
class Reason:
    code: ReasonCode
    message: str
    unblocks: tuple[str, ...] = ()
    parallel_with: tuple[str, ...] = ()
    documents_used: tuple[str, ...] = ()
    document_options: tuple[str, ...] = ()


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
