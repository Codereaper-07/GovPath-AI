"""Automatic document expiry: idempotency marker + the `document_expired` activity type.

Additive only: one nullable column on `vault_documents` and a wider CHECK constraint on
`activity_events.event_type`. Existing rows are unchanged.

Revision ID: 0009_document_expiry
Revises: 0008_account_data
Create Date: 2026-11-15 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_document_expiry"
down_revision: str | None = "0008_account_data"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = (
    "document_added", "document_updated", "document_removed", "plan_created", "plan_updated",
    "plan_archived", "plan_restored", "plan_deleted", "plan_recalculated", "progress_changed",
)  # fmt: skip
NEW = (*OLD, "document_expired")  # OLD kept for reference
CK = "ck_activity_events_activity_type"


def _check(values: tuple[str, ...]) -> str:
    return "event_type IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    with op.batch_alter_table("vault_documents") as batch:
        batch.add_column(sa.Column("expiry_processed_for", sa.Date(), nullable=True))
    if op.get_bind().dialect.name == "postgresql":
        # op.f(): the name is already final (do not apply the naming convention again).
        op.drop_constraint(op.f(CK), "activity_events", type_="check")
        op.create_check_constraint(op.f(CK), "activity_events", _check(NEW))


def downgrade() -> None:
    # The wider event-type constraint is kept: history is append-only, so `document_expired`
    # events that already exist must stay valid.
    with op.batch_alter_table("vault_documents") as batch:
        batch.drop_column("expiry_processed_for")
