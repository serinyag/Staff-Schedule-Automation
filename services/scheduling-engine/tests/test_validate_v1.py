from __future__ import annotations

import socket
from datetime import date, timedelta
from uuid import UUID, NAMESPACE_URL, uuid4, uuid5

import pytest
from fastapi.testclient import TestClient

PERIOD_ID = "26617a4e-9b43-47a8-905b-46b76b4bfd20"
STAFF_A = "11111111-1111-1111-1111-111111111111"
STAFF_B = "22222222-2222-2222-2222-222222222222"
STAFF_C = "33333333-3333-3333-3333-333333333333"
STAFF_D = "44444444-4444-4444-4444-444444444444"


def make_staff(
    staff_id: str,
    *,
    active: bool = True,
    mentor: bool = False,
    hourly_rate: str = "20.00",
) -> dict[str, object]:
    return {
        "id": staff_id,
        "full_name": f"Staff {staff_id[-4:]}",
        "is_active": active,
        "work_role": "studio_staff",
        "scheduling_rule_role": "staff",
        "hourly_rate": hourly_rate,
        "is_wildcard_fill_in": False,
        "is_initial_training_mentor": mentor,
        "default_weekly_budget_shifts": None,
    }


def make_contract(
    staff_id: str,
    *,
    min_shifts: int = 0,
    target_shifts: int = 1,
    max_shifts: int = 5,
    hours: str = "8.0",
    start: date = date(2026, 7, 6),
    end: date | None = date(2026, 7, 12),
) -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "staff_id": staff_id,
        "start_date": start.isoformat(),
        "end_date": end.isoformat() if end else None,
        "min_shifts_per_week": min_shifts,
        "target_shifts_per_week": target_shifts,
        "max_shifts_per_week": max_shifts,
        "standard_shift_hours": hours,
    }


def make_training(staff_id: str, phase: str = "phase_3_fully_trained") -> dict[str, object]:
    return {"staff_id": staff_id, "phase": phase}


def make_shift(
    shift_id: str,
    shift_date: date,
    shift_type: str,
    *,
    required_count: int = 1,
    optional: bool = False,
) -> dict[str, object]:
    return {
        "id": stable_uuid(shift_id),
        "period_id": PERIOD_ID,
        "shift_date": shift_date.isoformat(),
        "shift_type": shift_type,
        "start_time": None,
        "end_time": None,
        "is_optional": optional,
        "required_count": required_count,
    }


def make_availability_day(
    staff_id: str,
    available_date: date,
    *,
    morning: bool = True,
    day: bool = True,
    evening: bool = True,
) -> dict[str, object]:
    return {
        "staff_id": staff_id,
        "available_date": available_date.isoformat(),
        "morning": morning,
        "day": day,
        "evening": evening,
        "submission_id": None,
    }


def make_submission(
    staff_id: str,
    *,
    willing: bool = False,
    max_extra: int | None = None,
) -> dict[str, object]:
    return {
        "staff_id": staff_id,
        "period_id": PERIOD_ID,
        "status": "submitted",
        "willing_to_work_above_target": willing,
        "max_extra_shifts_for_period": max_extra,
    }


def make_exception(
    rule_id: str,
    *,
    staff_id: str | None = None,
    shift_id: str | None = None,
    week_start: date | None = None,
) -> dict[str, object]:
    return {
        "rule_id": rule_id,
        "exception_type": "approved_override",
        "staff_id": staff_id,
        "shift_id": stable_uuid(shift_id) if shift_id else None,
        "week_start": week_start.isoformat() if week_start else None,
        "approved": True,
        "reason": "Synthetic test coverage",
        "approved_by": "test-suite",
        "approved_at": "2026-07-13T09:00:00Z",
    }


def make_assignment(
    shift_id: str,
    staff_id: str,
    *,
    assignment_kind: str = "primary",
    assignment_lifecycle: str | None = "draft",
    staff_field: str = "staff_member_id",
) -> dict[str, object]:
    return {
        "shift_id": stable_uuid(shift_id),
        staff_field: staff_id,
        "assignment_kind": assignment_kind,
        "assignment_lifecycle": assignment_lifecycle,
    }


