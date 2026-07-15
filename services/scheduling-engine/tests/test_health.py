from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import get_settings


def test_health_returns_200_without_credentials(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.delenv("ENGINE_API_KEY", raising=False)
    get_settings.cache_clear()

    with TestClient(create_app()) as client:
        response = client.get("/health")

    get_settings.cache_clear()

    assert response.status_code == 200


def test_health_returns_service_metadata(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("ENGINE_API_KEY", "test-engine-key")
    get_settings.cache_clear()

    with TestClient(create_app()) as client:
        response = client.get("/health")

    get_settings.cache_clear()

    assert response.json() == {
        "status": "ok",
        "service": "wnc-scheduling-engine",
        "engine_version": "0.2.1",
        "rules_version": "2",
    }
