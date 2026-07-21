from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    is_initial_training_mentor: bool = False
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


class TrainingRules(FlexibleModel):
    phase_1_assignment_type: Literal["shadow"] = "shadow"
    phase_1_counts_as_primary_coverage: bool = False
    phase_1_requires_same_shift_phase_3: bool = True
    qualified_trainer_phase: str = "phase_3_fully_trained"
    qualified_trainer_work_roles: list[str] = Field(default_factory=lambda: ["*"])
    same_mentor_required: bool = False
    mentor_history_required: bool = False
    designated_initial_mentor_required: bool = False
    initial_mentor_shift_count: int = 0

    @model_validator(mode="after")
    def normalize_rules(self) -> "TrainingRules":
        self.qualified_trainer_phase = (self.qualified_trainer_phase or "").strip() or "phase_3_fully_trained"
        normalized_roles: list[str] = []
        for role in self.qualified_trainer_work_roles:
            normalized = (role or "").strip()
            if not normalized or normalized in normalized_roles:
                continue
            normalized_roles.append(normalized)
        self.qualified_trainer_work_roles = normalized_roles or ["*"]
        self.initial_mentor_shift_count = max(0, int(self.initial_mentor_shift_count))
        return self


class BudgetPolicy(FlexibleModel):
    configured_budget_eur: Decimal | None = None
    allow_overage_for_mandatory_coverage: bool = True
    allow_overage_for_weekly_minimums: bool = True
    allow_overage_for_required_training: bool = True
    allow_overage_for_weekly_targets: bool = False
    allow_overage_for_soft_quality: bool = False
    minimize_required_overage: bool = True
    overage_requires_manager_review: bool = True

    @model_validator(mode="after")
    def normalize_budget_policy(self) -> "BudgetPolicy":
        if self.configured_budget_eur is not None:
            self.configured_budget_eur = Decimal(str(self.configured_budget_eur))
        return self


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
    initial_mentor_shift_count: int | None = 0


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
    training_rules: TrainingRules = Field(default_factory=TrainingRules)
    budget_policy: BudgetPolicy = Field(default_factory=BudgetPolicy)
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

    @model_validator(mode="after")
    def normalize_context(self) -> "PlanningContext":
        if self.budget_policy.configured_budget_eur is None:
            self.budget_policy.configured_budget_eur = self.period.monthly_staff_budget_eur
        return self
