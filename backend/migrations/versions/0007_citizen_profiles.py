"""Citizen profiles (one per Supabase Auth user) and row-level security.

- `profiles.id` is the Supabase Auth user id. On Supabase it references `auth.users(id)` with
  ON DELETE CASCADE, so deleting an account removes its profile.
- RLS is enabled on `profiles`; through Supabase's Data API a signed-in user can only read their
  own row (`auth.uid() = id`) and nobody can write. All writes go through the FastAPI backend,
  which validates input and derives the user id from the verified access token.
- The existing tables were created with Supabase's default grants (full read/write for the
  public `anon` and `authenticated` roles) and no RLS. Publishing the Supabase publishable key in
  the frontend (needed for sign-in) would expose them, so this revision enables RLS on every
  existing table and revokes those roles' privileges. The backend connects as the table owner
  (`postgres`, BYPASSRLS) and is unaffected. No data is changed.

On a plain PostgreSQL database without Supabase's `auth` schema / roles, only the table and RLS
are created.

Revision ID: 0007_citizen_profiles
Revises: 0006_service_goals
Create Date: 2026-11-14 23:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_citizen_profiles"
down_revision: str | None = "0006_service_goals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EXISTING_TABLES = (
    "alembic_version",
    "document_types",
    "evidence",
    "government_services",
    "requirement_evidence",
    "requirement_options",
    "service_evidence",
    "service_outputs",
    "service_prerequisites",
    "service_requirements",
    "source_chunks",
    "source_documents",
)
AUTH_FK = "fk_profiles_id_users"
API_ROLES = ("anon", "authenticated")


def _scalar(sql: str) -> object:
    return op.get_bind().execute(sa.text(sql)).scalar()


def _existing_roles() -> list[str]:
    return [r for r in API_ROLES if _scalar(f"select 1 from pg_roles where rolname = '{r}'")]


def upgrade() -> None:
    op.create_table(
        "profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("full_name", sa.String(length=120), nullable=True),
        sa.Column("state", sa.String(length=64), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column(
            "preferred_language",
            sa.Enum(
                "en", "hi", name="language", native_enum=False, create_constraint=True, length=32
            ),
            server_default="en",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_profiles")),
    )
    if op.get_bind().dialect.name != "postgresql":
        return

    has_auth = bool(_scalar("select to_regclass('auth.users') is not null"))
    roles = _existing_roles()
    if has_auth:
        op.execute(
            f"alter table public.profiles add constraint {AUTH_FK} "
            "foreign key (id) references auth.users (id) on delete cascade"
        )
    op.execute("alter table public.profiles enable row level security")
    if roles:
        op.execute(f"revoke all on table public.profiles from {', '.join(roles)}")
    if has_auth and "authenticated" in roles:
        op.execute("grant select on table public.profiles to authenticated")
        op.execute(
            'create policy "profiles_select_own" on public.profiles for select '
            "to authenticated using ((select auth.uid()) = id)"
        )

    for table in EXISTING_TABLES:
        op.execute(f"alter table public.{table} enable row level security")
        if roles:
            op.execute(f"revoke all on table public.{table} from {', '.join(roles)}")
    if roles:  # id sequences of the knowledge tables
        op.execute(f"revoke all on all sequences in schema public from {', '.join(roles)}")


def downgrade() -> None:
    # Privileges revoked from anon/authenticated are deliberately not re-granted (that would
    # re-open the knowledge base to writes through the public Data API).
    if op.get_bind().dialect.name == "postgresql":
        for table in EXISTING_TABLES:
            op.execute(f"alter table public.{table} disable row level security")
    op.drop_table("profiles")
