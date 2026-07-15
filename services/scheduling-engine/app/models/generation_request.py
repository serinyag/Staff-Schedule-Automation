from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.models.planning_context import FlexibleModel, PlanningContext


class DiagnosticsLevel(str, Enum):
    SUMMARY = "summary"
    DETAILED = "detailed"


class EngineConfiguration(FlexibleModel):
    model_config = ConfigDict(extra="forbid")

    max_solve_seconds: int = Field(default=30, ge=1, le=120)
    random_seed: int = 42
    include_shadow_assignments: bool = True
    diagnostics_level: DiagnosticsLevel = DiagnosticsLevel.SUMMARY


class GenerateScheduleRequest(FlexibleModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "generation_run_id": "56a5944b-286d-4a9c-bc2c-6f89739ed2b1",
                "period_id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
                "rules_version": "2",
                "planning_context": {
                    "period": {
                        "id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
                        "start_date": "2026-07-06",
                        "end_date": "2026-07-12",
                        "monthly_staff_budget_eur": 12000,
                    },
                    "staff": [],
                    "shifts": [],
                    "training": [],
                    "contracts": [],
                    "availability_days": [],
                    "availability_submissions": [],
                },
                "engine_configuration": {
                    "max_solve_seconds": 30,
                    "random_seed": 42,
                    "include_shadow_assignments": True,
                    "diagnostics_level": "summary",
                },
            }
        },
    )

    generation_run_id: UUID
    period_id: UUID
    rules_version: str = Field(min_length=1)
    planning_context: PlanningContext
    engine_configuration: EngineConfiguration = Field(
        default_factory=EngineConfiguration
    )

    @field_validator("rules_version")
    @classmethod
    def validate_rules_version(cls, value: str) -> str:
        normalized = value.strip()
        if normalized != "2":
            raise ValueError("rules_version must be compatible with rules version 2.")
        return normalized

    @model_validator(mode="after")
    def validate_period_alignment(self) -> "GenerateScheduleRequest":
        context_period_id = self.planning_context.period_id or self.planning_context.period.id
        if context_period_id != self.period_id:
            raise ValueError("period_id must match planning_context.period_id.")
        return self
