from enum import StrEnum


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
