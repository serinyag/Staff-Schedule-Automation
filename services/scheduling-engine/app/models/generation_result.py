from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.draft_plan import DraftAssignment
from app.models.validation_result import ValidationResponse


class GenerationStatus(str, Enum):
    OPTIMAL = "optimal"
    FEASIBLE = "feasible"
    NEEDS_MANAGER_REVIEW = "needs_manager_review"
    INFEASIBLE = "infeasible"
    TIMEOUT = "timeout"
    MODEL_INVALID = "model_invalid"


class UncoveredShift(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shift_id: UUID
    shift_date: date
    shift_type: str
    required_count: int
    assigned_count: int
    missing_count: int
    reason_codes: list[str] = Field(default_factory=list)
    reason: str


class MinimumShortfallDiagnostic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    staff_member_id: UUID
    week_start: date
    assigned_shift_count: int
    min_shifts_per_week: int
    shortfall: int
    available_candidate_slot_count: int
    reason_codes: list[str] = Field(default_factory=list)
    approved_exception_present: bool = False
    holiday_exemption_present: bool = False


class ManagerReviewSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class WeeklySummaryRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    week_start: date
    complete_week: bool
    staff_member_id: UUID
    staff_name: str
    assigned_shift_count: int
    coverage_assignment_count: int
    shadow_assignment_count: int
    min_shifts_per_week: int | None = None
    target_shifts_per_week: int | None = None
    max_shifts_per_week: int | None = None
    minimum_shortfall: int = 0
    target_shortfall: int = 0
    above_target_count: int = 0
    assigned_dates: list[date] = Field(default_factory=list)
    estimated_labor_cost_eur: float = 0
    status: str


class PlannerDiagnostics(BaseModel):
    model_config = ConfigDict(extra="allow")

    planner_version: str
    generated_at: datetime
    solver_status: str
    solve_time_seconds: float
    active_staff_count: int
    shift_count: int
    mandatory_shift_count: int
    optional_shift_count: int
    assignment_count: int
    coverage_assignment_count: int
    shadow_assignment_count: int
    uncovered_mandatory_count: int
    total_weekly_min_shortfall: int
    total_weekly_target_shortfall: int
    estimated_labor_cost_eur: float
    monthly_budget_eur: float | None = None
    estimated_budget_remaining_eur: float | None = None
    complete_weeks_evaluated: list[date] = Field(default_factory=list)
    partial_weeks_not_fully_evaluated: list[date] = Field(default_factory=list)
    applied_exception_count: int = 0
    objective_values: dict[str, int] = Field(default_factory=dict)
    deterministic_seed: int
    num_search_workers: int = 1
    no_mentor_ratio_configured: bool = False
    infeasibility_reasons: list[str] = Field(default_factory=list)
    minimum_shortfalls: list[MinimumShortfallDiagnostic] = Field(default_factory=list)
    budget_conflicts: list[dict[str, Any]] = Field(default_factory=list)
    constraint_slacks: dict[str, Any] = Field(default_factory=dict)
    applied_exceptions: list[dict[str, Any]] = Field(default_factory=list)


class DraftPlanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignments: list[DraftAssignment] = Field(default_factory=list)
    uncovered_shifts: list[UncoveredShift] = Field(default_factory=list)
    manager_review_suggestions: list[ManagerReviewSuggestion] = Field(default_factory=list)
    weekly_summary: list[WeeklySummaryRow] = Field(default_factory=list)
    planner_diagnostics: PlannerDiagnostics


class SolverSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    wall_time_seconds: float
    objective_values: dict[str, int] = Field(default_factory=dict)
    random_seed: int
    num_search_workers: int


class GenerateScheduleResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_run_id: UUID
    period_id: UUID
    generation_status: GenerationStatus
    engine_version: str
    rules_version: str
    draft_plan: DraftPlanResult
    draft_assignments: list[DraftAssignment] = Field(default_factory=list)
    validation: ValidationResponse
    solver: SolverSummary
