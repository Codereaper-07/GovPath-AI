import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, enum_column
from app.models.enums import Language


class CitizenProfile(TimestampMixin, Base):
    """One profile per Supabase Auth user. `id` IS the auth user id (`auth.users.id`).

    On PostgreSQL the migration adds the foreign key to `auth.users` (ON DELETE CASCADE) and
    row-level security; it is not declared here because `auth.users` is owned by Supabase, not
    by this metadata. The API never takes `id` from the client: it comes from the verified token.
    Add new profile fields as plain nullable columns.
    """

    __tablename__ = "profiles"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True)
    full_name: Mapped[str | None] = mapped_column(sa.String(120))
    state: Mapped[str | None] = mapped_column(sa.String(64))  # canonical STATES_AND_UTS name
    city: Mapped[str | None] = mapped_column(sa.String(120))
    preferred_language: Mapped[Language] = mapped_column(
        enum_column(Language, "language"), default=Language.EN, server_default="en"
    )
