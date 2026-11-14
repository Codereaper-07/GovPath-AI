"""Signed-in citizen's own data: vault documents, reported progress, saved plans, activity.

No schema has a user id field: the owner is always the verified token's subject. Free text
(labels, notes, titles) is rejected when it looks like an identity number (Aadhaar, PAN,
passport, voter ID, long digit runs): GovPath never stores those.
"""

import re
import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import VaultDocumentStatus

ProgressIn = Literal["not_started", "started", "submitted", "completed"]
PlanSource = Literal["proposal", "import", "planner"]

_IDENTITY_PATTERNS = (
    # Aadhaar (12), phone (10), licence/account numbers; dates (<= 8 digits) are allowed.
    re.compile(r"(?:\d[\s\-]?){10,}"),
    re.compile(r"\b[a-z]{5}\s?\d{4}\s?[a-z]\b", re.I),  # PAN
    re.compile(r"\b[a-z]\s?\d{7}\b", re.I),  # passport
    re.compile(r"\b[a-z]{3}\s?\d{7}\b", re.I),  # voter ID (EPIC)
)
IDENTITY_NUMBER_MESSAGE = (
    "Do not enter identity numbers (Aadhaar, PAN, passport, voter ID or other long numbers)."
)


def looks_like_identity_number(text: str) -> bool:
    return any(p.search(text) for p in _IDENTITY_PATTERNS)


def clean_text(v: object) -> object:
    """Trim/collapse whitespace; blank -> None; reject identity numbers."""
    if not isinstance(v, str):
        return v
    v = " ".join(v.split())
    if not v:
        return None
    if looks_like_identity_number(v):
        raise ValueError(IDENTITY_NUMBER_MESSAGE)
    return v


def _check_dates(issue: date | None, expiry: date | None) -> None:
    for d in (issue, expiry):
        if d is not None and not (date(1900, 1, 1) <= d <= date(2100, 12, 31)):
            raise ValueError("dates must be between 1900 and 2100")
    if issue and issue > date.today():
        raise ValueError("the issue date cannot be in the future")
    if issue and expiry and expiry < issue:
        raise ValueError("the expiry date cannot be before the issue date")


# ---------------------------------------------------------------- documents


class _DocumentFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, max_length=80)
    issue_date: date | None = None
    expiry_date: date | None = None
    note: str | None = Field(default=None, max_length=280)

    @field_validator("label", "note", mode="before")
    @classmethod
    def _text(cls, v: object) -> object:
        return clean_text(v)


class VaultDocumentCreate(_DocumentFields):
    document_type: str = Field(min_length=1, max_length=100)
    status: VaultDocumentStatus

    @model_validator(mode="after")
    def _dates(self) -> "VaultDocumentCreate":
        _check_dates(self.issue_date, self.expiry_date)
        return self


class VaultDocumentUpdate(_DocumentFields):
    """Partial update; fields absent from the request are unchanged, null clears."""

    status: VaultDocumentStatus | None = None


class VaultDocumentOut(BaseModel):
    id: uuid.UUID
    document_type: str
    name: str | None  # catalogue display name (None if the catalogue no longer lists the type)
    name_hi: str | None
    status: VaultDocumentStatus  # what the citizen reported
    # What the planner uses: "expired" when a "valid" document's expiry date has passed.
    effective_status: VaultDocumentStatus
    expiry_passed: bool
    label: str | None
    issue_date: date | None
    expiry_date: date | None
    note: str | None
    used_by_plan_ids: list[uuid.UUID]
    created_at: datetime
    updated_at: datetime


class StepChangeOut(BaseModel):
    service_id: str
    before: str | None  # step status, "completed", or None (not in the plan)
    after: str | None


class PlanChangeOut(BaseModel):
    """What a re-evaluation changed in one saved plan (only plans that changed are listed)."""

    plan_id: uuid.UUID
    title: str | None
    steps: list[StepChangeOut]
    blockers_added: list[str]
    blockers_removed: list[str]
    next_action_changed: bool


class DocumentListOut(BaseModel):
    documents: list[VaultDocumentOut]


class DocumentWriteOut(BaseModel):
    document: VaultDocumentOut | None  # None after a delete
    plan_changes: list[PlanChangeOut]


# ---------------------------------------------------------------- progress


class ProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: ProgressIn


class ProgressOut(BaseModel):
    progress: dict[str, str]
    plan_changes: list[PlanChangeOut] = []


# ---------------------------------------------------------------- plans


class HeldDocumentIn(BaseModel):
    """A document the citizen confirmed while reviewing a proposal or importing a device plan.
    Added to the vault only if the vault has no document of that type yet."""

    model_config = ConfigDict(extra="forbid")
    document_type: str = Field(min_length=1, max_length=100)
    status: VaultDocumentStatus = VaultDocumentStatus.VALID


class _PlanFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=120)
    goals: list[str] | None = Field(default=None, max_length=10)
    state: str | None = Field(default=None, max_length=100)
    held_documents: list[HeldDocumentIn] = Field(default_factory=list, max_length=100)

    @field_validator("title", mode="before")
    @classmethod
    def _text(cls, v: object) -> object:
        return clean_text(v)


class PlanCreate(_PlanFields):
    target_service_ids: list[str] = Field(min_length=1, max_length=20)
    source: PlanSource = "proposal"
    # Device-plan import only: applied to services that have no account progress yet.
    progress: dict[str, Literal["started", "submitted", "completed"]] = Field(
        default_factory=dict, max_length=40
    )


class PlanUpdate(_PlanFields):
    target_service_ids: list[str] | None = Field(default=None, min_length=1, max_length=20)


class PlanSummaryOut(BaseModel):
    id: uuid.UUID
    title: str | None
    status: str
    target_service_ids: list[str]
    service_names: dict[str, Any]
    total_services: int
    completed: int
    blocked: int
    ready: int
    next_action: dict[str, Any] | None
    evaluation_error: str | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class DocumentRefOut(BaseModel):
    """Vault documents (by id) that a plan's requirements can use. References, never copies."""

    document_type: str
    vault_document_ids: list[uuid.UUID]
    requirement_ids: list[str]


class PlanDetailOut(PlanSummaryOut):
    goals: list[str]
    citizen_state: str | None
    evaluated_at: datetime | None
    # The deterministic planner's last output (same shape as POST /api/workflows/plan).
    plan: dict[str, Any] | None
    document_refs: list[DocumentRefOut]
    created_document_ids: list[uuid.UUID] = []
    plan_changes: list[PlanChangeOut] = []  # other saved plans changed by this write


class PlanListOut(BaseModel):
    plans: list[PlanSummaryOut]


# ---------------------------------------------------------------- activity


class ActivityEventOut(BaseModel):
    id: int
    event_type: str
    entity_type: str
    entity_id: str | None
    details: dict[str, Any]
    created_at: datetime


class ActivityListOut(BaseModel):
    events: list[ActivityEventOut]
    next_before_id: int | None
