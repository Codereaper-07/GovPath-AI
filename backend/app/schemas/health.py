from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    app: str
    version: str


class DbHealthResponse(BaseModel):
    status: Literal["ok", "unconfigured", "error"]
    database: str
    pgvector: bool | None = None
    detail: str | None = None