def make_context(
    *,
    period_start: date = date(2026, 7, 6),
    period_end: date = date(2026, 7, 12),
    staff: list[dict[str, object]] | None = None,
    shifts: list[dict[str, object]] | None = None,
    contracts: list[dict[str, object]] | None = None,
    training: list[dict[str, object]] | None = None,
    availability_days: list[dict[str, object]] | None = None,
    submissions: list[dict[str, object]] | None = None,
    approved_exceptions: list[dict[str, object]] | None = None,
    settings: dict[str, object] | None = None,
    budget: str | None = "1000.00",
) -> dict[str, object]:
    staff_members = staff if staff is not None else [make_staff(STAFF_A, mentor=True)]
    shifts_list = shifts if shifts is not None else [make_shift("shift-1", period_start, "morning")]
    contracts_list = contracts if contracts is not None else [make_contract(STAFF_A)]
    training_list = training if training is not None else [make_training(STAFF_A)]
    availability_list = availability_days if availability_days is not None else [
        make_availability_day(staff_member["id"], current_date)
        for staff_member in staff_members
        for current_date in date_range(period_start, period_end)
    ]
    submissions_list = submissions if submissions is not None else [
        make_submission(str(staff_member["id"])) for staff_member in staff_members
    ]

    return {
        "staff": staff_members,
        "period": {
            "id": PERIOD_ID,
            "start_date": period_start.isoformat(),
            "end_date": period_end.isoformat(),
            "monthly_staff_budget_eur": budget,
        },
        "shifts": shifts_list,
        "budgets": [],
        "settings": settings
        or {
            "block_evening_to_next_morning": True,
            "default_hard_max_consecutive_days": 5,
            "default_soft_max_consecutive_days": 3,
        },
        "training": training_list,
        "contracts": contracts_list,
        "period_id": PERIOD_ID,
        "role_rules": [],
        "diagnostics": {},
        "preferences": [],
        "generated_at": "2026-07-13T09:00:00Z",
        "context_version": 1,
        "availability_days": availability_list,
        "holiday_exemptions": [],
        "availability_submissions": submissions_list,
        "approved_exceptions": approved_exceptions if approved_exceptions is not None else [],
    }


def make_payload(
    assignments: list[dict[str, object]],
    *,
    context: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "generation_run_id": "56a5944b-286d-4a9c-bc2c-6f89739ed2b1",
        "period_id": PERIOD_ID,
        "rules_version": "2",
        "planning_context": context or make_context(),
        "draft_plan": {"assignments": assignments},
    }


def date_range(start: date, end: date) -> list[date]:
    current = start
    dates = []
    while current <= end:
        dates.append(current)
        current += timedelta(days=1)
    return dates


def stable_uuid(seed: str) -> str:
    try:
        UUID(seed)
        return seed
    except ValueError:
        pass
    return str(uuid5(NAMESPACE_URL, seed))


def issue_codes(response_json: dict[str, object], bucket: str) -> set[tuple[str, str]]:
    return {
        (item["rule_id"], item["code"])
        for item in response_json[bucket]
    }


def has_issue(response_json: dict[str, object], bucket: str, rule_id: str) -> bool:
    return any(item["rule_id"] == rule_id for item in response_json[bucket])


def post_validate(
    client: TestClient,
    payload: dict[str, object],
) -> dict[str, object]:
    response = client.post(
        "/v1/schedules/validate",
        headers={"X-Engine-API-Key": "test-engine-key"},
        json=payload,
    )
    assert response.status_code == 200
    return response.json()


def test_valid_simple_schedule(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        socket.socket,
        "connect",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Unexpected network connection attempt.")
        ),
    )
    payload = make_payload([make_assignment("shift-1", STAFF_A)])

    response_json = post_validate(client, payload)

    assert response_json["valid"] is True
    assert response_json["ready_for_commit"] is True
    assert response_json["engine_version"] == "0.3.0"
    assert response_json["rules_version"] == "2"
    assert response_json["errors"] == []
    assert response_json["metrics"]["assignment_count"] == 1
    assert response_json["metrics"]["mandatory_shift_count"] == 1
    assert response_json["metrics"]["covered_mandatory_shift_count"] == 1


