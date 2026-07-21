from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable
from uuid import UUID

from app.models.planning_context import (
    ApprovedException,
    AvailabilityDay,
    EmploymentContract,
    Shift,
    ShiftType,
    TrainingStatus,
)

KNOWN_TRAINING_PHASES = {
    "phase_1_shadow_only",
    "phase_2_can_open",
    "phase_2_opening_independent",
    "phase_3_fully_trained",
}
CANONICAL_COVERAGE_ASSIGNMENT_KIND = "coverage"
CANONICAL_SHADOW_ASSIGNMENT_KIND = "shadow"
PHASE_1 = "phase_1_shadow_only"
PHASE_2 = "phase_2_opening_independent"
PHASE_3 = "phase_3_fully_trained"
TWO_PLACES = Decimal("0.01")
ONE_HUNDRED = Decimal("100")


def canonical_assignment_kind(value: str | None) -> str:
    normalized = (value or "").lower().strip()
    if normalized in {"", "primary", "coverage"}:
        return CANONICAL_COVERAGE_ASSIGNMENT_KIND
    if normalized in {"shadow", "training"}:
        return CANONICAL_SHADOW_ASSIGNMENT_KIND
    return normalized or CANONICAL_COVERAGE_ASSIGNMENT_KIND


def counts_toward_coverage(value: str | None) -> bool:
    return canonical_assignment_kind(value) == CANONICAL_COVERAGE_ASSIGNMENT_KIND


def week_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


def _all_week_starts(period_start: date, period_end: date) -> list[date]:
    starts: list[date] = []
    current = week_start(period_start)
    final = week_start(period_end)
    while current <= final:
        starts.append(current)
        current += timedelta(days=7)
    return starts


def complete_week_starts(period_start: date, period_end: date) -> list[date]:
    return [
        current
        for current in _all_week_starts(period_start, period_end)
        if current >= period_start and current + timedelta(days=6) <= period_end
    ]


def partial_week_starts(period_start: date, period_end: date) -> list[date]:
    complete = set(complete_week_starts(period_start, period_end))
    return [
        current
        for current in _all_week_starts(period_start, period_end)
        if current not in complete
    ]


def active_contracts_for_date(
    contracts: Iterable[EmploymentContract],
    shift_date: date,
) -> list[EmploymentContract]:
    return [
        contract
        for contract in contracts
        if contract.start_date <= shift_date
        and (contract.end_date is None or contract.end_date >= shift_date)
    ]


def contract_for_week(
    contracts: Iterable[EmploymentContract],
    current_week_start: date,
    current_week_end: date,
) -> EmploymentContract | None:
    overlapping = [
        contract
        for contract in contracts
        if contract.start_date <= current_week_end
        and (contract.end_date is None or contract.end_date >= current_week_start)
    ]
    if len(overlapping) == 1:
        return overlapping[0]
    return overlapping[0] if overlapping else None


def training_phase(training: TrainingStatus | None) -> str | None:
    if training is None:
        return None
    phase = training.phase
    if phase == "phase_2_can_open":
        return PHASE_2
    return phase


def is_available_for_shift_type(
    availability: AvailabilityDay | None,
    shift_type: ShiftType,
) -> bool:
    if availability is None:
        return False
    if shift_type is ShiftType.MORNING:
        return availability.morning
    if shift_type is ShiftType.DAY:
        return availability.day
    return availability.evening


def exact_shift_hours(shift: Shift) -> Decimal | None:
    if shift.start_time is None or shift.end_time is None:
        return None
    start_dt = datetime.combine(date(2000, 1, 1), shift.start_time)
    end_dt = datetime.combine(date(2000, 1, 1), shift.end_time)
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)
    total_seconds = Decimal(str((end_dt - start_dt).total_seconds()))
    return (total_seconds / Decimal("3600")).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def assignment_cost_eur(
    *,
    hourly_rate: Decimal,
    standard_shift_hours: Decimal,
    shift: Shift,
) -> Decimal:
    shift_hours = exact_shift_hours(shift) or standard_shift_hours
    return (hourly_rate * shift_hours).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def assignment_cost_cents(
    *,
    hourly_rate: Decimal,
    standard_shift_hours: Decimal,
    shift: Shift,
) -> int:
    eur = assignment_cost_eur(
        hourly_rate=hourly_rate,
        standard_shift_hours=standard_shift_hours,
        shift=shift,
    )
    return int((eur * ONE_HUNDRED).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def has_matching_exception(
    exceptions: Iterable[ApprovedException],
    rule_id: str,
    *,
    staff_id: UUID | None = None,
    shift_id: UUID | None = None,
    current_week_start: date | None = None,
) -> bool:
    for exception in exceptions:
        if not exception.approved or exception.rule_id != rule_id:
            continue
        if exception.staff_id is not None and exception.staff_id != staff_id:
            continue
        if exception.shift_id is not None and exception.shift_id != shift_id:
            continue
        if (
            exception.week_start is not None
            and exception.week_start != current_week_start
        ):
            continue
        return True
    return False
