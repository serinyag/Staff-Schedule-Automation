from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from ortools.sat.python import cp_model

from app.generator.context import build_indexed_context
from app.generator.diagnostics import (
    build_manager_review_suggestions,
    build_minimum_shortfall_diagnostics,
    build_uncovered_shift_diagnostics,
    cents_to_float,
)
from app.generator.eligibility import build_candidate_assignments
from app.generator.model import SolverArtifacts, build_solver_artifacts
from app.generator.objectives import solve_stage
from app.models import (
    DraftAssignment,
    DraftPlanResult,
    GenerateScheduleRequest,
    GenerateScheduleResponse,
    GenerationStatus,
    PlannerDiagnostics,
    SolverSummary,
    WeeklySummaryRow,
)
from app.shared import counts_toward_coverage, week_start
from app.validator import validate_schedule

PLANNER_VERSION = "wnc-generator-v1-cp-sat"
ASSIGNMENT_SOURCE = "railway_generator_v1"
QUALITY_WEIGHTS = {
    "isolated_day": 4,
    "full_weekend": 3,
    "manager_usage": 1,
}
ALLOWED_SHORTFALL_ERRORS = {
    ("WNC-HARD-003", "weekly_minimum_not_met"),
    ("WNC-HARD-007", "mandatory_shift_uncovered"),
}


class GeneratorInvariantError(RuntimeError):
    def __init__(self, details: dict[str, object]) -> None:
        super().__init__("Generated draft failed invariant validation.")
        self.details = details


@dataclass(frozen=True)
class GenerationComputation:
    response: GenerateScheduleResponse
    solver_runtime_seconds: float


def _build_stage_objectives(artifacts: SolverArtifacts) -> list[tuple[str, cp_model.LinearExpr]]:
    return [
        (
            "mandatory_coverage_shortfall",
            sum(artifacts.coverage_shortfall_by_shift_id.values())
            if artifacts.coverage_shortfall_by_shift_id
            else 0,
        ),
        (
            "weekly_minimum_shortfall",
            sum(
                state.min_shortfall
                for state in artifacts.weekly_state_by_staff_week.values()
                if state.min_shortfall is not None
            )
            if artifacts.weekly_state_by_staff_week
            else 0,
        ),
        (
            "weekly_target_shortfall",
            sum(
                state.target_shortfall
                for state in artifacts.weekly_state_by_staff_week.values()
                if state.target_shortfall is not None
            )
            if artifacts.weekly_state_by_staff_week
            else 0,
        ),
        ("above_target_usage", artifacts.total_above_target_usage),
        (
            "schedule_quality",
            QUALITY_WEIGHTS["isolated_day"] * sum(artifacts.isolated_day_flags)
            + QUALITY_WEIGHTS["full_weekend"] * sum(artifacts.full_weekend_flags)
            + QUALITY_WEIGHTS["manager_usage"] * sum(artifacts.manager_usage_flags)
            if (
                artifacts.isolated_day_flags
                or artifacts.full_weekend_flags
                or artifacts.manager_usage_flags
            )
            else 0,
        ),
    ]


def _derive_generation_status(
    final_status_name: str,
    *,
    uncovered_count: int,
    minimum_shortfall_count: int,
    validation_valid: bool,
) -> GenerationStatus:
    if final_status_name == "MODEL_INVALID":
        return GenerationStatus.MODEL_INVALID
    if final_status_name == "INFEASIBLE":
        return GenerationStatus.INFEASIBLE
    if final_status_name == "UNKNOWN":
        return GenerationStatus.TIMEOUT
    if uncovered_count > 0 or minimum_shortfall_count > 0:
        return GenerationStatus.NEEDS_MANAGER_REVIEW
    if validation_valid and final_status_name == "OPTIMAL":
        return GenerationStatus.OPTIMAL
    return GenerationStatus.FEASIBLE


