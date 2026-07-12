from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.auth import require_engine_api_key
from app.models import DraftPlan, PlanningContext
from app.settings import get_app_settings

router = APIRouter(
    prefix="/v1/schedules",
    tags=["schedules"],
    dependencies=[Depends(require_engine_api_key)],
)


class GenerateScheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_run_id: UUID
    period_id: UUID
    rules_version: str = Field(min_length=1)
    planning_context: PlanningContext
    engine_configuration: dict[str, object] | None = None


class ValidateScheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_run_id: UUID
    period_id: UUID
    rules_version: str = Field(min_length=1)
    planning_context: PlanningContext
    draft_plan: DraftPlan


def not_implemented_payload(
    request: Request,
    *,
    message: str,
) -> dict[str, str]:
    settings = get_app_settings(request)
    return {
        "error": "not_implemented",
        "message": message,
        "engine_version": settings.engine_version,
        "rules_version": settings.rules_version,
    }


@router.post("/generate")
def generate_schedule(
    payload: GenerateScheduleRequest,
    request: Request,
) -> JSONResponse:
    _ = payload
    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content=not_implemented_payload(
            request,
            message="The scheduling engine has not been implemented yet.",
        ),
    )


@router.post("/validate")
def validate_schedule(
    payload: ValidateScheduleRequest,
    request: Request,
) -> JSONResponse:
    _ = payload
    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content=not_implemented_payload(
            request,
            message="The scheduling validator has not been implemented yet.",
        ),
    )
