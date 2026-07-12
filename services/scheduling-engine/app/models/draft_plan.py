from __future__ import annotations

from typing import Any

from pydantic import RootModel


class DraftPlan(RootModel[dict[str, Any]]):
    """Opaque draft plan returned by a future scheduling implementation."""
