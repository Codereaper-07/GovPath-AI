"""Assistant request/response schemas. Answers are AI-generated explanations, never facts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.workflow import NextActionOut, PlanRequestIn

AI_LABEL = (
    "AI-generated explanation based on official sources. It is not an official government "
    "decision; verify on the official website."
)


class AssistantQueryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=1000)
    language: Literal["en", "hi"] | None = None  # default: detected from the question
    workflow: PlanRequestIn | None = None

    @field_validator("question")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("question is too short")
        return v


class CitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: Literal["official_excerpt", "verified_fact"]
    excerpt: str
    source_url: str
    source_title: str | None
    source_authority: str | None
    source_verified: bool
    page_start: int | None
    page_end: int | None
    section: str | None
    locator: str | None
    similarity: float | None
    evidence_ids: list[str]


class WorkflowStepOut(BaseModel):
    service_id: str
    status: str
    stage: int
    role: str


class WorkflowContextOut(BaseModel):
    """Planner output echoed verbatim (deterministic), never produced by the AI."""

    generated_by: Literal["deterministic-planner"] = "deterministic-planner"
    next_action: NextActionOut
    steps: list[WorkflowStepOut]


class AssistantAnswerOut(BaseModel):
    answer: str
    language: Literal["en", "hi"]
    generated_by: Literal["ai", "none"]
    label: str = AI_LABEL
    model: str | None
    evidence_status: Literal["sufficient", "partial", "insufficient", "conflicting"]
    citations: list[CitationOut]
    retrieval_confidence: Literal["none", "low", "high"]
    best_similarity: float | None
    cached: bool
    workflow: WorkflowContextOut | None = None
