"""User-owned account data: document vault, reported service progress, saved plans, activity.

Every table has `user_id` = the Supabase Auth user id (`auth.users.id`). On PostgreSQL the
migration adds the foreign key to `auth.users` (ON DELETE CASCADE) and row-level security; the
API derives `user_id` from the verified token only and filters every query by it.
"""

import uuid
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONType, TimestampMixin, enum_column
from app.models.enums import ActivityType, PlanStatus, ReportedProgress, VaultDocumentStatus


class VaultDocument(TimestampMixin, Base):
    """A document the citizen says they hold. Independent of plans (plans reference it by
    document type). Never stores identity numbers or files."""

    __tablename__ = "vault_documents"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, index=True)
    document_type: Mapped[str] = mapped_column(sa.String(100))  # catalogue document slug
    status: Mapped[VaultDocumentStatus] = mapped_column(
        enum_column(VaultDocumentStatus, "vault_document_status")
    )
    label: Mapped[str | None] = mapped_column(sa.String(80))  # tells same-type copies apart
    issue_date: Mapped[date | None] = mapped_column(sa.Date)
    expiry_date: Mapped[date | None] = mapped_column(sa.Date)
    note: Mapped[str | None] = mapped_column(sa.String(280))


class ServiceProgress(Base):
    """Progress the citizen reported for a service. A fact about the citizen, shared by every
    plan that contains the service; documents never change it."""

    __tablename__ = "service_progress"

    user_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True)
    service_id: Mapped[str] = mapped_column(sa.String(100), primary_key=True)
    state: Mapped[ReportedProgress] = mapped_column(
        enum_column(ReportedProgress, "reported_progress")
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()
    )


class UserPlan(TimestampMixin, Base):
    """An accepted workflow plan. Inputs (services, goals, state) are stored; the planner output
    is re-computed deterministically and kept as `snapshot` (the full plan response, with
    display names and evidence) so it can still be shown if the catalogue changes later."""

    __tablename__ = "user_plans"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, index=True)
    title: Mapped[str | None] = mapped_column(sa.String(120))
    status: Mapped[PlanStatus] = mapped_column(
        enum_column(PlanStatus, "plan_status"), default=PlanStatus.ACTIVE
    )
    target_service_ids: Mapped[list[str]] = mapped_column(JSONType, default=list)
    goals: Mapped[list[str]] = mapped_column(JSONType, default=list)
    citizen_state: Mapped[str | None] = mapped_column(sa.String(64))
    snapshot: Mapped[dict | None] = mapped_column(JSONType)
    evaluated_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    # Why the last re-evaluation failed (e.g. "catalogue_changed"); the snapshot is kept.
    evaluation_error: Mapped[str | None] = mapped_column(sa.String(40))
    archived_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


class ActivityEvent(Base):
    """Append-only history. No API updates or deletes rows (an UPDATE trigger guards it on
    PostgreSQL); rows go only when the account itself is deleted (cascade)."""

    __tablename__ = "activity_events"
    __table_args__ = (sa.Index("ix_activity_events_user_id_id", "user_id", "id"),)

    id: Mapped[int] = mapped_column(
        sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid)
    event_type: Mapped[ActivityType] = mapped_column(enum_column(ActivityType, "activity_type"))
    entity_type: Mapped[str] = mapped_column(sa.String(20))  # document | plan | service
    entity_id: Mapped[str | None] = mapped_column(sa.String(100))
    details: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
