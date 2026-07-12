from __future__ import annotations

import socket

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import get_settings

VALID_VALIDATE_REQUEST = {
    "generation_run_id": "56a5944b-286d-4a9c-bc2c-6f89739ed2b1",
    "period_id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
    "rules_version": "2",
    "planning_context": {},
    "draft_plan": {},
}


@pytest.fixture
def client(monkeypatch) -> TestClient:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("ENGINE_API_KEY", "test-engine-key")
    get_settings.cache_clear()

    with TestClient(create_app()) as test_client:
        yield test_client

    get_settings.cache_clear()


def test_validate_returns_structured_501_for_valid_request(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_network_connect(*args, **kwargs):
        raise AssertionError("Unexpected network connection attempt.")

    monkeypatch.setattr(socket.socket, "connect", fail_if_network_connect)

    response = client.post(
        "/v1/schedules/validate",
        headers={"X-Engine-API-Key": "test-engine-key"},
        json=VALID_VALIDATE_REQUEST,
    )

    assert response.status_code == 501
    assert response.json() == {
        "error": "not_implemented",
        "message": "The scheduling validator has not been implemented yet.",
        "engine_version": "0.1.0",
        "rules_version": "2",
    }