def _planning_reason(assignment: DraftAssignment) -> str:
    if assignment.assignment_kind == "shadow":
        if assignment.shift_type and assignment.shift_type.value == "day":
            return "optional_day_for_weekly_minimum"
        return "weekly_minimum_shadow_training"
    if assignment.shift_type and assignment.shift_type.value == "day":
        return "optional_day_for_weekly_minimum"
    return "mandatory_coverage"


def _extract_assignments(
    artifacts: SolverArtifacts,
    solver: cp_model.CpSolver,
) -> tuple[
    list[DraftAssignment],
    dict[UUID, int],
    dict[tuple[UUID, date], int],
    dict[tuple[UUID, date], int],
]:
    assignments: list[DraftAssignment] = []
    assigned_coverage_counts: dict[UUID, int] = {}
    weekly_assignments: dict[tuple[UUID, date], int] = {}
    weekly_candidate_slots: dict[tuple[UUID, date], int] = {}
    for candidate in artifacts.candidates:
        weekly_candidate_slots[(candidate.staff_id, candidate.week_start)] = (
            weekly_candidate_slots.get((candidate.staff_id, candidate.week_start), 0) + 1
        )
        variable = artifacts.candidate_variables[
            (candidate.staff_id, candidate.shift_id, candidate.assignment_kind)
        ]
        if solver.Value(variable) != 1:
            continue
        assignment = DraftAssignment(
            shift_id=candidate.shift_id,
            staff_member_id=candidate.staff_id,
            staff_name=candidate.staff.full_name or str(candidate.staff_id),
            shift_date=candidate.shift.shift_date,
            shift_type=candidate.shift.shift_type,
            start_time=candidate.shift.start_time,
            end_time=candidate.shift.end_time,
            week_start=candidate.week_start,
            assignment_lifecycle="draft",
            assignment_source=ASSIGNMENT_SOURCE,
            assignment_kind=candidate.assignment_kind,
            is_exception=candidate.uses_exception,
        )
        assignment.planning_reason = _planning_reason(assignment)
        assignments.append(assignment)
        weekly_assignments[(candidate.staff_id, candidate.week_start)] = (
            weekly_assignments.get((candidate.staff_id, candidate.week_start), 0) + 1
        )
        if counts_toward_coverage(candidate.assignment_kind):
            assigned_coverage_counts[candidate.shift_id] = (
                assigned_coverage_counts.get(candidate.shift_id, 0) + 1
            )

    assignments.sort(
        key=lambda assignment: (
            assignment.shift_date,
            assignment.start_time.isoformat() if assignment.start_time else "",
            assignment.shift_type.value if assignment.shift_type else "",
            assignment.assignment_kind,
            str(assignment.staff_id),
        )
    )
    return assignments, assigned_coverage_counts, weekly_assignments, weekly_candidate_slots


