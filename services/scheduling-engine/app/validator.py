from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Literal
from uuid import UUID

from app.models import (
    ApprovedException,
    AvailabilityDay,
    AvailabilitySubmission,
    DraftAssignment,
    EmploymentContract,
    PlanningContext,
    Shift,
    ShiftType,
    StaffMember,
    TrainingStatus,
    ValidationIssue,
    ValidationMetrics,
    ValidationResponse,
)

KNOWN_TRAINING_PHASES = {
    "phase_1_shadow_only",
    "phase_2_can_open",
    "phase_3_fully_trained",
}
PRIMARY_ASSIGNMENT_KIND = "primary"
PHASE_1 = "phase_1_shadow_only"
PHASE_2 = "phase_2_can_open"
PHASE_3 = "phase_3_fully_trained"
TWO_PLACES = Decimal("0.01")


@dataclass(frozen=True)
class AssignmentRecord:
    index: int
    assignment: DraftAssignment
    shift: Shift | None
    staff: StaffMember | None
    shift_date: date | None
    shift_type: ShiftType | None


class DeterministicScheduleValidator:
    def __init__(
        self,
        *,
        planning_context: PlanningContext,
        assignments: list[DraftAssignment],
        engine_version: str,
        rules_version: str,
    ) -> None:
        self.context = planning_context
        self.assignments = assignments
        self.engine_version = engine_version
        self.rules_version = rules_version

        self.staff_by_id: dict[UUID, StaffMember] = {
            staff_member.id: staff_member for staff_member in planning_context.staff
        }
        self.shift_by_id: dict[UUID, Shift] = {
            shift.id: shift for shift in planning_context.shifts
        }
        self.contracts_by_staff: dict[UUID, list[EmploymentContract]] = defaultdict(list)
        for contract in planning_context.contracts:
            self.contracts_by_staff[contract.staff_id].append(contract)
        self.training_by_staff: dict[UUID, TrainingStatus] = {
            training.staff_id: training for training in planning_context.training
        }
        self.availability_by_staff_date: dict[tuple[UUID, date], AvailabilityDay] = {
            (availability.staff_id, availability.available_date): availability
            for availability in planning_context.availability_days
        }
        self.submission_by_staff: dict[UUID, AvailabilitySubmission] = {
            submission.staff_id: submission
            for submission in planning_context.availability_submissions
            if submission.period_id == planning_context.period.id
        }
        self.approved_exceptions: list[ApprovedException] = [
            exception
            for exception in planning_context.approved_exceptions
            if exception.approved
        ]

        self.errors: list[ValidationIssue] = []
        self.warnings: list[ValidationIssue] = []
        self.review_items: list[ValidationIssue] = []
        self.assignment_errors: dict[int, list[ValidationIssue]] = defaultdict(list)
        self.valid_assignment_indices: set[int] = set()
        self.assignment_records: list[AssignmentRecord] = []
        self.assignment_costs: dict[int, Decimal] = {}
        self.complete_weeks = self._complete_week_starts()
        self.partial_weeks = self._partial_week_starts()

    def validate(self) -> ValidationResponse:
        self._build_assignment_records()
        self._validate_training_phase_catalogue()
        self._validate_assignment_rows()
        self._validate_same_day_duplicates()
        self._validate_evening_to_next_morning()
        self._validate_shift_training_rules()
        self._validate_weekly_rules()
        self._validate_consecutive_day_rules()
        self._validate_weekend_patterns()
        self._validate_coverage()
        self._validate_budget()

        valid = len(self.errors) == 0
        ready_for_commit = valid

        metrics = ValidationMetrics(
            assignment_count=len(self.assignments),
            mandatory_shift_count=sum(
                1 for shift in self.context.shifts if not shift.is_optional
            ),
            covered_mandatory_shift_count=self._covered_mandatory_shift_count(),
            uncovered_mandatory_shift_count=self._uncovered_mandatory_shift_count(),
            estimated_labor_cost_eur=self._to_float(
                sum(self.assignment_costs.values(), Decimal("0.00"))
            ),
            monthly_budget_eur=(
                self._to_float(self.context.period.monthly_staff_budget_eur)
                if self.context.period.monthly_staff_budget_eur is not None
                else None
            ),
            complete_weeks_evaluated=self.complete_weeks,
            partial_weeks_not_fully_evaluated=self.partial_weeks,
        )

        return ValidationResponse(
            valid=valid,
            ready_for_commit=ready_for_commit,
            engine_version=self.engine_version,
            rules_version=self.rules_version,
            errors=self.errors,
            warnings=self.warnings,
            review_items=self.review_items,
            metrics=metrics,
        )

    def _build_assignment_records(self) -> None:
        self.assignment_records = []
        for index, assignment in enumerate(self.assignments):
            shift = self.shift_by_id.get(assignment.shift_id)
            staff = self.staff_by_id.get(assignment.staff_id)
            shift_date = shift.shift_date if shift else assignment.shift_date
            shift_type = shift.shift_type if shift else assignment.shift_type
            self.assignment_records.append(
                AssignmentRecord(
                    index=index,
                    assignment=assignment,
                    shift=shift,
                    staff=staff,
                    shift_date=shift_date,
                    shift_type=shift_type,
                )
            )

    def _validate_training_phase_catalogue(self) -> None:
        for training in self.context.training:
            if training.phase not in KNOWN_TRAINING_PHASES:
                self._add_error(
                    rule_id="WNC-HARD-011",
                    code="unknown_training_phase",
                    message="Unknown training phase must be resolved before validation.",
                    staff_id=training.staff_id,
                    details={"phase": training.phase},
                )

    def _validate_assignment_rows(self) -> None:
        for record in self.assignment_records:
            self._validate_draft_lifecycle(record)
            self._validate_staff_presence(record)
            self._validate_shift_presence(record)

            if record.shift is None or record.staff is None:
                continue

            if not record.staff.is_active:
                self._add_assignment_error(
                    record.index,
                    rule_id="WNC-HARD-001",
                    code="inactive_staff",
                    message="Inactive staff cannot be assigned.",
                    staff_id=record.staff.id,
                    shift_id=record.shift.id,
                )
                continue

            contracts = self._contracts_for_date(record.staff.id, record.shift.shift_date)
            if len(contracts) == 0:
                self._add_assignment_error(
                    record.index,
                    rule_id="WNC-HARD-002",
                    code="no_active_contract",
                    message="No active contract covers the assignment date.",
                    staff_id=record.staff.id,
                    shift_id=record.shift.id,
                )
            elif len(contracts) > 1:
                self._add_assignment_error(
                    record.index,
                    rule_id="WNC-HARD-002",
                    code="ambiguous_active_contract",
                    message="More than one active contract covers the assignment date.",
                    staff_id=record.staff.id,
                    shift_id=record.shift.id,
                )
            else:
                contract = contracts[0]
                self.assignment_costs[record.index] = (
                    record.staff.hourly_rate * contract.standard_shift_hours
                ).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)

            if not self._has_exception(
                "WNC-HARD-006",
                staff_id=record.staff.id,
                shift_id=record.shift.id,
            ) and not self._is_available(record.staff.id, record.shift):
                self._add_assignment_error(
                    record.index,
                    rule_id="WNC-HARD-006",
                    code="unavailable_for_shift",
                    message="Staff member is not available for this shift.",
                    staff_id=record.staff.id,
                    shift_id=record.shift.id,
                )

            training = self.training_by_staff.get(record.staff.id)
            if training and training.phase == PHASE_1:
                if record.assignment.assignment_kind == PRIMARY_ASSIGNMENT_KIND:
                    self._add_assignment_error(
                        record.index,
                        rule_id="WNC-HARD-011",
                        code="phase_1_primary_assignment",
                        message="Phase 1 staff cannot independently cover a primary assignment.",
                        staff_id=record.staff.id,
                        shift_id=record.shift.id,
                    )

            if len(self.assignment_errors[record.index]) == 0:
                self.valid_assignment_indices.add(record.index)

    def _validate_staff_presence(self, record: AssignmentRecord) -> None:
        if record.staff is None:
            self._add_assignment_error(
                record.index,
                rule_id="WNC-HARD-001",
                code="unknown_staff",
                message="Assignments must reference a known active staff member.",
                staff_id=record.assignment.staff_id,
                shift_id=record.assignment.shift_id,
                details={"external_wildcard_support": False},
            )

    def _validate_shift_presence(self, record: AssignmentRecord) -> None:
        if record.shift is None:
            self._add_assignment_error(
                record.index,
                rule_id="WNC-HARD-007",
                code="unknown_shift",
                message="Assignments must reference a known shift in planning_context.",
                staff_id=record.assignment.staff_id,
                shift_id=record.assignment.shift_id,
            )

    def _validate_draft_lifecycle(self, record: AssignmentRecord) -> None:
        lifecycle = record.assignment.assignment_lifecycle
        if lifecycle == "published":
            self._add_warning(
                rule_id="WNC-HARD-016",
                code="published_lifecycle_input",
                message="Incoming assignments should remain draft lifecycle during validation.",
                staff_id=record.assignment.staff_id,
                shift_id=record.assignment.shift_id,
            )

    def _validate_same_day_duplicates(self) -> None:
        by_staff_date: dict[tuple[UUID, date], list[AssignmentRecord]] = defaultdict(list)
        for record in self.assignment_records:
            if record.staff is None or record.shift_date is None:
                continue
            by_staff_date[(record.staff.id, record.shift_date)].append(record)

        for records in by_staff_date.values():
            if len(records) <= 1:
                continue
            for record in records:
                self._add_assignment_error(
                    record.index,
                    rule_id="WNC-HARD-009",
                    code="same_day_duplicate",
                    message="A staff member cannot be assigned to more than one shift on the same date.",
                    staff_id=record.staff.id if record.staff else None,
                    shift_id=record.shift.id if record.shift else None,
                )
                self.valid_assignment_indices.discard(record.index)

    def _validate_evening_to_next_morning(self) -> None:
        if not self.context.settings.block_evening_to_next_morning:
            return

        by_staff_date_type: dict[tuple[UUID, date, ShiftType], list[AssignmentRecord]] = (
            defaultdict(list)
        )
        for record in self.assignment_records:
            if record.staff is None or record.shift_date is None or record.shift_type is None:
                continue
            by_staff_date_type[(record.staff.id, record.shift_date, record.shift_type)].append(
                record
            )

        for (staff_id, shift_date, shift_type), records in by_staff_date_type.items():
            if shift_type is not ShiftType.EVENING:
                continue
            next_day_records = by_staff_date_type.get(
                (staff_id, shift_date + timedelta(days=1), ShiftType.MORNING),
                [],
            )
            if not next_day_records:
                continue
            for next_record in next_day_records:
                if self._has_exception(
                    "WNC-HARD-010",
                    staff_id=staff_id,
                    shift_id=next_record.shift.id if next_record.shift else None,
                    week_start=self._week_start(next_record.shift_date),
                ):
                    continue
                self._add_assignment_error(
                    next_record.index,
                    rule_id="WNC-HARD-010",
                    code="evening_to_next_morning",
                    message="Evening to next-morning assignments are blocked by rest settings.",
                    staff_id=staff_id,
                    shift_id=next_record.shift.id if next_record.shift else None,
                    week_start=self._week_start(next_record.shift_date),
                    details={"previous_evening_date": shift_date.isoformat()},
                )
                self.valid_assignment_indices.discard(next_record.index)

    def _validate_shift_training_rules(self) -> None:
        records_by_shift: dict[UUID, list[AssignmentRecord]] = defaultdict(list)
        for record in self.assignment_records:
            if record.shift is not None:
                records_by_shift[record.shift.id].append(record)

        for shift_id, records in records_by_shift.items():
            phase_3_records = [
                record
                for record in records
                if self._training_phase(record.staff.id if record.staff else None) == PHASE_3
            ]
            for record in records:
                if record.staff is None or record.shift is None:
                    continue
                phase = self._training_phase(record.staff.id)
                if phase == PHASE_1 and record.assignment.assignment_kind != PRIMARY_ASSIGNMENT_KIND:
                    if not phase_3_records:
                        self._add_assignment_error(
                            record.index,
                            rule_id="WNC-HARD-012",
                            code="phase_1_requires_phase_3_pairing",
                            message="Phase 1 shadow/training assignments require a paired Phase 3 assignment.",
                            staff_id=record.staff.id,
                            shift_id=shift_id,
                        )
                        self.valid_assignment_indices.discard(record.index)
                    elif not any(
                        paired.staff and paired.staff.is_initial_training_mentor
                        for paired in phase_3_records
                    ):
                        self._add_review_item(
                            rule_id="WNC-HARD-012",
                            code="mentor_history_unavailable",
                            message="A Phase 1 pairing exists, but mentor-history context is insufficient to verify the preferred initial mentor requirement.",
                            staff_id=record.staff.id,
                            shift_id=shift_id,
                        )

                if (
                    phase == PHASE_2
                    and record.shift.shift_type is ShiftType.EVENING
                    and not phase_3_records
                ):
                    self._add_assignment_error(
                        record.index,
                        rule_id="WNC-HARD-013",
                        code="phase_2_solo_evening",
                        message="Phase 2 staff cannot close an evening shift without a Phase 3 pairing.",
                        staff_id=record.staff.id,
                        shift_id=shift_id,
                    )
                    self.valid_assignment_indices.discard(record.index)

    def _validate_weekly_rules(self) -> None:
        weekly_counts: dict[tuple[UUID, date], int] = defaultdict(int)
        for record in self.assignment_records:
            if record.staff is None or record.shift_date is None:
                continue
            weekly_counts[(record.staff.id, self._week_start(record.shift_date))] += 1

        for week_start in self.partial_weeks:
            affected_staff_ids = [
                staff_member.id
                for staff_member in self.context.staff
                if self._staff_has_contract_in_week(staff_member.id, week_start)
            ]
            if not affected_staff_ids:
                continue
            self._add_warning(
                rule_id="WNC-HARD-003",
                code="insufficient_boundary_context",
                message="This boundary week is incomplete, so weekly minimum and target checks are only advisory.",
                week_start=week_start,
                details={
                    "affected_staff_count": len(affected_staff_ids),
                    "affected_staff_ids": [
                        str(staff_id) for staff_id in affected_staff_ids
                    ],
                    "period_start_date": self.context.period.start_date.isoformat(),
                    "period_end_date": self.context.period.end_date.isoformat(),
                },
            )

        total_excess_by_staff: dict[UUID, int] = defaultdict(int)
        for week_start in self.complete_weeks:
            week_end = week_start + timedelta(days=6)
            for staff_member in self.context.staff:
                contract = self._contract_for_week(staff_member.id, week_start, week_end)
                if contract is None:
                    continue
                count = weekly_counts[(staff_member.id, week_start)]
                total_excess_by_staff[staff_member.id] += max(
                    0, count - contract.target_shifts_per_week
                )
                if (
                    count < contract.min_shifts_per_week
                    and not self._has_exception(
                        "WNC-HARD-003",
                        staff_id=staff_member.id,
                        week_start=week_start,
                    )
                ):
                    self._add_error(
                        rule_id="WNC-HARD-003",
                        code="weekly_minimum_not_met",
                        message="Weekly minimum shifts are not met for a complete week.",
                        staff_id=staff_member.id,
                        week_start=week_start,
                        details={
                            "assigned_shift_count": count,
                            "min_shifts_per_week": contract.min_shifts_per_week,
                        },
                    )

                if (
                    count > contract.max_shifts_per_week
                    and not self._has_exception(
                        "WNC-HARD-004",
                        staff_id=staff_member.id,
                        week_start=week_start,
                    )
                ):
                    self._add_error(
                        rule_id="WNC-HARD-004",
                        code="weekly_maximum_exceeded",
                        message="Weekly maximum shifts are exceeded for a complete week.",
                        staff_id=staff_member.id,
                        week_start=week_start,
                        details={
                            "assigned_shift_count": count,
                            "max_shifts_per_week": contract.max_shifts_per_week,
                        },
                    )

                if count < contract.target_shifts_per_week:
                    self._add_warning(
                        rule_id="WNC-SOFT-001",
                        code="below_weekly_target",
                        message="Assigned shifts are below the weekly target for a complete week.",
                        staff_id=staff_member.id,
                        week_start=week_start,
                        details={
                            "assigned_shift_count": count,
                            "target_shifts_per_week": contract.target_shifts_per_week,
                        },
                    )

            self._validate_unbalanced_target_usage(week_start, week_end, weekly_counts)

        for staff_id, total_excess in total_excess_by_staff.items():
            if total_excess <= 0:
                continue
            submission = self.submission_by_staff.get(staff_id)
            allowance = submission.max_extra_shifts_for_period if submission else None
            has_consent = bool(submission and submission.willing_to_work_above_target)
            if has_consent:
                continue
            if allowance is not None and total_excess <= allowance:
                continue
            if self._has_exception("WNC-HARD-005", staff_id=staff_id):
                continue
            self._add_error(
                rule_id="WNC-HARD-005",
                code="above_target_without_consent",
                message="Assigned shifts exceed target without above-target consent or approved allowance.",
                staff_id=staff_id,
                details={
                    "total_excess_shifts": total_excess,
                    "allowed_extra_shifts": allowance,
                },
            )

    def _validate_unbalanced_target_usage(
        self,
        week_start: date,
        week_end: date,
        weekly_counts: dict[tuple[UUID, date], int],
    ) -> None:
        above_target: list[UUID] = []
        below_target_eligible: list[UUID] = []
        for staff_member in self.context.staff:
            contract = self._contract_for_week(staff_member.id, week_start, week_end)
            if contract is None:
                continue
            count = weekly_counts[(staff_member.id, week_start)]
            if count > contract.target_shifts_per_week:
                above_target.append(staff_member.id)
            if count < contract.target_shifts_per_week and self._staff_has_any_availability_in_week(
                staff_member.id, week_start, week_end
            ):
                below_target_eligible.append(staff_member.id)

        if above_target and below_target_eligible:
            self._add_warning(
                rule_id="WNC-SOFT-002",
                code="unbalanced_target_usage",
                message="Some employees are above target while other eligible active employees remain below target in the same complete week.",
                week_start=week_start,
                details={
                    "above_target_staff_ids": [str(staff_id) for staff_id in above_target],
                    "below_target_staff_ids": [
                        str(staff_id) for staff_id in below_target_eligible
                    ],
                    "metric": "complete_week_shift_count_vs_target",
                },
            )

    def _validate_consecutive_day_rules(self) -> None:
        worked_dates_by_staff = self._worked_dates_by_staff()
        hard_limit = self.context.settings.default_hard_max_consecutive_days
        soft_limit = self.context.settings.default_soft_max_consecutive_days

        for staff_id, worked_dates in worked_dates_by_staff.items():
            streaks = self._date_streaks(worked_dates)
            for streak in streaks:
                streak_start, streak_end, streak_length = streak
                week_start = self._week_start(streak_start)
                if hard_limit is not None and streak_length > hard_limit and not self._has_exception(
                    "WNC-HARD-014",
                    staff_id=staff_id,
                    week_start=week_start,
                ):
                    self._add_error(
                        rule_id="WNC-HARD-014",
                        code="hard_consecutive_day_limit_exceeded",
                        message="Hard maximum consecutive worked days is exceeded.",
                        staff_id=staff_id,
                        week_start=week_start,
                        details={
                            "consecutive_days": streak_length,
                            "limit": hard_limit,
                            "streak_start": streak_start.isoformat(),
                            "streak_end": streak_end.isoformat(),
                        },
                    )

                if soft_limit is not None and streak_length > soft_limit:
                    self._add_warning(
                        rule_id="WNC-SOFT-005",
                        code="soft_consecutive_day_limit_exceeded",
                        message="Soft maximum consecutive worked days is exceeded.",
                        staff_id=staff_id,
                        week_start=week_start,
                        details={
                            "consecutive_days": streak_length,
                            "limit": soft_limit,
                            "streak_start": streak_start.isoformat(),
                            "streak_end": streak_end.isoformat(),
                        },
                    )

                if (
                    streak_start == self.context.period.start_date
                    or streak_end == self.context.period.end_date
                ):
                    self._add_warning(
                        rule_id="WNC-HARD-014",
                        code="limited_boundary_context",
                        message="Consecutive-day evaluation touches the snapshot boundary, so prior or next-day context may be incomplete.",
                        staff_id=staff_id,
                        week_start=week_start,
                        details={
                            "streak_start": streak_start.isoformat(),
                            "streak_end": streak_end.isoformat(),
                        },
                    )

            if self._has_fragmented_pattern(worked_dates):
                self._add_warning(
                    rule_id="WNC-SOFT-004",
                    code="fragmented_pattern",
                    message="Worked dates contain isolated days or one-day gaps.",
                    staff_id=staff_id,
                )

    def _validate_weekend_patterns(self) -> None:
        worked_dates_by_staff = self._worked_dates_by_staff()
        for staff_id, worked_dates in worked_dates_by_staff.items():
            weekend_weeks: list[date] = []
            by_week: dict[date, set[int]] = defaultdict(set)
            for worked_date in worked_dates:
                by_week[self._week_start(worked_date)].add(worked_date.weekday())

            for week_start, weekdays in by_week.items():
                if 5 in weekdays and 6 in weekdays:
                    weekend_weeks.append(week_start)
                    self._add_warning(
                        rule_id="WNC-SOFT-006",
                        code="full_weekend_assignment",
                        message="The same employee is assigned on both Saturday and Sunday.",
                        staff_id=staff_id,
                        week_start=week_start,
                    )

            weekend_weeks.sort()
            for previous, current in zip(weekend_weeks, weekend_weeks[1:]):
                if current == previous + timedelta(days=7):
                    self._add_warning(
                        rule_id="WNC-SOFT-007",
                        code="consecutive_weekend_burden",
                        message="Repeated full-weekend burden appears in consecutive measured weeks.",
                        staff_id=staff_id,
                        week_start=current,
                    )

    def _validate_coverage(self) -> None:
        valid_counts_by_shift: dict[UUID, int] = defaultdict(int)
        for record in self.assignment_records:
            if record.index in self.valid_assignment_indices and record.shift is not None:
                valid_counts_by_shift[record.shift.id] += 1

        for shift in self.context.shifts:
            if shift.is_optional:
                continue
            valid_count = valid_counts_by_shift[shift.id]
            if valid_count < shift.required_count:
                self._add_error(
                    rule_id="WNC-HARD-007",
                    code="mandatory_shift_uncovered",
                    message="Mandatory service coverage is below the required count.",
                    shift_id=shift.id,
                    details={
                        "required_count": shift.required_count,
                        "valid_assignment_count": valid_count,
                    },
                )

    def _validate_budget(self) -> None:
        monthly_budget = self.context.period.monthly_staff_budget_eur
        if monthly_budget is None:
            return
        total_cost = sum(self.assignment_costs.values(), Decimal("0.00")).quantize(
            TWO_PLACES, rounding=ROUND_HALF_UP
        )
        if total_cost <= monthly_budget:
            return
        if self._has_exception("WNC-HARD-018"):
            return
        self._add_error(
            rule_id="WNC-HARD-018",
            code="budget_exceeded",
            message="Estimated labor cost exceeds the configured monthly staff budget.",
            details={
                "estimated_labor_cost_eur": self._to_float(total_cost),
                "monthly_budget_eur": self._to_float(monthly_budget),
            },
        )

    def _covered_mandatory_shift_count(self) -> int:
        covered = 0
        for shift in self.context.shifts:
            if shift.is_optional:
                continue
            valid_count = sum(
                1
                for record in self.assignment_records
                if record.shift is not None
                and record.shift.id == shift.id
                and record.index in self.valid_assignment_indices
            )
            if valid_count >= shift.required_count:
                covered += 1
        return covered

    def _uncovered_mandatory_shift_count(self) -> int:
        return sum(1 for shift in self.context.shifts if not shift.is_optional) - (
            self._covered_mandatory_shift_count()
        )

    def _worked_dates_by_staff(self) -> dict[UUID, list[date]]:
        dates_by_staff: dict[UUID, set[date]] = defaultdict(set)
        for record in self.assignment_records:
            if record.staff is None or record.shift_date is None:
                continue
            dates_by_staff[record.staff.id].add(record.shift_date)
        return {
            staff_id: sorted(worked_dates)
            for staff_id, worked_dates in dates_by_staff.items()
        }

    def _contracts_for_date(self, staff_id: UUID, shift_date: date) -> list[EmploymentContract]:
        return [
            contract
            for contract in self.contracts_by_staff.get(staff_id, [])
            if contract.start_date <= shift_date
            and (contract.end_date is None or contract.end_date >= shift_date)
        ]

    def _contract_for_week(
        self,
        staff_id: UUID,
        week_start: date,
        week_end: date,
    ) -> EmploymentContract | None:
        overlapping = [
            contract
            for contract in self.contracts_by_staff.get(staff_id, [])
            if contract.start_date <= week_end
            and (contract.end_date is None or contract.end_date >= week_start)
        ]
        if len(overlapping) == 1:
            return overlapping[0]
        return overlapping[0] if overlapping else None

    def _staff_has_contract_in_week(self, staff_id: UUID, week_start: date) -> bool:
        return self._contract_for_week(staff_id, week_start, week_start + timedelta(days=6)) is not None

    def _staff_has_any_availability_in_week(
        self,
        staff_id: UUID,
        week_start: date,
        week_end: date,
    ) -> bool:
        current = week_start
        while current <= week_end:
            availability = self.availability_by_staff_date.get((staff_id, current))
            if availability and (availability.morning or availability.day or availability.evening):
                return True
            current += timedelta(days=1)
        return False

    def _is_available(self, staff_id: UUID, shift: Shift) -> bool:
        availability = self.availability_by_staff_date.get((staff_id, shift.shift_date))
        if availability is None:
            return False
        if shift.shift_type is ShiftType.MORNING:
            return availability.morning
        if shift.shift_type is ShiftType.DAY:
            return availability.day
        return availability.evening

    def _training_phase(self, staff_id: UUID | None) -> str | None:
        if staff_id is None:
            return None
        training = self.training_by_staff.get(staff_id)
        return training.phase if training else None

    def _complete_week_starts(self) -> list[date]:
        week_starts = []
        for week_start in self._all_week_starts():
            if week_start >= self.context.period.start_date and (
                week_start + timedelta(days=6)
            ) <= self.context.period.end_date:
                week_starts.append(week_start)
        return week_starts

    def _partial_week_starts(self) -> list[date]:
        return [
            week_start
            for week_start in self._all_week_starts()
            if week_start not in self.complete_weeks
        ]

    def _all_week_starts(self) -> list[date]:
        start = self._week_start(self.context.period.start_date)
        end = self._week_start(self.context.period.end_date)
        week_starts = []
        current = start
        while current <= end:
            week_starts.append(current)
            current += timedelta(days=7)
        return week_starts

    def _date_streaks(self, dates: Iterable[date]) -> list[tuple[date, date, int]]:
        ordered = sorted(dates)
        if not ordered:
            return []
        streaks: list[tuple[date, date, int]] = []
        streak_start = ordered[0]
        previous = ordered[0]
        streak_length = 1
        for current in ordered[1:]:
            if current == previous + timedelta(days=1):
                streak_length += 1
                previous = current
                continue
            streaks.append((streak_start, previous, streak_length))
            streak_start = current
            previous = current
            streak_length = 1
        streaks.append((streak_start, previous, streak_length))
        return streaks

    def _has_fragmented_pattern(self, dates: Iterable[date]) -> bool:
        ordered = sorted(dates)
        if len(ordered) < 2:
            return False
        for left, right in zip(ordered, ordered[1:]):
            if (right - left).days == 2:
                return True
        return any(
            (
                (idx == 0 or (current - ordered[idx - 1]).days > 1)
                and (idx == len(ordered) - 1 or (ordered[idx + 1] - current).days > 1)
            )
            for idx, current in enumerate(ordered)
        )

    def _has_exception(
        self,
        rule_id: str,
        *,
        staff_id: UUID | None = None,
        shift_id: UUID | None = None,
        week_start: date | None = None,
    ) -> bool:
        for exception in self.approved_exceptions:
            if exception.rule_id != rule_id:
                continue
            if exception.staff_id is not None and exception.staff_id != staff_id:
                continue
            if exception.shift_id is not None and exception.shift_id != shift_id:
                continue
            if exception.week_start is not None and exception.week_start != week_start:
                continue
            return True
        return False

    def _add_assignment_error(
        self,
        assignment_index: int,
        *,
        rule_id: str,
        code: str,
        message: str,
        staff_id: UUID | None = None,
        shift_id: UUID | None = None,
        week_start: date | None = None,
        details: dict[str, object] | None = None,
    ) -> None:
        issue = self._build_issue(
            rule_id=rule_id,
            code=code,
            severity="error",
            message=message,
            staff_id=staff_id,
            shift_id=shift_id,
            week_start=week_start,
            details=details,
        )
        self.assignment_errors[assignment_index].append(issue)
        self.errors.append(issue)

    def _add_error(
        self,
        *,
        rule_id: str,
        code: str,
        message: str,
        staff_id: UUID | None = None,
        shift_id: UUID | None = None,
        week_start: date | None = None,
        details: dict[str, object] | None = None,
    ) -> None:
        self.errors.append(
            self._build_issue(
                rule_id=rule_id,
                code=code,
                severity="error",
                message=message,
                staff_id=staff_id,
                shift_id=shift_id,
                week_start=week_start,
                details=details,
            )
        )

    def _add_warning(
        self,
        *,
        rule_id: str,
        code: str,
        message: str,
        staff_id: UUID | None = None,
        shift_id: UUID | None = None,
        week_start: date | None = None,
        details: dict[str, object] | None = None,
    ) -> None:
        self.warnings.append(
            self._build_issue(
                rule_id=rule_id,
                code=code,
                severity="warning",
                message=message,
                staff_id=staff_id,
                shift_id=shift_id,
                week_start=week_start,
                details=details,
            )
        )

    def _add_review_item(
        self,
        *,
        rule_id: str,
        code: str,
        message: str,
        staff_id: UUID | None = None,
        shift_id: UUID | None = None,
        week_start: date | None = None,
        details: dict[str, object] | None = None,
    ) -> None:
        self.review_items.append(
            self._build_issue(
                rule_id=rule_id,
                code=code,
                severity="review",
                message=message,
                staff_id=staff_id,
                shift_id=shift_id,
                week_start=week_start,
                details=details,
            )
        )

    def _build_issue(
        self,
        *,
        rule_id: str,
        code: str,
        severity: Literal["error", "warning", "review"],
        message: str,
        staff_id: UUID | None = None,
        shift_id: UUID | None = None,
        week_start: date | None = None,
        details: dict[str, object] | None = None,
    ) -> ValidationIssue:
        return ValidationIssue(
            rule_id=rule_id,
            code=code,
            severity=severity,
            message=message,
            staff_id=staff_id,
            shift_id=shift_id,
            week_start=week_start,
            details=details or {},
        )

    def _week_start(self, shift_date: date) -> date:
        return shift_date - timedelta(days=shift_date.weekday())

    def _to_float(self, value: Decimal | int | float) -> float:
        return float(
            Decimal(str(value)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
        )


def validate_schedule(
    *,
    planning_context: PlanningContext,
    assignments: list[DraftAssignment],
    engine_version: str,
    rules_version: str,
) -> ValidationResponse:
    validator = DeterministicScheduleValidator(
        planning_context=planning_context,
        assignments=assignments,
        engine_version=engine_version,
        rules_version=rules_version,
    )
    return validator.validate()
