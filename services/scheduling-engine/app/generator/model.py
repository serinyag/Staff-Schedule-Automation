from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable
from uuid import UUID

from ortools.sat.python import cp_model

from app.generator.context import IndexedPlanningContext
from app.generator.eligibility import CandidateAssignment
from app.shared import PHASE_1, PHASE_2, week_start


@dataclass
class StaffWeekState:
    count: cp_model.IntVar
    min_shortfall: cp_model.IntVar | None = None
    target_shortfall: cp_model.IntVar | None = None
    over_target_usage: cp_model.IntVar | None = None
    effective_min: int = 0
    target: int = 0
    max_shifts: int = 0


@dataclass
class SolverArtifacts:
    model: cp_model.CpModel
    candidate_variables: dict[tuple[UUID, UUID, str], cp_model.IntVar]
    candidates: list[CandidateAssignment]
    coverage_shortfall_by_shift_id: dict[UUID, cp_model.IntVar]
    worked_day_by_staff_date: dict[tuple[UUID, date], cp_model.IntVar]
    weekly_state_by_staff_week: dict[tuple[UUID, date], StaffWeekState]
    total_above_target_usage: cp_model.IntVar
    full_weekend_flags: list[cp_model.IntVar]
    isolated_day_flags: list[cp_model.IntVar]
    manager_usage_flags: list[cp_model.IntVar]
    metadata: dict[str, object] = field(default_factory=dict)


def _sum_or_zero(variables: Iterable[cp_model.IntVar]) -> cp_model.LinearExpr:
    values = list(variables)
    if not values:
        return 0
    return sum(values)


