from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class ValidationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    issues: list[ValidationIssue] = Field(default_factory=list)
