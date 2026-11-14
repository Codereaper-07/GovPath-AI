"""User-owned account data: document vault, service progress, saved plans, activity history.

All four tables are owned by a Supabase Auth user (`user_id` -> `auth.users(id)` ON DELETE
CASCADE on Supabase). RLS is enabled; through Supabase's Data API a signed-in user can only
SELECT their own rows and nobody can write (the FastAPI backend, connecting as the table owner,
validates input and takes the user id from the verified token). `activity_events` is
append-only: a trigger rejects UPDATE for every role, including the backend.

Revision ID: 0008_account_data
Revises: 0007_citizen_profiles
Create Date: 2026-11-15 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_account_data"
down_revision: str | None = "0007_citizen_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("vault_documents", "service_progress", "user_plans", "activity_events")
API_ROLES = ("anon", "authenticated")
JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True, length=32)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)
        for name in ("created_at", "updated_at")
    ]


def _scalar(sql: str) -> object:
    return op.get_bind().execute(sa.text(sql)).scalar()


def upgrade() -> None:
    op.create_table(
        "vault_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("document_type", sa.String(length=100), nullable=False),
        sa.Column(
            "status", _enum("vault_document_status", "valid", "expired", "invalid", "unsure"),
            nullable=False,
        ),
        sa.Column("label", sa.String(length=80), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("note", sa.String(length=280), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vault_documents")),
    )  # fmt: skip
    op.create_index(op.f("ix_vault_documents_user_id"), "vault_documents", ["user_id"])

    op.create_table(
        "service_progress",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("service_id", sa.String(length=100), nullable=False),
        sa.Column(
            "state", _enum("reported_progress", "started", "submitted", "completed"),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("user_id", "service_id", name=op.f("pk_service_progress")),
    )  # fmt: skip

    op.create_table(
        "user_plans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=True),
        sa.Column("status", _enum("plan_status", "active", "archived"), nullable=False),
        sa.Column("target_service_ids", JSON, nullable=False),
        sa.Column("goals", JSON, nullable=False),
        sa.Column("citizen_state", sa.String(length=64), nullable=True),
        sa.Column("snapshot", JSON, nullable=True),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evaluation_error", sa.String(length=40), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_plans")),
    )
    op.create_index(op.f("ix_user_plans_user_id"), "user_plans", ["user_id"])

    op.create_table(
        "activity_events",
        sa.Column(
            "id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True,
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "event_type",
            _enum(
                "activity_type", "document_added", "document_updated", "document_removed",
                "plan_created", "plan_updated", "plan_archived", "plan_restored", "plan_deleted",
                "plan_recalculated", "progress_changed",
            ),
            nullable=False,
        ),
        sa.Column("entity_type", sa.String(length=20), nullable=False),
        sa.Column("entity_id", sa.String(length=100), nullable=True),
        sa.Column("details", JSON, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activity_events")),
    )  # fmt: skip
    op.create_index("ix_activity_events_user_id_id", "activity_events", ["user_id", "id"])

    if op.get_bind().dialect.name != "postgresql":
        return

    has_auth = bool(_scalar("select to_regclass('auth.users') is not null"))
    roles = [r for r in API_ROLES if _scalar(f"select 1 from pg_roles where rolname = '{r}'")]
    for table in TABLES:
        if has_auth:
            op.execute(
                f"alter table public.{table} add constraint fk_{table}_user_id_users "
                "foreign key (user_id) references auth.users (id) on delete cascade"
            )
        op.execute(f"alter table public.{table} enable row level security")
        if roles:
            op.execute(f"revoke all on table public.{table} from {', '.join(roles)}")
        if has_auth and "authenticated" in roles:
            op.execute(f"grant select on table public.{table} to authenticated")
            op.execute(
                f'create policy "{table}_select_own" on public.{table} for select '
                "to authenticated using ((select auth.uid()) = user_id)"
            )
    if roles:
        op.execute(f"revoke all on all sequences in schema public from {', '.join(roles)}")

    # Append-only history: no role (not even the table owner) may rewrite an event.
    op.execute(
        """
        create function public.activity_events_append_only() returns trigger
        language plpgsql set search_path = '' as $$
        begin
          raise exception 'activity history is append-only';
        end;
        $$
        """
    )
    op.execute(
        "create trigger activity_events_no_update before update on public.activity_events "
        "for each row execute function public.activity_events_append_only()"
    )
    op.execute("revoke all on function public.activity_events_append_only() from public")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("drop trigger if exists activity_events_no_update on public.activity_events")
        op.execute("drop function if exists public.activity_events_append_only()")
    for table in reversed(TABLES):
        op.drop_table(table)