def build_solver_artifacts(
    indexed_context: IndexedPlanningContext,
    candidates: list[CandidateAssignment],
) -> SolverArtifacts:
    model = cp_model.CpModel()
    candidate_variables: dict[tuple[UUID, UUID, str], cp_model.IntVar] = {}
    candidate_by_key = {
        (candidate.staff_id, candidate.shift_id, candidate.assignment_kind): candidate
        for candidate in candidates
    }

    by_shift_and_kind: dict[tuple[UUID, str], list[cp_model.IntVar]] = defaultdict(list)
    by_staff_date: dict[tuple[UUID, date], list[cp_model.IntVar]] = defaultdict(list)
    by_staff_week: dict[tuple[UUID, date], list[cp_model.IntVar]] = defaultdict(list)
    by_staff_shift_type_date: dict[tuple[UUID, date, str], list[cp_model.IntVar]] = defaultdict(list)

    for candidate in candidates:
        key = (candidate.staff_id, candidate.shift_id, candidate.assignment_kind)
        variable = model.NewBoolVar(
            f"{candidate.assignment_kind}_{candidate.staff_id}_{candidate.shift_id}"
        )
        candidate_variables[key] = variable
        by_shift_and_kind[(candidate.shift_id, candidate.assignment_kind)].append(variable)
        by_staff_date[(candidate.staff_id, candidate.shift.shift_date)].append(variable)
        by_staff_week[(candidate.staff_id, candidate.week_start)].append(variable)
        by_staff_shift_type_date[
            (candidate.staff_id, candidate.shift.shift_date, candidate.shift.shift_type.value)
        ].append(variable)

    coverage_shortfall_by_shift_id: dict[UUID, cp_model.IntVar] = {}
    for shift in indexed_context.ordered_shifts:
        coverage_vars = by_shift_and_kind.get((shift.id, "coverage"), [])
        if shift.is_optional:
            model.Add(_sum_or_zero(coverage_vars) <= max(shift.required_count, 1))
            continue
        shortfall = model.NewIntVar(0, shift.required_count, f"shortfall_{shift.id}")
        model.Add(_sum_or_zero(coverage_vars) + shortfall == shift.required_count)
        coverage_shortfall_by_shift_id[shift.id] = shortfall

    worked_day_by_staff_date: dict[tuple[UUID, date], cp_model.IntVar] = {}
    for key, variables in sorted(by_staff_date.items(), key=lambda item: (str(item[0][0]), item[0][1])):
        worked_day = model.NewBoolVar(f"worked_{key[0]}_{key[1]}")
        worked_day_by_staff_date[key] = worked_day
        model.Add(worked_day <= _sum_or_zero(variables))
        for variable in variables:
            model.Add(variable <= worked_day)
        model.Add(_sum_or_zero(variables) <= 1)

    # Evening to next morning rest.
    if indexed_context.planning_context.settings.block_evening_to_next_morning:
        for staff in indexed_context.ordered_staff:
            for current_date in indexed_context.shifts_by_date:
                evening_vars = by_staff_shift_type_date.get(
                    (staff.id, current_date, "evening"),
                    [],
                )
                next_morning_vars = by_staff_shift_type_date.get(
                    (staff.id, current_date + timedelta(days=1), "morning"),
                    [],
                )
                if not evening_vars or not next_morning_vars:
                    continue
                if any(
                    exception.rule_id == "WNC-HARD-010"
                    and exception.staff_id == staff.id
                    and exception.week_start == week_start(current_date + timedelta(days=1))
                    for exception in indexed_context.approved_exceptions
                ):
                    continue
                model.Add(_sum_or_zero(evening_vars) + _sum_or_zero(next_morning_vars) <= 1)

    # Phase pairing.
    for shift in indexed_context.ordered_shifts:
        phase_3_coverage_vars = [
            candidate_variables[(candidate.staff_id, candidate.shift_id, candidate.assignment_kind)]
            for candidate in candidates
            if candidate.shift_id == shift.id
            and candidate.assignment_kind == "coverage"
            and candidate.training_phase not in {PHASE_1, PHASE_2}
        ]
        for candidate in candidates:
            if candidate.shift_id != shift.id:
                continue
            variable = candidate_variables[(candidate.staff_id, candidate.shift_id, candidate.assignment_kind)]
            if candidate.assignment_kind == "shadow":
                model.Add(variable <= _sum_or_zero(phase_3_coverage_vars))
            if (
                candidate.assignment_kind == "coverage"
                and candidate.training_phase == PHASE_2
                and candidate.shift.shift_type.value == "evening"
            ):
                model.Add(variable <= _sum_or_zero(phase_3_coverage_vars))

    weekly_state_by_staff_week: dict[tuple[UUID, date], StaffWeekState] = {}
    total_above_target_terms: list[cp_model.IntVar] = []
    for staff in indexed_context.ordered_staff:
        submission = indexed_context.submission_by_staff_id.get(staff.id)
        willing = bool(submission and submission.willing_to_work_above_target)
        allowance = (
            submission.max_extra_shifts_for_period
            if submission and submission.max_extra_shifts_for_period is not None
            else None
        )
        above_target_override = any(
            exception.rule_id == "WNC-HARD-005"
            and exception.staff_id == staff.id
            for exception in indexed_context.approved_exceptions
        )
        for current_week_start in indexed_context.complete_weeks:
            current_week_end = current_week_start + timedelta(days=6)
            contract = next(
                (
                    contract
                    for contract in indexed_context.contract_lists_by_staff_id.get(staff.id, [])
                    if contract.start_date <= current_week_end
                    and (contract.end_date is None or contract.end_date >= current_week_start)
                ),
                None,
            )
            if contract is None:
                continue
            count_upper_bound = len(by_staff_week.get((staff.id, current_week_start), []))
            count_var = model.NewIntVar(
                0,
                count_upper_bound,
                f"count_{staff.id}_{current_week_start}",
            )
            model.Add(
                count_var
                == _sum_or_zero(by_staff_week.get((staff.id, current_week_start), []))
            )
            holiday_exemption = indexed_context.holiday_exemptions_by_staff_week.get(
                (staff.id, current_week_start)
            )
            effective_min = contract.min_shifts_per_week
            if holiday_exemption:
                if holiday_exemption.get("waive_minimum") is True:
                    effective_min = 0
                elif isinstance(holiday_exemption.get("min_shifts_per_week"), int):
                    effective_min = max(0, holiday_exemption["min_shifts_per_week"])

            min_shortfall = model.NewIntVar(
                0,
                max(effective_min, 0),
                f"min_shortfall_{staff.id}_{current_week_start}",
            )
            target_shortfall = model.NewIntVar(
                0,
                max(contract.target_shifts_per_week, 0),
                f"target_shortfall_{staff.id}_{current_week_start}",
            )
            over_target_usage = model.NewIntVar(
                0,
                max(count_upper_bound, 0),
                f"over_target_{staff.id}_{current_week_start}",
            )
            model.Add(count_var + min_shortfall >= effective_min)
            model.Add(count_var + target_shortfall >= contract.target_shifts_per_week)
            model.Add(count_var - contract.target_shifts_per_week <= over_target_usage)
            model.Add(over_target_usage >= 0)

            max_override = any(
                exception.rule_id == "WNC-HARD-004"
                and exception.staff_id == staff.id
                and exception.week_start == current_week_start
                for exception in indexed_context.approved_exceptions
            )
            if not max_override:
                model.Add(count_var <= contract.max_shifts_per_week)

            if not willing and not above_target_override and allowance is None:
                model.Add(count_var <= contract.target_shifts_per_week)

            weekly_state_by_staff_week[(staff.id, current_week_start)] = StaffWeekState(
                count=count_var,
                min_shortfall=min_shortfall,
                target_shortfall=target_shortfall,
                over_target_usage=over_target_usage,
                effective_min=effective_min,
                target=contract.target_shifts_per_week,
                max_shifts=contract.max_shifts_per_week,
            )
            total_above_target_terms.append(over_target_usage)

        if allowance is not None and not above_target_override:
            staff_over_target_terms = [
                state.over_target_usage
                for (staff_id, _), state in weekly_state_by_staff_week.items()
                if staff_id == staff.id and state.over_target_usage is not None
            ]
            if staff_over_target_terms:
                model.Add(_sum_or_zero(staff_over_target_terms) <= allowance)

    total_above_target_usage = model.NewIntVar(
        0,
        max(len(candidates), 0),
        "total_above_target_usage",
    )
    model.Add(total_above_target_usage == _sum_or_zero(total_above_target_terms))

    hard_limit = indexed_context.planning_context.settings.default_hard_max_consecutive_days
    if hard_limit is not None and hard_limit >= 0:
        for staff in indexed_context.ordered_staff:
            current = indexed_context.period.start_date
            while current + timedelta(days=hard_limit) <= indexed_context.period.end_date:
                window_dates = [
                    current + timedelta(days=offset) for offset in range(hard_limit + 1)
                ]
                if any(
                    exception.rule_id == "WNC-HARD-014"
                    and exception.staff_id == staff.id
                    and exception.week_start == week_start(current)
                    for exception in indexed_context.approved_exceptions
                ):
                    current += timedelta(days=1)
                    continue
                model.Add(
                    _sum_or_zero(
                        worked_day_by_staff_date.get(
                            (staff.id, current_date),
                            model.NewConstant(0),
                        )
                        for current_date in window_dates
                    )
                    <= hard_limit
                )
                current += timedelta(days=1)

    budget = indexed_context.period.monthly_staff_budget_eur
    total_cost_expr = _sum_or_zero(
        candidate.cost_cents
        * candidate_variables[(candidate.staff_id, candidate.shift_id, candidate.assignment_kind)]
        for candidate in candidates
    )
    if budget is not None:
        budget_cents = int((budget * 100).quantize(Decimal("1")))
        model.Add(total_cost_expr <= budget_cents)

    full_weekend_flags: list[cp_model.IntVar] = []
    isolated_day_flags: list[cp_model.IntVar] = []
    manager_usage_flags: list[cp_model.IntVar] = []

    for staff in indexed_context.ordered_staff:
        if "manager" in staff.scheduling_rule_role.lower():
            for shift in indexed_context.ordered_shifts:
                for kind in ("coverage", "shadow"):
                    variable = candidate_variables.get((staff.id, shift.id, kind))
                    if variable is not None:
                        manager_usage_flags.append(variable)

        for current_week_start in indexed_context.complete_weeks:
            saturday = worked_day_by_staff_date.get(
                (staff.id, current_week_start + timedelta(days=5))
            )
            sunday = worked_day_by_staff_date.get(
                (staff.id, current_week_start + timedelta(days=6))
            )
            if saturday is None or sunday is None:
                continue
            weekend_flag = model.NewBoolVar(
                f"full_weekend_{staff.id}_{current_week_start}"
            )
            model.Add(weekend_flag <= saturday)
            model.Add(weekend_flag <= sunday)
            model.Add(weekend_flag >= saturday + sunday - 1)
            full_weekend_flags.append(weekend_flag)

        current_date = indexed_context.period.start_date + timedelta(days=1)
        while current_date < indexed_context.period.end_date:
            center = worked_day_by_staff_date.get((staff.id, current_date))
            if center is None:
                current_date += timedelta(days=1)
                continue
            left = worked_day_by_staff_date.get((staff.id, current_date - timedelta(days=1)))
            right = worked_day_by_staff_date.get((staff.id, current_date + timedelta(days=1)))
            isolated_flag = model.NewBoolVar(f"isolated_{staff.id}_{current_date}")
            model.Add(isolated_flag <= center)
            if left is not None:
                model.Add(isolated_flag + left <= 1)
            if right is not None:
                model.Add(isolated_flag + right <= 1)
            if left is not None and right is not None:
                model.Add(isolated_flag >= center - left - right)
            isolated_day_flags.append(isolated_flag)
            current_date += timedelta(days=1)

    return SolverArtifacts(
        model=model,
        candidate_variables=candidate_variables,
        candidates=candidates,
        coverage_shortfall_by_shift_id=coverage_shortfall_by_shift_id,
        worked_day_by_staff_date=worked_day_by_staff_date,
        weekly_state_by_staff_week=weekly_state_by_staff_week,
        total_above_target_usage=total_above_target_usage,
        full_weekend_flags=full_weekend_flags,
        isolated_day_flags=isolated_day_flags,
        manager_usage_flags=manager_usage_flags,
        metadata={
            "candidate_by_key": candidate_by_key,
            "total_cost_expr": total_cost_expr,
            "by_staff_week": by_staff_week,
        },
    )
