import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.knowledge.regions import normalise_state
from app.models.enums import Language


class ProfileOut(BaseModel):
    user_id: uuid.UUID
    email: str | None  # from the verified token (Supabase Auth owns it), not stored here
    full_name: str | None
    state: str | None
    city: str | None
    preferred_language: Language
    created_at: datetime
    updated_at: datetime


def _clean(v: object) -> object:
    if isinstance(v, str):
        v = " ".join(v.split())  # trim and collapse whitespace
        return v or None
    return v


class ProfileUpdate(BaseModel):
    """Partial update: only fields present in the request change; null/blank clears a field.

    There is deliberately no user id field (extra keys are rejected): the profile is always
    the caller's own, identified by the verified access token.
    """

    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=64)
    city: str | None = Field(default=None, max_length=120)
    preferred_language: Language | None = None

    @field_validator("full_name", "state", "city", mode="before")
    @classmethod
    def _strip(cls, v: object) -> object:
        return _clean(v)

    @field_validator("state")
    @classmethod
    def _known_state(cls, v: str | None) -> str | None:
        if v is None:
            return None
        canonical = normalise_state(v)
        if canonical is None:
            raise ValueError("unknown state or union territory")
        return canonical