def test_unknown_staff_assignment(client: TestClient) -> None:
    payload = make_payload([make_assignment("shift-1", str(uuid4()))])
    response_json = post_validate(client, payload)
    assert has_issue(response_json, "errors", "WNC-HARD-001")


def test_inactive_staff_assignment(client: TestClient) -> None:
    context = make_context(
        staff=[make_staff(STAFF_D, active=False)],
        contracts=[make_contract(STAFF_D)],
        training=[make_training(STAFF_D)],
        submissions=[make_submission(STAFF_D)],
    )
    payload = make_payload([make_assignment("shift-1", STAFF_D)], context=context)
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-001", "inactive_staff") in issue_codes(response_json, "errors")


def test_no_active_contract(client: TestClient) -> None:
    context = make_context(contracts=[])
    payload = make_payload([make_assignment("shift-1", STAFF_A)], context=context)
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-002", "no_active_contract") in issue_codes(response_json, "errors")


def test_unavailable_staff(client: TestClient) -> None:
    context = make_context(
        availability_days=[make_availability_day(STAFF_A, date(2026, 7, 6), morning=False)]
    )
    payload = make_payload([make_assignment("shift-1", STAFF_A)], context=context)
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-006", "unavailable_for_shift") in issue_codes(response_json, "errors")


def test_same_day_duplicate(client: TestClient) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 6), "morning"),
        make_shift("shift-2", date(2026, 7, 6), "day"),
    ]
    context = make_context(shifts=shifts)
    payload = make_payload(
        [make_assignment("shift-1", STAFF_A), make_assignment("shift-2", STAFF_A)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-009", "same_day_duplicate") in issue_codes(response_json, "errors")


def test_evening_to_next_morning_conflict(client: TestClient) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 6), "evening"),
        make_shift("shift-2", date(2026, 7, 7), "morning"),
    ]
    context = make_context(shifts=shifts)
    payload = make_payload(
        [make_assignment("shift-1", STAFF_A), make_assignment("shift-2", STAFF_A)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-010", "evening_to_next_morning") in issue_codes(
        response_json, "errors"
    )


def test_phase_1_independent_assignment(client: TestClient) -> None:
    context = make_context(
        staff=[make_staff(STAFF_B)],
        contracts=[make_contract(STAFF_B)],
        training=[make_training(STAFF_B, "phase_1_shadow_only")],
        submissions=[make_submission(STAFF_B)],
    )
    payload = make_payload([make_assignment("shift-1", STAFF_B)], context=context)
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-011", "phase_1_primary_assignment") in issue_codes(
        response_json, "errors"
    )


