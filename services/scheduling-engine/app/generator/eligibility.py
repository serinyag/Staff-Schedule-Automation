from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal
from uuid import UUID

from app.generator.context import IndexedPlanningContext
from app.models import EmploymentContract, Shift, StaffMember
from app.shared import (
    CANONICAL_COVERAGE_ASSIGNMENT_KIND,
    CANONICAL_SHADOW_ASSIGNMENT_KIND,
    PHASE_1,
    PHASE_2,
    PHASE_3,
    active_contracts_for_date,
    assignment_cost_cents,
    has_matching_exception,
    is_available_for_shift_type,
    training_phase,
    week_start,
)

AssignmentMode = Literal["coverage", "shadow"]


@dataclass(frozen=True)
class CandidateAssignment:
    staff_id: UUID
    shift_id: UUID
    assignment_kind: AssignmentMode
    week_start: date
    cost_cents: int
    uses_exception: bool
    contract: EmploymentContract
    staff: StaffMember
    shift: Shift
    training_phase: str | None


def _first_active_contract(
    indexed_context: IndexedPlanningContext,
    staff_id: UUID,
    shift_date: date,
) -> EmploymentContract | None:
    contracts = active_contracts_for_date(
        indexed_context.contract_lists_by_staff_id.get(staff_id, []),
        shift_date,
    )
    if len(contracts) != 1:
        return None
    return contracts[0]


def static_coverage_blockers(
    indexed_context: IndexedPlanningContext,
    staff: StaffMember,
    shift: Shift,
) -> list[str]:
    reasons: list[str] = []
    if not staff.is_active:
        return ["no_active_contracted_candidate"]
    contract = _first_active_contract(indexed_context, staff.id, shift.shift_date)
    if contract is None:
        return ["no_active_contracted_candidate"]
    availability = indexed_context.availability_by_staff_and_date.get(
        (staff.id, shift.shift_date)
    )
    availability_exception = has_matching_exception(
        indexed_context.approved_exceptions,
        "WNC-HARD-006",
        staff_id=staff.id,
        shift_id=shift.id,
    )
    if not availability_exception and not is_available_for_shift_type(
        availability, shift.shift_type
    ):
        return ["no_available_candidate"]
    phase = training_phase(indexed_context.training_by_staff_id.get(staff.id))
    if phase == PHASE_1:
        return ["no_training_eligible_candidate"]
    if phase == PHASE_2 and shift.shift_type.value == "evening":
        phase_3_candidates = [
            other
            for other in indexed_context.ordered_staff
            if other.id != staff.id
            and _is_phase_3_coverage_candidate(indexed_context, other, shift)
        ]
        if not phase_3_candidates:
            return ["no_training_eligible_candidate"]
    return reasons


def static_shadow_blockers(
    indexed_context: IndexedPlanningContext,
    staff: StaffMember,
    shift: Shift,
    *,
    include_shadow_assignments: bool,
) -> list[str]:
    if not include_shadow_assignments:
        return ["no_training_eligible_candidate"]
    if not staff.is_active:
        return ["no_active_contracted_candidate"]
    contract = _first_active_contract(indexed_context, staff.id, shift.shift_date)
    if contract is None:
        return ["no_active_contracted_candidate"]
    availability = indexed_context.availability_by_staff_and_date.get(
        (staff.id, shift.shift_date)
    )
    availability_exception = has_matching_exception(
        indexed_context.approved_exceptions,
        "WNC-HARD-006",
        staff_id=staff.id,
        shift_id=shift.id,
    )
    if not availability_exception and not is_available_for_shift_type(
        availability, shift.shift_type
    ):
        return ["no_available_candidate"]
    phase = training_phase(indexed_context.training_by_staff_id.get(staff.id))
    if phase != PHASE_1:
        return ["no_training_eligible_candidate"]
    phase_3_candidates = [
        other
        for other in indexed_context.ordered_staff
        if other.id != staff.id
        and _is_phase_3_coverage_candidate(indexed_context, other, shift)
    ]
    if not phase_3_candidates:
        return ["phase_1_pairing_capacity"]
    return []


