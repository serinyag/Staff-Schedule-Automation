from __future__ import annotations

from datetime import date, time
from uuid import UUID

from pydantic import AliasChoices, Field, model_validator

from app.models.planning_context import FlexibleModel, ShiftType
from app.shared import (
    CANONICAL_COVERAGE_ASSIGNMENT_KIND,
    canonical_assignment_kind,
)


class DraftAssignment(FlexibleModel):
    shift_id: UUID
    staff_id: UUID = Field(
        validation_alias=AliasChoices("staff_member_id", "staff_id"),
        serialization_alias="staff_member_id",
    )
    staff_name: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    assignment_kind: str = CANONICAL_COVERAGE_ASSIGNMENT_KIND
    assignment_lifecycle: str | None = None
    assignment_source: str | None = None
    is_exception: bool | None = None
    planning_reason: str | None = None
    shift_date: date | None = None
    shift_type: ShiftType | None = None
    week_start: date | None = None

    @model_validator(mode="after")
    def normalize_fields(self) -> "DraftAssignment":
        self.assignment_kind = canonical_assignment_kind(self.assignment_kind)
        if self.assignment_lifecycle is not None:
            self.assignment_lifecycle = self.assignment_lifecycle.lower().strip()
        if self.assignment_source is not None:
            self.assignment_source = self.assignment_source.lower().strip()
        return self


class DraftPlan(FlexibleModel):
    assignments: list[DraftAssignment] = Field(default_factory=list)
