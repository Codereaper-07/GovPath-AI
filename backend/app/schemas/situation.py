from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SituationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=3, max_length=2000)
    language: Literal["en", "hi"] = "en"


class SituationOut(BaseModel):
    """AI-extracted facts. Labelled AI-generated: the citizen reviews them before discovery."""

    generated_by: str = "ai"
    label: str = "AI interpretation: review before using"
    model: str
    goals: list[str]
    life_events: list[str]
    state: str | None
    held_document_ids: list[str]
    lacking_document_ids: list[str]
    document_states: dict[str, str] = {}  # held document -> expired | invalid | unsure
    completed_service_ids: list[str]
    unknowns: list[str]
    dropped: list[str]