def test_phase_1_paired_with_phase_3(client: TestClient) -> None:
    shifts = [make_shift("shift-1", date(2026, 7, 6), "morning", required_count=1)]
    context = make_context(
        staff=[make_staff(STAFF_A, mentor=True), make_staff(STAFF_B)],
        shifts=shifts,
        contracts=[make_contract(STAFF_A), make_contract(STAFF_B)],
        training=[
            make_training(STAFF_A, "phase_3_fully_trained"),
            make_training(STAFF_B, "phase_1_shadow_only"),
        ],
        submissions=[make_submission(STAFF_A), make_submission(STAFF_B)],
    )
    payload = make_payload(
        [
            make_assignment("shift-1", STAFF_A, assignment_kind="primary"),
            make_assignment("shift-1", STAFF_B, assignment_kind="shadow"),
        ],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert not has_issue(response_json, "errors", "WNC-HARD-012")


def test_phase_2_solo_evening(client: TestClient) -> None:
    shifts = [make_shift("shift-1", date(2026, 7, 6), "evening")]
    context = make_context(
        staff=[make_staff(STAFF_C)],
        shifts=shifts,
        contracts=[make_contract(STAFF_C)],
        training=[make_training(STAFF_C, "phase_2_can_open")],
        submissions=[make_submission(STAFF_C)],
    )
    payload = make_payload([make_assignment("shift-1", STAFF_C)], context=context)
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-013", "phase_2_solo_evening") in issue_codes(response_json, "errors")


def test_weekly_maximum_exceeded(client: TestClient) -> None:
    shifts = [
        make_shift(f"shift-{index}", date(2026, 7, 6 + index), "morning")
        for index in range(4)
    ]
    context = make_context(
        shifts=shifts,
        contracts=[make_contract(STAFF_A, target_shifts=2, max_shifts=3, end=None)],
    )
    payload = make_payload(
        [make_assignment(shift["id"], STAFF_A) for shift in shifts],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-004", "weekly_maximum_exceeded") in issue_codes(
        response_json, "errors"
    )


def test_above_target_assignment_without_consent(client: TestClient) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 6), "morning"),
        make_shift("shift-2", date(2026, 7, 7), "morning"),
    ]
    context = make_context(
        shifts=shifts,
        contracts=[make_contract(STAFF_A, target_shifts=1, max_shifts=3, end=None)],
    )
    payload = make_payload(
        [make_assignment("shift-1", STAFF_A), make_assignment("shift-2", STAFF_A)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-005", "above_target_without_consent") in issue_codes(
        response_json, "errors"
    )


def test_above_target_assignment_with_valid_consent(client: TestClient) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 6), "morning"),
        make_shift("shift-2", date(2026, 7, 7), "morning"),
    ]
    context = make_context(
        shifts=shifts,
        contracts=[make_contract(STAFF_A, target_shifts=1, max_shifts=3, end=None)],
        submissions=[make_submission(STAFF_A, willing=True)],
    )
    payload = make_payload(
        [make_assignment("shift-1", STAFF_A), make_assignment("shift-2", STAFF_A)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert not has_issue(response_json, "errors", "WNC-HARD-005")


def test_mandatory_shift_uncovered(client: TestClient) -> None:
    shifts = [make_shift("shift-1", date(2026, 7, 6), "morning", required_count=2)]
    context = make_context(shifts=shifts)
    payload = make_payload([make_assignment("shift-1", STAFF_A)], context=context)
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-007", "mandatory_shift_uncovered") in issue_codes(
        response_json, "errors"
    )


def test_hard_consecutive_day_maximum_exceeded(client: TestClient) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 6), "morning"),
        make_shift("shift-2", date(2026, 7, 7), "morning"),
        make_shift("shift-3", date(2026, 7, 8), "morning"),
    ]
    context = make_context(
        shifts=shifts,
        settings={
            "block_evening_to_next_morning": True,
            "default_hard_max_consecutive_days": 2,
            "default_soft_max_consecutive_days": 2,
        },
        contracts=[make_contract(STAFF_A, target_shifts=3, max_shifts=5)],
    )
    payload = make_payload(
        [make_assignment(shift["id"], STAFF_A) for shift in shifts],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-014", "hard_consecutive_day_limit_exceeded") in issue_codes(
        response_json, "errors"
    )