def _is_phase_3_coverage_candidate(
    indexed_context: IndexedPlanningContext,
    staff: StaffMember,
    shift: Shift,
) -> bool:
    if not staff.is_active:
        return False
    contract = _first_active_contract(indexed_context, staff.id, shift.shift_date)
    if contract is None:
        return False
    availability = indexed_context.availability_by_staff_and_date.get(
        (staff.id, shift.shift_date)
    )
    availability_exception = has_matching_exception(
        indexed_context.approved_exceptions,
        "WNC-HARD-006",
        staff_id=staff.id,
        shift_id=shift.id,
    )
    if not availability_exception and not is_available_for_shift_type(
        availability, shift.shift_type
    ):
        return False
    return training_phase(indexed_context.training_by_staff_id.get(staff.id)) == PHASE_3


def build_candidate_assignments(
    indexed_context: IndexedPlanningContext,
    *,
    include_shadow_assignments: bool,
) -> tuple[list[CandidateAssignment], dict[UUID, list[str]]]:
    candidates: list[CandidateAssignment] = []
    missing_primary_reasons_by_shift: dict[UUID, list[str]] = {}

    for shift in indexed_context.ordered_shifts:
        shift_reason_counts: dict[str, int] = {}
        for staff in indexed_context.ordered_staff:
            coverage_blockers = static_coverage_blockers(indexed_context, staff, shift)
            if not coverage_blockers:
                contract = _first_active_contract(indexed_context, staff.id, shift.shift_date)
                assert contract is not None
                candidates.append(
                    CandidateAssignment(
                        staff_id=staff.id,
                        shift_id=shift.id,
                        assignment_kind=CANONICAL_COVERAGE_ASSIGNMENT_KIND,
                        week_start=week_start(shift.shift_date),
                        cost_cents=assignment_cost_cents(
                            hourly_rate=staff.hourly_rate,
                            standard_shift_hours=contract.standard_shift_hours,
                            shift=shift,
                        ),
                        uses_exception=has_matching_exception(
                            indexed_context.approved_exceptions,
                            "WNC-HARD-006",
                            staff_id=staff.id,
                            shift_id=shift.id,
                        ),
                        contract=contract,
                        staff=staff,
                        shift=shift,
                        training_phase=training_phase(
                            indexed_context.training_by_staff_id.get(staff.id)
                        ),
                    )
                )
            else:
                for reason in coverage_blockers:
                    shift_reason_counts[reason] = shift_reason_counts.get(reason, 0) + 1

            shadow_blockers = static_shadow_blockers(
                indexed_context,
                staff,
                shift,
                include_shadow_assignments=include_shadow_assignments,
            )
            if not shadow_blockers:
                contract = _first_active_contract(indexed_context, staff.id, shift.shift_date)
                assert contract is not None
                candidates.append(
                    CandidateAssignment(
                        staff_id=staff.id,
                        shift_id=shift.id,
                        assignment_kind=CANONICAL_SHADOW_ASSIGNMENT_KIND,
                        week_start=week_start(shift.shift_date),
                        cost_cents=assignment_cost_cents(
                            hourly_rate=staff.hourly_rate,
                            standard_shift_hours=contract.standard_shift_hours,
                            shift=shift,
                        ),
                        uses_exception=has_matching_exception(
                            indexed_context.approved_exceptions,
                            "WNC-HARD-006",
                            staff_id=staff.id,
                            shift_id=shift.id,
                        ),
                        contract=contract,
                        staff=staff,
                        shift=shift,
                        training_phase=training_phase(
                            indexed_context.training_by_staff_id.get(staff.id)
                        ),
                    )
                )

        if shift_reason_counts:
            missing_primary_reasons_by_shift[shift.id] = sorted(
                shift_reason_counts,
                key=lambda reason: (-shift_reason_counts[reason], reason),
            )
        else:
            missing_primary_reasons_by_shift[shift.id] = []

    candidates.sort(
        key=lambda candidate: (
            candidate.shift.shift_date,
            candidate.shift.start_time.isoformat() if candidate.shift.start_time else "",
            candidate.shift.shift_type.value,
            candidate.assignment_kind,
            str(candidate.staff_id),
        )
    )
    return candidates, missing_primary_reasons_by_shift
