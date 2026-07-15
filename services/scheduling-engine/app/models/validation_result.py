from __future__ import annotations

from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_id: str
    code: str
    severity: Literal["error", "warning", "review"]
    message: str
    staff_id: UUID | None = None
    shift_id: UUID | None = None
    week_start: date | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class ValidationMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignment_count: int
    mandatory_shift_count: int
    covered_mandatory_shift_count: int
    uncovered_mandatory_shift_count: int
    estimated_labor_cost_eur: float
    monthly_budget_eur: float | None = None
    complete_weeks_evaluated: list[date] = Field(default_factory=list)
    partial_weeks_not_fully_evaluated: list[date] = Field(default_factory=list)


class ValidationResponse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "valid": False,
                "ready_for_commit": False,
                "engine_version": "0.3.0",
                "rules_version": "2",
                "errors": [
                    {
                        "rule_id": "WNC-HARD-007",
                        "code": "mandatory_shift_uncovered",
                        "severity": "error",
                        "message": "Mandatory service coverage is below the required count.",
                        "staff_id": None,
                        "shift_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        "week_start": None,
                        "details": {"required_count": 1, "valid_assignment_count": 0},
                    }
                ],
                "warnings": [],
                "review_items": [],
                "metrics": {
                    "assignment_count": 0,
                    "mandatory_shift_count": 1,
                    "covered_mandatory_shift_count": 0,
                    "uncovered_mandatory_shift_count": 1,
                    "estimated_labor_cost_eur": 0,
                    "monthly_budget_eur": 12000,
                    "complete_weeks_evaluated": ["2026-07-06"],
                    "partial_weeks_not_fully_evaluated": [],
                },
            }
        },
    )

    valid: bool
    ready_for_commit: bool
    engine_version: str
    rules_version: str
    errors: list[ValidationIssue] = Field(default_factory=list)
    warnings: list[ValidationIssue] = Field(default_factory=list)
    review_items: list[ValidationIssue] = Field(default_factory=list)
    metrics: ValidationMetrics
