from __future__ import annotations

import socket
from copy import deepcopy
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.test_validate_v1 import (
    PERIOD_ID,
    STAFF_A,
    STAFF_B,
    STAFF_C,
    make_assignment,
    make_availability_day,
    make_context,
    make_contract,
    make_shift,
    make_staff,
    make_submission,
    make_training,
    stable_uuid,
)

VALID_GENERATE_REQUEST = {
    "generation_run_id": "56a5944b-286d-4a9c-bc2c-6f89739ed2b1",
    "period_id": PERIOD_ID,
    "rules_version": "2",
    "planning_context": make_context(),
    "engine_configuration": {
        "max_solve_seconds": 5,
        "random_seed": 42,
        "include_shadow_assignments": True,
        "diagnostics_level": "summary",
    },
}


def post_generate(client: TestClient, payload: dict[str, object]) -> dict[str, object]:
    response = client.post(
        "/v1/schedules/generate",
        headers={"X-Engine-API-Key": "test-engine-key"},
        json=payload,
    )
    assert response.status_code == 200
    return response.json()


def test_generate_returns_401_without_authentication(client: TestClient) -> None:
    response = client.post("/v1/schedules/generate", json=VALID_GENERATE_REQUEST)
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or missing engine API key."


def test_generate_rejects_malformed_uuids(client: TestClient) -> None:
    response = client.post(
        "/v1/schedules/generate",
        headers={"X-Engine-API-Key": "test-engine-key"},
        json={
            **VALID_GENERATE_REQUEST,
            "generation_run_id": "not-a-uuid",
            "period_id": "",
        },
    )
    assert response.status_code == 422


def test_generate_basic_feasible_schedule(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        socket.socket,
        "connect",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Unexpected network connection attempt.")
        ),
    )
    response_json = post_generate(client, VALID_GENERATE_REQUEST)
    assert response_json["generation_status"] in {"optimal", "feasible"}
    assert response_json["engine_version"] == "0.3.0"
    assert response_json["draft_assignments"][0]["assignment_kind"] == "coverage"
    assert response_json["validation"]["valid"] is True
    assert response_json["draft_plan"]["uncovered_shifts"] == []


def test_generate_is_deterministic_for_identical_seed(client: TestClient) -> None:
    first = post_generate(client, VALID_GENERATE_REQUEST)
    second = post_generate(client, VALID_GENERATE_REQUEST)
    assert first["draft_assignments"] == second["draft_assignments"]
    assert first["solver"]["objective_values"] == second["solver"]["objective_values"]


def test_generate_is_stable_when_input_arrays_are_shuffled(client: TestClient) -> None:
    ordered = {
        **VALID_GENERATE_REQUEST,
        "planning_context": make_context(
            staff=[make_staff(STAFF_A, mentor=True), make_staff(STAFF_B)],
            shifts=[
                make_shift("shift-1", date(2026, 7, 6), "morning"),
                make_shift("shift-2", date(2026, 7, 7), "evening"),
            ],
            contracts=[make_contract(STAFF_A, end=None), make_contract(STAFF_B, end=None)],
            training=[make_training(STAFF_A), make_training(STAFF_B)],
            availability_days=[
                make_availability_day(staff_id, current_date)
                for staff_id in [STAFF_A, STAFF_B]
                for current_date in [date(2026, 7, 6), date(2026, 7, 7)]
            ],
            submissions=[make_submission(STAFF_A), make_submission(STAFF_B)],
        ),
    }
    shuffled = deepcopy(ordered)
    shuffled["planning_context"]["staff"] = list(reversed(shuffled["planning_context"]["staff"]))
    shuffled["planning_context"]["shifts"] = list(reversed(shuffled["planning_context"]["shifts"]))
    shuffled["planning_context"]["contracts"] = list(reversed(shuffled["planning_context"]["contracts"]))
    shuffled["planning_context"]["training"] = list(reversed(shuffled["planning_context"]["training"]))
    shuffled["planning_context"]["availability_days"] = list(
        reversed(shuffled["planning_context"]["availability_days"])
    )

    ordered_response = post_generate(client, ordered)
    shuffled_response = post_generate(client, shuffled)
    assert ordered_response["draft_assignments"] == shuffled_response["draft_assignments"]


