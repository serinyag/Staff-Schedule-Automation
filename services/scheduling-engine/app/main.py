from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.health import router as health_router
from app.api.schedules import router as schedules_router
from app.settings import Settings, get_settings

LOGGER_NAME = "wnc_scheduling_engine"


def configure_logging() -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format=(
            "ts=%(asctime)s level=%(levelname)s logger=%(name)s "
            "message=%(message)s"
        ),
    )
    return logging.getLogger(LOGGER_NAME)


def create_app(settings: Settings | None = None) -> FastAPI:
    logger = configure_logging()
    app_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = app_settings
        app_settings.validate_runtime()
        logger.info(
            "service_start env=%s engine_version=%s rules_version=%s",
            app_settings.app_env,
            app_settings.engine_version,
            app_settings.rules_version,
        )
        yield
        logger.info("service_stop")

    app = FastAPI(
        title="WNC Scheduling Engine",
        version=app_settings.engine_version,
        description=(
            "Stateless scheduling-engine API for WNC orchestration with a live deterministic validator and a placeholder generator."
        ),
        lifespan=lifespan,
        openapi_tags=[
            {"name": "health", "description": "Public and private health metadata."},
            {"name": "schedules", "description": "Schedule generation placeholders."},
        ],
    )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        logger.exception("unhandled_exception path=%s", request.url.path, exc_info=exc)
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_server_error",
                "message": "An unexpected error occurred.",
                "engine_version": app_settings.engine_version,
                "rules_version": app_settings.rules_version,
            },
        )

    app.include_router(health_router)
    app.include_router(schedules_router)

    return app
