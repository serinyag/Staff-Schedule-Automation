from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, Request, status

from app.settings import get_app_settings


def require_engine_api_key(
    request: Request,
    x_engine_api_key: str | None = Header(default=None, alias="X-Engine-API-Key"),
) -> None:
    settings = get_app_settings(request)
    expected_key = settings.engine_api_key

    if not expected_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Scheduling engine API key is not configured.",
        )

    if not x_engine_api_key or not secrets.compare_digest(
        x_engine_api_key, expected_key
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing engine API key.",
        )
