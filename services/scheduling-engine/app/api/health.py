from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.auth import require_engine_api_key
from app.settings import get_app_settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request) -> dict[str, str]:
    settings = get_app_settings(request)
    return {
        "status": "ok",
        "service": settings.service_name,
        "engine_version": settings.engine_version,
        "rules_version": settings.rules_version,
    }


@router.get("/version", dependencies=[Depends(require_engine_api_key)])
def version(request: Request) -> dict[str, str]:
    settings = get_app_settings(request)
    return {
        "service": settings.service_name,
        "engine_version": settings.engine_version,
        "rules_version": settings.rules_version,
    }
