"""SQLAlchemy ORM models. Import every model module here so Alembic autogenerate sees it."""

from app.models.account import ActivityEvent, ServiceProgress, UserPlan, VaultDocument
from app.models.base import Base
from app.models.chunk import SourceChunk
from app.models.document import DocumentType
from app.models.profile import CitizenProfile
from app.models.service import (
    GovernmentService,
    RequirementOption,
    ServiceOutput,
    ServicePrerequisite,
    ServiceRequirement,
    requirement_evidence,
    service_evidence,
)
from app.models.source import Evidence, SourceDocument

__all__ = [
    "ActivityEvent",
    "ServiceProgress",
    "UserPlan",
    "VaultDocument",
    "Base",
    "CitizenProfile",
    "DocumentType",
    "Evidence",
    "GovernmentService",
    "RequirementOption",
    "ServiceOutput",
    "ServicePrerequisite",
    "ServiceRequirement",
    "SourceChunk",
    "SourceDocument",
    "requirement_evidence",
    "service_evidence",
]