def test_generate_respects_unavailability_and_returns_review_diagnostics(
    client: TestClient,
) -> None:
    payload = {
        **VALID_GENERATE_REQUEST,
        "planning_context": make_context(
            availability_days=[
                make_availability_day(STAFF_A, date(2026, 7, 6), morning=False, day=False, evening=False)
            ],
            contracts=[make_contract(STAFF_A, min_shifts=1)],
        ),
    }
    response_json = post_generate(client, payload)
    assert response_json["generation_status"] == "needs_manager_review"
    assert response_json["draft_assignments"] == []
    assert response_json["draft_plan"]["uncovered_shifts"][0]["reason_codes"] == [
        "no_available_candidate"
    ]
    assert response_json["validation"]["valid"] is False


def test_generate_phase_1_shadow_assignments_are_paired_with_phase_3(client: TestClient) -> None:
    payload = {
        **VALID_GENERATE_REQUEST,
        "planning_context": make_context(
            staff=[make_staff(STAFF_A, mentor=True), make_staff(STAFF_B)],
            shifts=[make_shift("shift-1", date(2026, 7, 6), "morning", required_count=1)],
            contracts=[make_contract(STAFF_A), make_contract(STAFF_B, min_shifts=1)],
            training=[
                make_training(STAFF_A, "phase_3_fully_trained"),
                make_training(STAFF_B, "phase_1_shadow_only"),
            ],
            availability_days=[
                make_availability_day(STAFF_A, date(2026, 7, 6)),
                make_availability_day(STAFF_B, date(2026, 7, 6)),
            ],
            submissions=[make_submission(STAFF_A), make_submission(STAFF_B)],
        ),
    }
    response_json = post_generate(client, payload)
    assignment_kinds = [item["assignment_kind"] for item in response_json["draft_assignments"]]
    assert assignment_kinds == ["coverage", "shadow"]
    assert response_json["validation"]["valid"] is True


def test_shadow_does_not_count_as_primary_coverage(client: TestClient) -> None:
    payload = {
        **VALID_GENERATE_REQUEST,
        "planning_context": make_context(
            staff=[make_staff(STAFF_A, mentor=True), make_staff(STAFF_B)],
            shifts=[make_shift("shift-1", date(2026, 7, 6), "morning", required_count=2)],
            contracts=[make_contract(STAFF_A), make_contract(STAFF_B, min_shifts=1)],
            training=[
                make_training(STAFF_A, "phase_3_fully_trained"),
                make_training(STAFF_B, "phase_1_shadow_only"),
            ],
            availability_days=[
                make_availability_day(STAFF_A, date(2026, 7, 6)),
                make_availability_day(STAFF_B, date(2026, 7, 6)),
            ],
            submissions=[make_submission(STAFF_A), make_submission(STAFF_B)],
        ),
    }
    response_json = post_generate(client, payload)
    assert response_json["generation_status"] == "needs_manager_review"
    assert response_json["draft_plan"]["uncovered_shifts"][0]["missing_count"] == 1


def test_generate_uses_optional_day_shift_to_meet_weekly_minimum(client: TestClient) -> None:
    payload = {
        **VALID_GENERATE_REQUEST,
        "planning_context": make_context(
            staff=[make_staff(STAFF_A, mentor=True), make_staff(STAFF_B)],
            shifts=[
                make_shift("shift-1", date(2026, 7, 6), "morning", required_count=1),
                make_shift("shift-2", date(2026, 7, 7), "day", required_count=1, optional=True),
            ],
            contracts=[make_contract(STAFF_A), make_contract(STAFF_B, min_shifts=1)],
            training=[make_training(STAFF_A), make_training(STAFF_B)],
            availability_days=[
                make_availability_day(STAFF_A, date(2026, 7, 6)),
                make_availability_day(STAFF_B, date(2026, 7, 6)),
                make_availability_day(STAFF_A, date(2026, 7, 7)),
                make_availability_day(STAFF_B, date(2026, 7, 7)),
            ],
            submissions=[make_submission(STAFF_A), make_submission(STAFF_B)],
        ),
    }
    response_json = post_generate(client, payload)
    shift_ids = {item["shift_id"]: item for item in response_json["draft_assignments"]}
    assert stable_uuid("shift-2") in shift_ids
    assert shift_ids[stable_uuid("shift-2")]["planning_reason"] == "optional_day_for_weekly_minimum"