def _build_weekly_summary(
    indexed_context,
    assignments: list[DraftAssignment],
    weekly_assignments: dict[tuple[UUID, date], int],
    assignment_costs_by_staff_week: dict[tuple[UUID, date], int],
) -> list[WeeklySummaryRow]:
    all_weeks = sorted(
        set(indexed_context.complete_weeks)
        | set(indexed_context.partial_weeks)
        | set(indexed_context.shifts_by_iso_week)
    )
    by_staff_week_kind: dict[tuple[UUID, date, str], int] = {}
    assigned_dates_by_staff_week: dict[tuple[UUID, date], list[date]] = {}
    for assignment in assignments:
        current_week_start = assignment.week_start or week_start(assignment.shift_date)
        by_staff_week_kind[(assignment.staff_id, current_week_start, assignment.assignment_kind)] = (
            by_staff_week_kind.get(
                (assignment.staff_id, current_week_start, assignment.assignment_kind),
                0,
            )
            + 1
        )
        assigned_dates_by_staff_week.setdefault(
            (assignment.staff_id, current_week_start),
            [],
        ).append(assignment.shift_date)

    rows: list[WeeklySummaryRow] = []
    for staff in indexed_context.ordered_staff:
        for current_week_start in all_weeks:
            contract = next(
                (
                    contract
                    for contract in indexed_context.contract_lists_by_staff_id.get(staff.id, [])
                    if contract.start_date <= current_week_start + timedelta(days=6)
                    and (contract.end_date is None or contract.end_date >= current_week_start)
                ),
                None,
            )
            assigned_count = weekly_assignments.get((staff.id, current_week_start), 0)
            coverage_count = by_staff_week_kind.get(
                (staff.id, current_week_start, "coverage"),
                0,
            )
            shadow_count = by_staff_week_kind.get(
                (staff.id, current_week_start, "shadow"),
                0,
            )
            if contract is None:
                status = "exempt"
                min_shifts = None
                target = None
                max_shifts = None
                min_shortfall = 0
                target_shortfall = 0
            else:
                min_shifts = contract.min_shifts_per_week
                target = contract.target_shifts_per_week
                max_shifts = contract.max_shifts_per_week
                holiday_exemption = indexed_context.holiday_exemptions_by_staff_week.get(
                    (staff.id, current_week_start)
                )
                effective_min = 0 if holiday_exemption and holiday_exemption.get("waive_minimum") is True else min_shifts
                min_shortfall = max(0, effective_min - assigned_count)
                target_shortfall = max(0, target - assigned_count)
                if current_week_start in indexed_context.complete_weeks and min_shortfall > 0:
                    status = "below_minimum"
                elif assigned_count >= max_shifts:
                    status = "at_max"
                elif assigned_count > target:
                    status = "above_target_with_consent"
                elif assigned_count == target:
                    status = "at_target"
                else:
                    status = "below_target"
            rows.append(
                WeeklySummaryRow(
                    week_start=current_week_start,
                    complete_week=current_week_start in indexed_context.complete_weeks,
                    staff_member_id=staff.id,
                    staff_name=staff.full_name or str(staff.id),
                    assigned_shift_count=assigned_count,
                    coverage_assignment_count=coverage_count,
                    shadow_assignment_count=shadow_count,
                    min_shifts_per_week=min_shifts,
                    target_shifts_per_week=target,
                    max_shifts_per_week=max_shifts,
                    minimum_shortfall=min_shortfall,
                    target_shortfall=target_shortfall,
                    above_target_count=max(0, assigned_count - (target or 0)),
                    assigned_dates=sorted(
                        set(assigned_dates_by_staff_week.get((staff.id, current_week_start), []))
                    ),
                    estimated_labor_cost_eur=cents_to_float(
                        assignment_costs_by_staff_week.get((staff.id, current_week_start), 0)
                    ),
                    status=status,
                )
            )
    return rows


def _detect_validation_mismatch(validation) -> dict[str, object] | None:
    unexpected_errors = [
        {
            "rule_id": issue.rule_id,
            "code": issue.code,
            "message": issue.message,
            "details": issue.details,
        }
        for issue in validation.errors
        if (issue.rule_id, issue.code) not in ALLOWED_SHORTFALL_ERRORS
    ]
    if not unexpected_errors:
        return None
    return {
        "error": "generator_validation_mismatch",
        "message": "Generated draft violated a hard invariant during internal validation.",
        "violations": unexpected_errors,
    }


