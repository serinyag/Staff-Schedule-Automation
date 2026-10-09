"""The website endpoint must authenticate, claim once, and save only its own run."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import pytest

spec = importlib.util.spec_from_file_location("website_engine", Path(__file__).resolve().parents[3] / "api/scheduling_engine.py")
website = importlib.util.module_from_spec(spec)
spec.loader.exec_module(website)
BODY = {"generation_run_id": "11111111-1111-4111-8111-111111111111", "period_id": "22222222-2222-4222-8222-222222222222"}

def test_staff_cannot_generate(monkeypatch):
    calls = Mock(side_effect=[{"id": "user"}, [{"app_role": "staff", "is_active": True}]])
    monkeypatch.setattr(website, "supabase_request", calls)
    with pytest.raises(PermissionError):
        website.run_schedule(BODY, "Bearer test")
    assert calls.call_count == 2

def test_duplicate_run_does_not_invoke_solver(monkeypatch):
    calls = Mock(side_effect=[{"id": "user"}, [{"app_role": "manager", "is_active": True}], []])
    solver = Mock()
    monkeypatch.setattr(website, "supabase_request", calls)
    monkeypatch.setattr(website, "generate_schedule", solver)
    with pytest.raises(ValueError):
        website.run_schedule(BODY, "Bearer test")
    solver.assert_not_called()

def test_endpoint_loads_context_and_persists_draft(monkeypatch):
    calls = []
    def db(path, token, data=None, method=None):
        calls.append((path, data, method))
        if path == "/auth/v1/user": return {"id": "user"}
        if path.startswith("/rest/v1/profiles"): return [{"app_role": "manager", "is_active": True}]
        if "status=eq.queued" in path: return [{"metadata": {"availability_revision": 7}}]
        return {}
    result = {"draft_assignments": [{"staff_id": "staff", "shift_id": "shift", "assignment_kind": "shadow"}],
              "proposed_shifts": [{"id": "shift", "shift_type": "day", "is_optional": True}],
              "validation": {"ready_for_commit": True, "errors": [], "warnings": [], "review_items": []}, "generation_status": "feasible"}
    monkeypatch.setattr(website, "supabase_request", db)
    monkeypatch.setattr(website, "GenerateScheduleRequest", SimpleNamespace(model_validate=lambda payload: payload))
    monkeypatch.setattr(website, "generate_schedule", lambda *args, **kwargs: SimpleNamespace(response=SimpleNamespace(model_dump=lambda **kwargs: result)))
    assert website.run_schedule(BODY, "Bearer test")["ok"]
    assert any(path.endswith("get_schedule_planning_context") for path, _, _ in calls)
    saved = next(data for path, data, _ in calls if path.endswith("save_generated_schedule_draft"))
    assert saved["p_assignments"][0]["assignment_kind"] == "shadow"
    assert saved["p_proposed_shifts"] == result["proposed_shifts"]
    assert calls[-1][1]["metadata"]["availability_revision"] == 7
