from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import get_settings


def test_version_returns_401_without_api_key(client: TestClient) -> None:
    response = client.get("/version")

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or missing engine API key."


def test_version_returns_401_with_incorrect_api_key(client: TestClient) -> None:
    response = client.get("/version", headers={"X-Engine-API-Key": "wrong-key"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or missing engine API key."


def test_version_succeeds_with_correct_api_key(client: TestClient) -> None:
    response = client.get("/version", headers={"X-Engine-API-Key": "test-engine-key"})

    assert response.status_code == 200
    assert response.json() == {
        "service": "wnc-scheduling-engine",
        "engine_version": "0.3.0",
        "rules_version": "2",
    }


def test_startup_fails_in_production_without_engine_api_key(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ENGINE_API_KEY", raising=False)
    get_settings.cache_clear()

    with pytest.raises(RuntimeError, match="ENGINE_API_KEY must be configured"):
        with TestClient(create_app()):
            pass

    get_settings.cache_clear()
