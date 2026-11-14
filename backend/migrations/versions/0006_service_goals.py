"""Citizen goals served by each government service (JSON list, default empty).

Revision ID: 0006_service_goals
Revises: 0005_life_events
Create Date: 2026-11-14 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_service_goals"
down_revision: str | None = "0005_life_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "government_services",
        sa.Column(
            "goals",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            server_default="[]",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("government_services", "goals")