def test_full_weekend_warning(client: TestClient) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 11), "morning"),
        make_shift("shift-2", date(2026, 7, 12), "day"),
    ]
    context = make_context(
        shifts=shifts,
        contracts=[make_contract(STAFF_A, min_shifts=0, target_shifts=2, max_shifts=3)],
    )
    payload = make_payload(
        [make_assignment("shift-1", STAFF_A), make_assignment("shift-2", STAFF_A)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert ("WNC-SOFT-006", "full_weekend_assignment") in issue_codes(
        response_json, "warnings"
    )


def test_fragmented_pattern_warning(client: TestClient) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 6), "morning"),
        make_shift("shift-2", date(2026, 7, 8), "morning"),
    ]
    context = make_context(
        shifts=shifts,
        contracts=[make_contract(STAFF_A, min_shifts=0, target_shifts=2, max_shifts=3)],
    )
    payload = make_payload(
        [make_assignment("shift-1", STAFF_A), make_assignment("shift-2", STAFF_A)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert ("WNC-SOFT-004", "fragmented_pattern") in issue_codes(
        response_json, "warnings"
    )


def test_budget_exceeded(client: TestClient) -> None:
    context = make_context(
        staff=[make_staff(STAFF_A, mentor=True, hourly_rate="50.00")],
        contracts=[make_contract(STAFF_A, min_shifts=0, target_shifts=1, max_shifts=3)],
        training=[make_training(STAFF_A)],
        submissions=[make_submission(STAFF_A)],
        budget="300.00",
    )
    payload = make_payload([make_assignment("shift-1", STAFF_A)], context=context)
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-018", "budget_exceeded") in issue_codes(response_json, "errors")


def test_engine_version_is_0_3_0(client: TestClient) -> None:
    response_json = post_validate(client, make_payload([make_assignment("shift-1", STAFF_A)]))
    assert response_json["engine_version"] == "0.3.0"


def test_three_day_consecutive_block_is_not_a_grouped_workdays_warning(
    client: TestClient,
) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 7), "morning"),
        make_shift("shift-2", date(2026, 7, 8), "morning"),
        make_shift("shift-3", date(2026, 7, 9), "morning"),
    ]
    context = make_context(
        shifts=shifts,
        contracts=[make_contract(STAFF_A, min_shifts=0, target_shifts=3, max_shifts=5)],
    )
    payload = make_payload(
        [make_assignment(f"shift-{index}", STAFF_A) for index in range(1, 4)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert not has_issue(response_json, "warnings", "WNC-SOFT-003")
    assert not any(item["code"] == "grouped_workdays" for item in response_json["warnings"])


def test_four_day_block_at_soft_max_does_not_warn_for_soft_consecutive_limit(
    client: TestClient,
) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 7), "morning"),
        make_shift("shift-2", date(2026, 7, 8), "morning"),
        make_shift("shift-3", date(2026, 7, 9), "morning"),
        make_shift("shift-4", date(2026, 7, 10), "morning"),
    ]
    context = make_context(
        shifts=shifts,
        settings={
            "block_evening_to_next_morning": True,
            "default_hard_max_consecutive_days": 6,
            "default_soft_max_consecutive_days": 4,
        },
        contracts=[make_contract(STAFF_A, min_shifts=0, target_shifts=4, max_shifts=6)],
    )
    payload = make_payload(
        [make_assignment(f"shift-{index}", STAFF_A) for index in range(1, 5)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert not has_issue(response_json, "warnings", "WNC-SOFT-005")
    assert not has_issue(response_json, "warnings", "WNC-SOFT-003")


def test_five_day_block_triggers_soft_limit_without_grouped_workdays_warning(
    client: TestClient,
) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 7), "morning"),
        make_shift("shift-2", date(2026, 7, 8), "morning"),
        make_shift("shift-3", date(2026, 7, 9), "morning"),
        make_shift("shift-4", date(2026, 7, 10), "morning"),
        make_shift("shift-5", date(2026, 7, 11), "morning"),
    ]
    context = make_context(
        shifts=shifts,
        settings={
            "block_evening_to_next_morning": True,
            "default_hard_max_consecutive_days": 6,
            "default_soft_max_consecutive_days": 4,
        },
        contracts=[make_contract(STAFF_A, min_shifts=0, target_shifts=5, max_shifts=6)],
    )
    payload = make_payload(
        [make_assignment(f"shift-{index}", STAFF_A) for index in range(1, 6)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert ("WNC-SOFT-005", "soft_consecutive_day_limit_exceeded") in issue_codes(
        response_json, "warnings"
    )
    assert not has_issue(response_json, "warnings", "WNC-SOFT-003")


def test_approved_exception_suppresses_only_relevant_error(client: TestClient) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 6), "morning"),
        make_shift("shift-2", date(2026, 7, 6), "day"),
    ]
    context = make_context(
        shifts=shifts,
        contracts=[make_contract(STAFF_A, target_shifts=1, max_shifts=1)],
        approved_exceptions=[make_exception("WNC-HARD-004", staff_id=STAFF_A)],
    )
    payload = make_payload(
        [make_assignment("shift-1", STAFF_A), make_assignment("shift-2", STAFF_A)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert not has_issue(response_json, "errors", "WNC-HARD-004")
    assert ("WNC-HARD-009", "same_day_duplicate") in issue_codes(response_json, "errors")


def test_partial_boundary_weeks_warn_instead_of_false_minimum_errors(
    client: TestClient,
) -> None:
    context = make_context(
        period_start=date(2026, 8, 1),
        period_end=date(2026, 8, 2),
        shifts=[],
        contracts=[
            make_contract(
                STAFF_A,
                min_shifts=1,
                target_shifts=1,
                max_shifts=3,
                start=date(2026, 8, 1),
                end=date(2026, 8, 2),
            )
        ],
        availability_days=[
            make_availability_day(STAFF_A, date(2026, 8, 1)),
            make_availability_day(STAFF_A, date(2026, 8, 2)),
        ],
    )
    payload = make_payload([], context=context)
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-003", "insufficient_boundary_context") in issue_codes(
        response_json, "warnings"
    )
    assert not has_issue(response_json, "errors", "WNC-HARD-003")


def test_repeated_one_day_gaps_still_warn_as_fragmented_pattern(
    client: TestClient,
) -> None:
    shifts = [
        make_shift("shift-1", date(2026, 7, 7), "morning"),
        make_shift("shift-2", date(2026, 7, 9), "morning"),
        make_shift("shift-3", date(2026, 7, 11), "morning"),
    ]
    context = make_context(
        shifts=shifts,
        contracts=[make_contract(STAFF_A, min_shifts=0, target_shifts=3, max_shifts=5)],
    )
    payload = make_payload(
        [make_assignment(f"shift-{index}", STAFF_A) for index in range(1, 4)],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert ("WNC-SOFT-004", "fragmented_pattern") in issue_codes(
        response_json, "warnings"
    )


def test_partial_boundary_warnings_are_consolidated_by_week(client: TestClient) -> None:
    staff_ids = [
        STAFF_A,
        STAFF_B,
        STAFF_C,
        STAFF_D,
        "55555555-5555-5555-5555-555555555555",
        "66666666-6666-6666-6666-666666666666",
    ]
    staff_members = [make_staff(staff_id, mentor=(index == 0)) for index, staff_id in enumerate(staff_ids)]
    contracts = [
        make_contract(
            staff_id,
            min_shifts=0,
            target_shifts=2,
            max_shifts=4,
            start=date(2026, 8, 1),
            end=date(2026, 8, 31),
        )
        for staff_id in staff_ids
    ]
    availability_days = [
        make_availability_day(staff_id, current_date)
        for staff_id in staff_ids
        for current_date in date_range(date(2026, 8, 1), date(2026, 8, 31))
    ]
    submissions = [make_submission(staff_id) for staff_id in staff_ids]
    context = make_context(
        period_start=date(2026, 8, 1),
        period_end=date(2026, 8, 31),
        staff=staff_members,
        shifts=[],
        contracts=contracts,
        training=[make_training(staff_id) for staff_id in staff_ids],
        availability_days=availability_days,
        submissions=submissions,
    )
    payload = make_payload([], context=context)
    response_json = post_validate(client, payload)

    boundary_warnings = [
        item
        for item in response_json["warnings"]
        if item["rule_id"] == "WNC-HARD-003"
        and item["code"] == "insufficient_boundary_context"
    ]

    assert len(boundary_warnings) == 2
    assert {item["week_start"] for item in boundary_warnings} == {"2026-07-27", "2026-08-31"}
    assert all(item["staff_id"] is None for item in boundary_warnings)
    assert all(item["details"]["affected_staff_count"] == 6 for item in boundary_warnings)
    assert all(len(item["details"]["affected_staff_ids"]) == 6 for item in boundary_warnings)
    assert response_json["metrics"]["complete_weeks_evaluated"] == [
        "2026-08-03",
        "2026-08-10",
        "2026-08-17",
        "2026-08-24",
    ]
    assert response_json["metrics"]["partial_weeks_not_fully_evaluated"] == [
        "2026-07-27",
        "2026-08-31",
    ]
    assert response_json["valid"] is True


def test_partial_boundary_warning_includes_period_dates_in_details(client: TestClient) -> None:
    context = make_context(
        period_start=date(2026, 8, 1),
        period_end=date(2026, 8, 2),
        shifts=[],
        contracts=[
            make_contract(
                STAFF_A,
                min_shifts=1,
                target_shifts=1,
                max_shifts=3,
                start=date(2026, 8, 1),
                end=date(2026, 8, 2),
            )
        ],
        availability_days=[
            make_availability_day(STAFF_A, date(2026, 8, 1)),
            make_availability_day(STAFF_A, date(2026, 8, 2)),
        ],
    )
    payload = make_payload([], context=context)
    response_json = post_validate(client, payload)
    boundary_warning = next(
        item
        for item in response_json["warnings"]
        if item["rule_id"] == "WNC-HARD-003"
        and item["code"] == "insufficient_boundary_context"
    )
    assert boundary_warning["staff_id"] is None
    assert boundary_warning["week_start"] == "2026-07-27"
    assert boundary_warning["details"]["affected_staff_count"] == 1
    assert boundary_warning["details"]["period_start_date"] == "2026-08-01"
    assert boundary_warning["details"]["period_end_date"] == "2026-08-02"


def test_complete_weeks_enforce_weekly_minimums(client: TestClient) -> None:
    context = make_context(
        contracts=[make_contract(STAFF_A, min_shifts=2, target_shifts=2, max_shifts=4)]
    )
    payload = make_payload([make_assignment("shift-1", STAFF_A)], context=context)
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-003", "weekly_minimum_not_met") in issue_codes(
        response_json, "errors"
    )


def test_malformed_uuids_return_fastapi_422(client: TestClient) -> None:
    response = client.post(
        "/v1/schedules/validate",
        headers={"X-Engine-API-Key": "test-engine-key"},
        json={
            **make_payload([]),
            "generation_run_id": "not-a-uuid",
        },
    )
    assert response.status_code == 422


def test_authentication_remains_required(client: TestClient) -> None:
    response = client.post("/v1/schedules/validate", json=make_payload([]))
    assert response.status_code == 401


def test_alias_staff_id_is_accepted(client: TestClient) -> None:
    payload = make_payload([make_assignment("shift-1", STAFF_A, staff_field="staff_id")])
    response_json = post_validate(client, payload)
    assert response_json["valid"] is True


def test_phase_1_without_mentor_history_creates_review_item(client: TestClient) -> None:
    shifts = [make_shift("shift-1", date(2026, 7, 6), "morning", required_count=2)]
    context = make_context(
        staff=[make_staff(STAFF_A, mentor=False), make_staff(STAFF_B)],
        shifts=shifts,
        contracts=[make_contract(STAFF_A), make_contract(STAFF_B)],
        training=[
            make_training(STAFF_A, "phase_3_fully_trained"),
            make_training(STAFF_B, "phase_1_shadow_only"),
        ],
        submissions=[make_submission(STAFF_A), make_submission(STAFF_B)],
    )
    payload = make_payload(
        [
            make_assignment("shift-1", STAFF_A, assignment_kind="primary"),
            make_assignment("shift-1", STAFF_B, assignment_kind="shadow"),
        ],
        context=context,
    )
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-012", "mentor_history_unavailable") in issue_codes(
        response_json, "review_items"
    )


def test_unknown_training_phase_is_a_validation_error(client: TestClient) -> None:
    context = make_context(training=[make_training(STAFF_A, "mystery_phase")])
    payload = make_payload([make_assignment("shift-1", STAFF_A)], context=context)
    response_json = post_validate(client, payload)
    assert ("WNC-HARD-011", "unknown_training_phase") in issue_codes(
        response_json, "errors"
    )


def test_no_database_or_external_network_call_occurs(client: TestClient, monkeypatch) -> None:
    def fail_if_network_connect(*args, **kwargs):
        raise AssertionError("Unexpected network connection attempt.")

    monkeypatch.setattr(socket.socket, "connect", fail_if_network_connect)
    response_json = post_validate(client, make_payload([make_assignment("shift-1", STAFF_A)]))
    assert response_json["valid"] is True
