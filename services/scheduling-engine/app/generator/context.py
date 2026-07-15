from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

from app.models import (
    ApprovedException,
    AvailabilityDay,
    AvailabilitySubmission,
    EmploymentContract,
    PlanningContext,
    Shift,
    StaffMember,
    TrainingStatus,
)
from app.shared import (
    complete_week_starts,
    partial_week_starts,
    week_start,
)


@dataclass(frozen=True)
class IndexedPlanningContext:
    planning_context: PlanningContext
    staff_by_id: dict[UUID, StaffMember]
    contract_lists_by_staff_id: dict[UUID, list[EmploymentContract]]
    training_by_staff_id: dict[UUID, TrainingStatus]
    availability_by_staff_and_date: dict[tuple[UUID, date], AvailabilityDay]
    submission_by_staff_id: dict[UUID, AvailabilitySubmission]
    shift_by_id: dict[UUID, Shift]
    shifts_by_date: dict[date, list[Shift]]
    shifts_by_iso_week: dict[date, list[Shift]]
    approved_exceptions: list[ApprovedException]
    holiday_exemptions_by_staff_week: dict[tuple[UUID, date], dict[str, Any]]
    complete_weeks: list[date]
    partial_weeks: list[date]
    ordered_staff: list[StaffMember]
    ordered_shifts: list[Shift]

    @property
    def period(self):
        return self.planning_context.period


def _normalize_holiday_exemption(value: dict[str, object]) -> tuple[UUID, date, dict[str, Any]] | None:
    staff_id = value.get("staff_id")
    raw_week_start = value.get("week_start")
    if not isinstance(staff_id, str) or not isinstance(raw_week_start, str):
        return None
    try:
        parsed_staff_id = UUID(staff_id)
        parsed_week_start = date.fromisoformat(raw_week_start)
    except ValueError:
        return None
    return parsed_staff_id, parsed_week_start, dict(value)


def build_indexed_context(planning_context: PlanningContext) -> IndexedPlanningContext:
    ordered_staff = sorted(
        planning_context.staff,
        key=lambda staff_member: (str(staff_member.id), staff_member.full_name or ""),
    )
    ordered_shifts = sorted(
        planning_context.shifts,
        key=lambda shift: (
            shift.shift_date,
            shift.start_time.isoformat() if shift.start_time else "",
            shift.shift_type.value,
            str(shift.id),
        ),
    )

    staff_by_id = {staff_member.id: staff_member for staff_member in ordered_staff}
    contract_lists_by_staff_id: dict[UUID, list[EmploymentContract]] = defaultdict(list)
    for contract in sorted(
        planning_context.contracts,
        key=lambda value: (str(value.staff_id), value.start_date, str(value.id)),
    ):
        contract_lists_by_staff_id[contract.staff_id].append(contract)

    training_by_staff_id = {
        training.staff_id: training
        for training in sorted(
            planning_context.training,
            key=lambda value: (str(value.staff_id), value.phase),
        )
    }

    availability_by_staff_and_date = {
        (availability.staff_id, availability.available_date): availability
        for availability in sorted(
            planning_context.availability_days,
            key=lambda value: (str(value.staff_id), value.available_date),
        )
    }
    submission_by_staff_id = {
        submission.staff_id: submission
        for submission in sorted(
            planning_context.availability_submissions,
            key=lambda value: str(value.staff_id),
        )
        if submission.period_id == planning_context.period.id
    }
    shift_by_id = {shift.id: shift for shift in ordered_shifts}

    shifts_by_date: dict[date, list[Shift]] = defaultdict(list)
    shifts_by_iso_week: dict[date, list[Shift]] = defaultdict(list)
    for shift in ordered_shifts:
        shifts_by_date[shift.shift_date].append(shift)
        shifts_by_iso_week[week_start(shift.shift_date)].append(shift)

    approved_exceptions = sorted(
        [value for value in planning_context.approved_exceptions if value.approved],
        key=lambda value: (
            value.rule_id,
            str(value.staff_id) if value.staff_id else "",
            str(value.shift_id) if value.shift_id else "",
            value.week_start.isoformat() if value.week_start else "",
        ),
    )

    holiday_exemptions_by_staff_week: dict[tuple[UUID, date], dict[str, Any]] = {}
    for value in planning_context.holiday_exemptions:
        normalized = _normalize_holiday_exemption(value)
        if normalized is None:
            continue
        staff_id, current_week_start, payload = normalized
        holiday_exemptions_by_staff_week[(staff_id, current_week_start)] = payload

    return IndexedPlanningContext(
        planning_context=planning_context,
        staff_by_id=staff_by_id,
        contract_lists_by_staff_id=dict(contract_lists_by_staff_id),
        training_by_staff_id=training_by_staff_id,
        availability_by_staff_and_date=availability_by_staff_and_date,
        submission_by_staff_id=submission_by_staff_id,
        shift_by_id=shift_by_id,
        shifts_by_date={key: value for key, value in shifts_by_date.items()},
        shifts_by_iso_week={key: value for key, value in shifts_by_iso_week.items()},
        approved_exceptions=approved_exceptions,
        holiday_exemptions_by_staff_week=holiday_exemptions_by_staff_week,
        complete_weeks=complete_week_starts(
            planning_context.period.start_date,
            planning_context.period.end_date,
        ),
        partial_weeks=partial_week_starts(
            planning_context.period.start_date,
            planning_context.period.end_date,
        ),
        ordered_staff=ordered_staff,
        ordered_shifts=ordered_shifts,
    )
