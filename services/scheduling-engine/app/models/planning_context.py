from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class FlexibleModel(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class ShiftType(str, Enum):
    MORNING = "morning"
    DAY = "day"
    EVENING = "evening"


class StaffMember(FlexibleModel):
    id: UUID
    full_name: str | None = None
    is_active: bool
    work_role: str
    scheduling_rule_role: str
    hourly_rate: Decimal
    is_wildcard_fill_in: bool
    is_initial_training_mentor: bool
    default_weekly_budget_shifts: int | None = None


class Period(FlexibleModel):
    id: UUID
    start_date: date
    end_date: date
    monthly_staff_budget_eur: Decimal | None = None


class Shift(FlexibleModel):
    id: UUID
    period_id: UUID
    shift_date: date
    shift_type: ShiftType
    start_time: time | None = None
    end_time: time | None = None
    is_optional: bool
    required_count: int


class EmploymentContract(FlexibleModel):
    id: UUID
    staff_id: UUID
    start_date: date
    end_date: date | None = None
    min_shifts_per_week: int
    target_shifts_per_week: int
    max_shifts_per_week: int
    standard_shift_hours: Decimal


class TrainingStatus(FlexibleModel):
    staff_id: UUID
    phase: str


class AvailabilityDay(FlexibleModel):
    staff_id: UUID
    available_date: date
    morning: bool
    day: bool
    evening: bool
    submission_id: UUID | None = None


class AvailabilitySubmission(FlexibleModel):
    staff_id: UUID
    period_id: UUID
    status: str
    willing_to_work_above_target: bool
    max_extra_shifts_for_period: int | None = None


class ApprovedException(FlexibleModel):
    rule_id: str
    exception_type: str
    staff_id: UUID | None = None
    shift_id: UUID | None = None
    week_start: date | None = None
    approved: bool
    reason: str | None = None
    approved_by: str | None = None
    approved_at: datetime | None = None


class PlanningSettings(FlexibleModel):
    block_evening_to_next_morning: bool = False
    default_hard_max_consecutive_days: int | None = None
    default_soft_max_consecutive_days: int | None = None


class PlanningContext(FlexibleModel):
    staff: list[StaffMember] = Field(default_factory=list)
    period: Period
    shifts: list[Shift] = Field(default_factory=list)
    budgets: list[dict[str, object]] = Field(default_factory=list)
    settings: PlanningSettings = Field(default_factory=PlanningSettings)
    training: list[TrainingStatus] = Field(default_factory=list)
    contracts: list[EmploymentContract] = Field(default_factory=list)
    period_id: UUID | None = None
    role_rules: list[dict[str, object]] = Field(default_factory=list)
    diagnostics: dict[str, object] = Field(default_factory=dict)
    preferences: list[dict[str, object]] = Field(default_factory=list)
    generated_at: datetime | None = None
    context_version: int | None = None
    availability_days: list[AvailabilityDay] = Field(default_factory=list)
    holiday_exemptions: list[dict[str, object]] = Field(default_factory=list)
    availability_submissions: list[AvailabilitySubmission] = Field(
        default_factory=list
    )
    approved_exceptions: list[ApprovedException] = Field(default_factory=list)
