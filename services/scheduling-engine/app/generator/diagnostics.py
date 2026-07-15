from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from app.generator.context import IndexedPlanningContext
from app.models import (
    ManagerReviewSuggestion,
    MinimumShortfallDiagnostic,
    UncoveredShift,
)
from app.shared import PHASE_1, TWO_PLACES


def build_uncovered_shift_diagnostics(
    indexed_context: IndexedPlanningContext,
    assigned_coverage_counts: dict[UUID, int],
    shortfall_by_shift_id: dict[UUID, int],
    missing_primary_reasons_by_shift: dict[UUID, list[str]],
    *,
    budget_conflict: bool,
) -> list[UncoveredShift]:
    diagnostics: list[UncoveredShift] = []
    for shift in indexed_context.ordered_shifts:
        shortfall = shortfall_by_shift_id.get(shift.id, 0)
        if shortfall <= 0:
            continue
        reason_codes = list(missing_primary_reasons_by_shift.get(shift.id, []))
        if not reason_codes and budget_conflict:
            reason_codes = ["budget_conflict"]
        if not reason_codes:
            reason_codes = ["no_valid_primary_candidate"]
        diagnostics.append(
            UncoveredShift(
                shift_id=shift.id,
                shift_date=shift.shift_date,
                shift_type=shift.shift_type.value,
                required_count=shift.required_count,
                assigned_count=assigned_coverage_counts.get(shift.id, 0),
                missing_count=shortfall,
                reason_codes=reason_codes,
                reason="No valid primary candidate remained after applying current hard constraints.",
            )
        )
    return diagnostics


def build_minimum_shortfall_diagnostics(
    indexed_context: IndexedPlanningContext,
    weekly_assignments: dict[tuple[UUID, date], int],
    weekly_min_shortfalls: dict[tuple[UUID, date], int],
    weekly_candidate_slots: dict[tuple[UUID, date], int],
    *,
    budget_conflict: bool,
) -> list[MinimumShortfallDiagnostic]:
    results: list[MinimumShortfallDiagnostic] = []
    for (staff_id, current_week_start), shortfall in sorted(
        weekly_min_shortfalls.items(),
        key=lambda item: (str(item[0][0]), item[0][1]),
    ):
        if shortfall <= 0:
            continue
        contract = next(
            (
                contract
                for contract in indexed_context.contract_lists_by_staff_id.get(staff_id, [])
                if contract.start_date <= current_week_start + timedelta(days=6)
                and (contract.end_date is None or contract.end_date >= current_week_start)
            ),
            None,
        )
        if contract is None:
            continue
        reason_codes: list[str] = []
        available_slots = weekly_candidate_slots.get((staff_id, current_week_start), 0)
        if available_slots == 0:
            if any(
                availability.staff_id == staff_id
                and current_week_start
                <= availability.available_date
                <= current_week_start + timedelta(days=6)
                and (availability.morning or availability.day or availability.evening)
                for availability in indexed_context.availability_by_staff_and_date.values()
            ):
                reason_codes.append("insufficient_valid_shift_slots")
            else:
                reason_codes.append("insufficient_submitted_availability")
        if budget_conflict:
            reason_codes.append("budget_conflict")
        if indexed_context.training_by_staff_id.get(staff_id) and indexed_context.training_by_staff_id[staff_id].phase == PHASE_1:
            reason_codes.append("phase_1_pairing_capacity")
        if not reason_codes:
            reason_codes.append("unresolved_model_tradeoff")
        results.append(
            MinimumShortfallDiagnostic(
                staff_member_id=staff_id,
                week_start=current_week_start,
                assigned_shift_count=weekly_assignments.get((staff_id, current_week_start), 0),
                min_shifts_per_week=contract.min_shifts_per_week,
                shortfall=shortfall,
                available_candidate_slot_count=available_slots,
                reason_codes=sorted(set(reason_codes)),
                approved_exception_present=False,
                holiday_exemption_present=(staff_id, current_week_start)
                in indexed_context.holiday_exemptions_by_staff_week,
            )
        )
    return results


def build_manager_review_suggestions(
    uncovered_shifts: list[UncoveredShift],
    minimum_shortfalls: list[MinimumShortfallDiagnostic],
) -> list[ManagerReviewSuggestion]:
    if not uncovered_shifts and not minimum_shortfalls:
        return []
    suggestions: list[ManagerReviewSuggestion] = []
    reason_codes = {
        code
        for item in uncovered_shifts
        for code in item.reason_codes
    } | {
        code
        for item in minimum_shortfalls
        for code in item.reason_codes
    }
    if "budget_conflict" in reason_codes:
        suggestions.append(
            ManagerReviewSuggestion(
                code="increase_or_reallocate_budget",
                message="Increase or reallocate budget before rerunning generation.",
            )
        )
    if "no_available_candidate" in reason_codes or "insufficient_submitted_availability" in reason_codes:
        suggestions.append(
            ManagerReviewSuggestion(
                code="confirm_additional_availability",
                message="Confirm additional availability submissions for the blocked dates.",
            )
        )
    if "phase_1_pairing_capacity" in reason_codes or "no_training_eligible_candidate" in reason_codes:
        suggestions.append(
            ManagerReviewSuggestion(
                code="add_training_capacity",
                message="Add mentor-compatible capacity or optional training shifts for trainees.",
            )
        )
    if "no_active_contracted_candidate" in reason_codes:
        suggestions.append(
            ManagerReviewSuggestion(
                code="add_external_support",
                message="External support may be required because no active contracted candidate is available.",
            )
        )
    if not suggestions:
        suggestions.append(
            ManagerReviewSuggestion(
                code="review_constraints",
                message="Review the current hard constraints and rerun generation after adjustments.",
            )
        )
    return suggestions


def cents_to_float(value: int) -> float:
    return float((Decimal(value) / Decimal("100")).quantize(TWO_PLACES))
