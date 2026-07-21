from __future__ import annotations

import os
from functools import lru_cache

from fastapi import Request
from pydantic import BaseModel, ConfigDict


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True)

    service_name: str = "wnc-scheduling-engine"
    engine_version: str = "0.3.1"
    rules_version: str = "2"
    app_env: str = "development"
    port: int = 8000
    engine_api_key: str | None = None

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}

    def validate_runtime(self) -> None:
        if self.is_production and not self.engine_api_key:
            raise RuntimeError(
                "ENGINE_API_KEY must be configured when APP_ENV is production."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        app_env=os.getenv("APP_ENV", "development"),
        port=int(os.getenv("PORT", "8000")),
        engine_api_key=os.getenv("ENGINE_API_KEY"),
    )


def get_app_settings(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        settings = get_settings()
        request.app.state.settings = settings
    return settings
