from enum import StrEnum


class LifeEvent(StrEnum):
    RELOCATION_IDENTITY = "relocation-identity"
    MARRIAGE_FAMILY = "marriage-family"
    BIRTH_PARENTHOOD = "birth-parenthood"
    EMPLOYMENT_CAREER = "employment-career"
    STARTING_BUSINESS = "starting-business"


class CitizenGoal(StrEnum):
    """What a citizen wants to achieve. Curated classification for service discovery (not a
    government fact): each service lists the goals it directly serves."""

    UPDATE_ADDRESS = "update-address"
    UPDATE_NAME_AFTER_MARRIAGE = "update-name-after-marriage"
    REGISTER_MARRIAGE = "register-marriage"
    ENROL_CHILD_AADHAAR = "enrol-child-aadhaar"
    GET_PAN = "get-pan"


class Jurisdiction(StrEnum):
    NATIONAL = "national"
    STATE = "state"


class DocumentCategory(StrEnum):
    IDENTITY = "identity"
    ADDRESS_PROOF = "address_proof"
    EXISTING_RECORD = "existing_record"  # e.g. the licence/RC/passport being updated
    VEHICLE = "vehicle"
    FINANCIAL = "financial"
    OTHER = "other"


class RequirementType(StrEnum):
    MANDATORY = "mandatory"  # blocks the service until satisfied
    OPTIONAL = "optional"  # helpful; never blocks
    CONDITIONAL = "conditional"  # required only in stated circumstances; never blocks the planner


class VerificationStatus(StrEnum):
    UNVERIFIED = "unverified"  # scraped or entered but not human-checked
    VERIFIED = "verified"  # human-checked against an official source
    NEEDS_REVIEW = "needs_review"  # was verified, but the source content changed since
    REJECTED = "rejected"  # checked and found not to support the claim


class SourceType(StrEnum):
    WEBPAGE = "webpage"
    PDF = "pdf"


class Language(StrEnum):
    """Interface languages a citizen can prefer (matches the frontend's i18n locales)."""

    EN = "en"
    HI = "hi"


class VaultDocumentStatus(StrEnum):
    """The citizen's OWN assessment of a document they hold. GovPath never verifies documents;
    "valid" means "the citizen says it is current and usable", not "officially verified"."""

    VALID = "valid"
    EXPIRED = "expired"
    INVALID = "invalid"
    UNSURE = "unsure"


class ReportedProgress(StrEnum):
    """Service-step progress reported by the citizen (not_started = no row)."""

    STARTED = "started"
    SUBMITTED = "submitted"
    COMPLETED = "completed"


class PlanStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class ActivityType(StrEnum):
    DOCUMENT_ADDED = "document_added"
    DOCUMENT_UPDATED = "document_updated"
    DOCUMENT_REMOVED = "document_removed"
    PLAN_CREATED = "plan_created"
    PLAN_UPDATED = "plan_updated"
    PLAN_ARCHIVED = "plan_archived"
    PLAN_RESTORED = "plan_restored"
    PLAN_DELETED = "plan_deleted"
    PLAN_RECALCULATED = "plan_recalculated"
    PROGRESS_CHANGED = "progress_changed"
