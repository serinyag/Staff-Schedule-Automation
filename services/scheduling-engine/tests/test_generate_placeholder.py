from __future__ import annotations

import socket

import pytest
from fastapi.testclient import TestClient

VALID_GENERATE_REQUEST = {
    "generation_run_id": "56a5944b-286d-4a9c-bc2c-6f89739ed2b1",
    "period_id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
    "rules_version": "2",
    "planning_context": {
        "period": {
            "id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
            "start_date": "2026-07-06",
            "end_date": "2026-07-12",
            "monthly_staff_budget_eur": 1000,
        }
    },
    "engine_configuration": {},
}


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


def test_generate_returns_structured_501_for_valid_request(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_network_connect(*args, **kwargs):
        raise AssertionError("Unexpected network connection attempt.")

    monkeypatch.setattr(socket.socket, "connect", fail_if_network_connect)

    response = client.post(
        "/v1/schedules/generate",
        headers={"X-Engine-API-Key": "test-engine-key"},
        json=VALID_GENERATE_REQUEST,
    )

    assert response.status_code == 501
    assert response.json() == {
        "error": "not_implemented",
        "message": "The scheduling engine has not been implemented yet.",
        "engine_version": "0.2.1",
        "rules_version": "2",
    }
