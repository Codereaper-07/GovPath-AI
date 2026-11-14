"""Enable the pgvector extension.

On Supabase, extensions live in the `extensions` schema (already on the search_path);
elsewhere fall back to the default schema.

Revision ID: 0001_enable_pgvector
Revises:
Create Date: 2026-11-14
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0001_enable_pgvector"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
            CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
          ELSE
            CREATE EXTENSION IF NOT EXISTS vector;
          END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    # Intentionally a no-op: dropping a shared extension could break other objects.
    pass