def test_generate_respects_evening_to_next_morning_rest(client: TestClient) -> None:
    payload = {
        **VALID_GENERATE_REQUEST,
        "planning_context": make_context(
            shifts=[
                make_shift("shift-1", date(2026, 7, 6), "evening"),
                make_shift("shift-2", date(2026, 7, 7), "morning"),
            ],
            contracts=[make_contract(STAFF_A, min_shifts=0, target_shifts=2, max_shifts=2, end=None)],
            availability_days=[
                make_availability_day(STAFF_A, date(2026, 7, 6)),
                make_availability_day(STAFF_A, date(2026, 7, 7)),
            ],
        ),
    }
    response_json = post_generate(client, payload)
    assert response_json["generation_status"] == "needs_manager_review"
    assert response_json["validation"]["errors"][0]["rule_id"] in {"WNC-HARD-003", "WNC-HARD-007"}


def test_generate_budget_conflict_never_returns_over_budget_schedule(client: TestClient) -> None:
    payload = {
        **VALID_GENERATE_REQUEST,
        "planning_context": make_context(
            staff=[make_staff(STAFF_A, mentor=True, hourly_rate="100.00")],
            contracts=[make_contract(STAFF_A, min_shifts=1, target_shifts=1, max_shifts=5)],
            budget="100.00",
        ),
    }
    response_json = post_generate(client, payload)
    assert response_json["generation_status"] == "needs_manager_review"
    assert response_json["draft_assignments"] == []
    assert response_json["draft_plan"]["manager_review_suggestions"][0]["code"] in {
        "increase_or_reallocate_budget",
        "review_constraints",
    }


def test_generate_large_month_like_fixture_returns_valid_draft(client: TestClient) -> None:
    start = date(2026, 8, 3)
    end = date(2026, 8, 30)
    staff_ids = [STAFF_A, STAFF_B, STAFF_C, "44444444-4444-4444-4444-444444444444", "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666"]
    staff = [
        make_staff(staff_id, mentor=index == 0, hourly_rate="20.00")
        for index, staff_id in enumerate(staff_ids)
    ]
    training = [
        make_training(staff_ids[0], "phase_3_fully_trained"),
        make_training(staff_ids[1], "phase_3_fully_trained"),
        make_training(staff_ids[2], "phase_2_can_open"),
        make_training(staff_ids[3], "phase_1_shadow_only"),
        make_training(staff_ids[4], "phase_1_shadow_only"),
        make_training(staff_ids[5], "phase_3_fully_trained"),
    ]
    shifts = []
    availability_days = []
    for current_date in [start + timedelta(days=offset) for offset in range((end - start).days + 1)]:
        shifts.append(make_shift(f"{current_date}-morning", current_date, "morning"))
        shifts.append(make_shift(f"{current_date}-evening", current_date, "evening"))
        shifts.append(make_shift(f"{current_date}-day", current_date, "day", optional=True))
        for staff_id in staff_ids:
            availability_days.append(make_availability_day(staff_id, current_date))
    contracts = [
        make_contract(staff_id, min_shifts=2, target_shifts=3, max_shifts=5, start=start, end=end)
        for staff_id in staff_ids
    ]
    submissions = [make_submission(staff_id, willing=True, max_extra=2) for staff_id in staff_ids]
    payload = {
        **VALID_GENERATE_REQUEST,
        "planning_context": make_context(
            period_start=start,
            period_end=end,
            staff=staff,
            shifts=shifts,
            contracts=contracts,
            training=training,
            availability_days=availability_days,
            submissions=submissions,
            budget="20000.00",
        ),
    }
    response_json = post_generate(client, payload)
    assert response_json["generation_status"] in {"optimal", "feasible"}
    assert response_json["validation"]["ready_for_commit"] is True
    assert response_json["draft_plan"]["uncovered_shifts"] == []
    assert any(item["assignment_kind"] == "shadow" for item in response_json["draft_assignments"])
