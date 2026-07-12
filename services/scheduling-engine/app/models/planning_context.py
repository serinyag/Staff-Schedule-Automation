from __future__ import annotations

from typing import Any

from pydantic import RootModel


class PlanningContext(RootModel[dict[str, Any]]):
    """Opaque planning snapshot supplied by the orchestration layer."""