def generate_schedule(
    payload: GenerateScheduleRequest,
    *,
    engine_version: str,
    rules_version: str,
) -> GenerationComputation:
    indexed_context = build_indexed_context(payload.planning_context)
    started_at = time.monotonic()
    deadline_monotonic = started_at + payload.engine_configuration.max_solve_seconds
    candidates, missing_primary_reasons_by_shift = build_candidate_assignments(
        indexed_context,
        include_shadow_assignments=payload.engine_configuration.include_shadow_assignments,
    )
    artifacts = build_solver_artifacts(indexed_context, candidates)
    objective_values: dict[str, int] = {}
    solver_result = None

    for stage_name, objective_expr in _build_stage_objectives(artifacts):
        stage_result = solve_stage(
            artifacts.model,
            stage_name,
            objective_expr,
            deadline_monotonic=deadline_monotonic,
            random_seed=payload.engine_configuration.random_seed,
        )
        objective_values[stage_name] = stage_result.objective_value
        solver_result = stage_result
        if stage_result.status_name not in {"OPTIMAL", "FEASIBLE"}:
            break

    if solver_result is None:
        raise RuntimeError("No solver stage executed.")

    solver = solver_result.solver
    final_status_name = solver_result.status_name
    assignments: list[DraftAssignment] = []
    assigned_coverage_counts: dict[UUID, int] = {}
    weekly_assignments: dict[tuple[UUID, date], int] = {}
    weekly_candidate_slots: dict[tuple[UUID, date], int] = {}
    assignment_costs_by_staff_week: dict[tuple[UUID, date], int] = {}
    shortfall_by_shift_id = {
        shift_id: solver.Value(variable)
        for shift_id, variable in artifacts.coverage_shortfall_by_shift_id.items()
    } if final_status_name in {"OPTIMAL", "FEASIBLE"} else {}
    weekly_min_shortfalls = {
        key: solver.Value(state.min_shortfall)
        for key, state in artifacts.weekly_state_by_staff_week.items()
        if state.min_shortfall is not None
    } if final_status_name in {"OPTIMAL", "FEASIBLE"} else {}

    if final_status_name in {"OPTIMAL", "FEASIBLE"}:
        (
            assignments,
            assigned_coverage_counts,
            weekly_assignments,
            weekly_candidate_slots,
        ) = _extract_assignments(artifacts, solver)
        for candidate in artifacts.candidates:
            variable = artifacts.candidate_variables[
                (candidate.staff_id, candidate.shift_id, candidate.assignment_kind)
            ]
            if solver.Value(variable) != 1:
                continue
            key = (candidate.staff_id, candidate.week_start)
            assignment_costs_by_staff_week[key] = (
                assignment_costs_by_staff_week.get(key, 0) + candidate.cost_cents
            )

    total_cost_cents = sum(assignment_costs_by_staff_week.values())
    monthly_budget_cents = (
        int(
            (indexed_context.period.monthly_staff_budget_eur * 100).quantize(
                Decimal("1")
            )
        )
        if indexed_context.period.monthly_staff_budget_eur is not None
        else None
    )
    budget_conflict = (
        monthly_budget_cents is not None and total_cost_cents >= monthly_budget_cents
    )

    uncovered_shifts = build_uncovered_shift_diagnostics(
        indexed_context,
        assigned_coverage_counts,
        shortfall_by_shift_id,
        missing_primary_reasons_by_shift,
        budget_conflict=budget_conflict,
    )
    minimum_shortfalls = build_minimum_shortfall_diagnostics(
        indexed_context,
        weekly_assignments,
        weekly_min_shortfalls,
        weekly_candidate_slots,
        budget_conflict=budget_conflict,
    )
    manager_review_suggestions = build_manager_review_suggestions(
        uncovered_shifts,
        minimum_shortfalls,
    )

    validation = validate_schedule(
        planning_context=payload.planning_context,
        assignments=assignments,
        engine_version=engine_version,
        rules_version=rules_version,
    )
    mismatch = _detect_validation_mismatch(validation)
    if mismatch is not None:
        raise GeneratorInvariantError(mismatch)

    generation_status = _derive_generation_status(
        final_status_name,
        uncovered_count=sum(item.missing_count for item in uncovered_shifts),
        minimum_shortfall_count=sum(item.shortfall for item in minimum_shortfalls),
        validation_valid=validation.valid,
    )

    weekly_summary = _build_weekly_summary(
        indexed_context,
        assignments,
        weekly_assignments,
        assignment_costs_by_staff_week,
    )

    planner_diagnostics = PlannerDiagnostics(
        planner_version=PLANNER_VERSION,
        generated_at=datetime.now(UTC),
        solver_status=final_status_name,
        solve_time_seconds=time.monotonic() - started_at,
        active_staff_count=sum(1 for staff in indexed_context.ordered_staff if staff.is_active),
        shift_count=len(indexed_context.ordered_shifts),
        mandatory_shift_count=sum(1 for shift in indexed_context.ordered_shifts if not shift.is_optional),
        optional_shift_count=sum(1 for shift in indexed_context.ordered_shifts if shift.is_optional),
        assignment_count=len(assignments),
        coverage_assignment_count=sum(1 for assignment in assignments if assignment.assignment_kind == "coverage"),
        shadow_assignment_count=sum(1 for assignment in assignments if assignment.assignment_kind == "shadow"),
        uncovered_mandatory_count=sum(item.missing_count for item in uncovered_shifts),
        total_weekly_min_shortfall=sum(item.shortfall for item in minimum_shortfalls),
        total_weekly_target_shortfall=sum(row.target_shortfall for row in weekly_summary if row.complete_week),
        estimated_labor_cost_eur=cents_to_float(total_cost_cents),
        monthly_budget_eur=(
            float(indexed_context.period.monthly_staff_budget_eur)
            if indexed_context.period.monthly_staff_budget_eur is not None
            else None
        ),
        estimated_budget_remaining_eur=(
            cents_to_float(monthly_budget_cents - total_cost_cents)
            if monthly_budget_cents is not None
            else None
        ),
        complete_weeks_evaluated=indexed_context.complete_weeks,
        partial_weeks_not_fully_evaluated=indexed_context.partial_weeks,
        applied_exception_count=sum(1 for assignment in assignments if assignment.is_exception),
        objective_values=objective_values,
        deterministic_seed=payload.engine_configuration.random_seed,
        num_search_workers=1,
        no_mentor_ratio_configured=True,
        infeasibility_reasons=sorted(
            {
                code
                for item in uncovered_shifts
                for code in item.reason_codes
            }
            | {
                code
                for item in minimum_shortfalls
                for code in item.reason_codes
            }
        ),
        minimum_shortfalls=minimum_shortfalls,
        budget_conflicts=(
            [
                {
                    "estimated_labor_cost_eur": cents_to_float(total_cost_cents),
                    "monthly_budget_eur": cents_to_float(monthly_budget_cents),
                }
            ]
            if budget_conflict and monthly_budget_cents is not None
            else []
        ),
        constraint_slacks={
            "coverage_shortfall_by_shift_id": {
                str(shift_id): value for shift_id, value in shortfall_by_shift_id.items()
            },
            "weekly_min_shortfall_by_staff_week": {
                f"{staff_id}:{current_week_start.isoformat()}": value
                for (staff_id, current_week_start), value in weekly_min_shortfalls.items()
            },
        },
        applied_exceptions=[
            {
                "staff_member_id": str(assignment.staff_id),
                "shift_id": str(assignment.shift_id),
                "assignment_kind": assignment.assignment_kind,
            }
            for assignment in assignments
            if assignment.is_exception
        ],
    )

    response = GenerateScheduleResponse(
        generation_run_id=payload.generation_run_id,
        period_id=payload.period_id,
        generation_status=generation_status,
        engine_version=engine_version,
        rules_version=rules_version,
        draft_plan=DraftPlanResult(
            assignments=assignments,
            uncovered_shifts=uncovered_shifts,
            manager_review_suggestions=manager_review_suggestions,
            weekly_summary=weekly_summary,
            planner_diagnostics=planner_diagnostics,
        ),
        draft_assignments=assignments,
        validation=validation,
        solver=SolverSummary(
            status=final_status_name,
            wall_time_seconds=planner_diagnostics.solve_time_seconds,
            objective_values=objective_values,
            random_seed=payload.engine_configuration.random_seed,
            num_search_workers=1,
        ),
    )
    return GenerationComputation(
        response=response,
        solver_runtime_seconds=planner_diagnostics.solve_time_seconds,
    )
