"""Safe coverage bounds from daily capacity; other constraints stay in CP-SAT."""
from collections import defaultdict
from datetime import date
from uuid import UUID

from app.generator.context import IndexedPlanningContext
from app.generator.eligibility import CandidateAssignment


def maximum_daily_coverage(slots: list[set[UUID]]) -> int:
    """Maximum matching of mandatory places to staff, at most one place per person.

    Reassign earlier matches through augmenting paths: greedy allocation alone
    can underestimate capacity and incorrectly declare a gap unavoidable.
    """
    staff_to_slot: dict[UUID, int] = {}

    def augment(slot: int, visited: set[UUID]) -> bool:
        for staff_id in sorted(slots[slot], key=str):
            if staff_id in visited:
                continue
            visited.add(staff_id)
            previous = staff_to_slot.get(staff_id)
            if previous is None or augment(previous, visited):
                staff_to_slot[staff_id] = slot
                return True
        return False

    return sum(augment(slot, set()) for slot in range(len(slots)))


def daily_coverage_shortfall_bounds(
    context: IndexedPlanningContext, candidates: list[CandidateAssignment]
) -> dict[date, int]:
    eligible: dict[UUID, set[UUID]] = defaultdict(set)
    for candidate in candidates:
        if candidate.assignment_kind == "coverage":
            eligible[candidate.shift_id].add(candidate.staff_id)
    slots_by_date: dict[date, list[set[UUID]]] = defaultdict(list)
    for shift in context.ordered_shifts:
        if not shift.is_optional:
            slots_by_date[shift.shift_date].extend(
                [eligible[shift.id]] * shift.required_count
            )
    # Ignoring rest, weekly limits and pairing can only overestimate capacity,
    # hence these gaps are safe lower bounds, not guaranteed attainable results.
    return {day: len(slots) - maximum_daily_coverage(slots)
            for day, slots in slots_by_date.items()}
