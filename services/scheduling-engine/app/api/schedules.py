from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.generator import GeneratorInvariantError, generate_schedule as run_generation
from app.auth import require_engine_api_key
from app.models import (
    DraftPlan,
    GenerateScheduleRequest,
    GenerateScheduleResponse,
    PlanningContext,
    ValidationResponse,
)
from app.settings import get_app_settings
from app.validator import validate_schedule as run_validation

router = APIRouter(
    prefix="/v1/schedules",
    tags=["schedules"],
    dependencies=[Depends(require_engine_api_key)],
)


class ValidateScheduleRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "generation_run_id": "56a5944b-286d-4a9c-bc2c-6f89739ed2b1",
                "period_id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
                "rules_version": "2",
                "planning_context": {
                    "period": {
                        "id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
                        "start_date": "2026-07-06",
                        "end_date": "2026-07-12",
                        "monthly_staff_budget_eur": 12000,
                    },
                    "staff": [],
                    "shifts": [],
                    "training": [],
                    "contracts": [],
                    "availability_days": [],
                    "availability_submissions": [],
                },
                "draft_plan": {"assignments": []},
            }
        },
    )

    generation_run_id: UUID
    period_id: UUID
    rules_version: str = Field(min_length=1)
    planning_context: PlanningContext
    draft_plan: DraftPlan


@router.post(
    "/generate",
    response_model=GenerateScheduleResponse,
)
def generate_schedule(
    payload: GenerateScheduleRequest,
    request: Request,
) -> GenerateScheduleResponse | JSONResponse:
    settings = get_app_settings(request)
    try:
        result = run_generation(
            payload,
            engine_version=settings.engine_version,
            rules_version=payload.rules_version,
        )
    except GeneratorInvariantError as exc:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": "generator_validation_mismatch",
                "message": "Generated draft failed internal invariant validation.",
                "details": exc.details,
                "engine_version": settings.engine_version,
                "rules_version": settings.rules_version,
            },
        )
    return result.response


@router.post(
    "/validate",
    response_model=ValidationResponse,
    responses={
        200: {
            "description": "Deterministic validator response",
        }
    },
)
def validate_schedule(
    payload: ValidateScheduleRequest,
    request: Request,
) -> ValidationResponse:
    settings = get_app_settings(request)
    return run_validation(
        planning_context=payload.planning_context,
        assignments=payload.draft_plan.assignments,
        engine_version=settings.engine_version,
        rules_version=payload.rules_version,
    )
