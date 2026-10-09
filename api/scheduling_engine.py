"""Website-owned solver endpoint. Uses the caller's Supabase session and RLS."""
import json
import os
import sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "scheduling-engine"))
from app.generator import generate_schedule
from app.models import GenerateScheduleRequest


def supabase_request(path, token, data=None, method=None):
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + path
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    request = Request(url, data=json.dumps(data).encode() if data is not None else None,
                      headers={"apikey": key, "Authorization": token, "Content-Type": "application/json", "Prefer": "return=representation"}, method=method)
    with urlopen(request, timeout=20) as response:
        content = response.read()
        return json.loads(content) if content else None


def run_schedule(body, token):
    run_id, period_id = str(UUID(body["generation_run_id"])), str(UUID(body["period_id"]))
    user = supabase_request("/auth/v1/user", token)
    profiles = supabase_request(f"/rest/v1/profiles?id=eq.{user['id']}&select=app_role,is_active", token)
    if not profiles or not profiles[0]["is_active"] or profiles[0]["app_role"] not in ("admin", "manager"):
        raise PermissionError("Manager access required.")
    # Claim a queued run atomically; replayed requests cannot run the solver twice.
    claimed = supabase_request(f"/rest/v1/schedule_generation_runs?id=eq.{run_id}&period_id=eq.{period_id}&initiated_by=eq.{user['id']}&status=eq.queued", token,
                               {"status": "planning", "current_stage": "planning"}, "PATCH")
    if not claimed:
        raise ValueError("Generation run is no longer queued. Refresh the schedule.")
    try:
        context = supabase_request("/rest/v1/rpc/get_schedule_planning_context", token, {"p_period_id": period_id})
        payload = GenerateScheduleRequest.model_validate({"generation_run_id": run_id, "period_id": period_id, "rules_version": "2", "planning_context": context,
                    "engine_configuration": {"max_solve_seconds": 60}})
        result = generate_schedule(payload, engine_version="0.4.2", rules_version="2").response.model_dump(mode="json", by_alias=False)
        assignments = result["draft_assignments"]
        if assignments:
            supabase_request("/rest/v1/rpc/save_generated_schedule_draft", token,
                              {"p_generation_run_id": run_id, "p_period_id": period_id, "p_assignments": assignments, "p_proposed_shifts": result.get("proposed_shifts", [])})
        validation = result["validation"]
        metadata = {**claimed[0].get("metadata", {}), **result, "manager_review": {
            "status": result["generation_status"], "headline": "Review generated schedule",
            "ready_for_commit": validation["ready_for_commit"], "requires_human_review": True,
            "blocking_issues": validation["errors"], "soft_warnings": [x["message"] for x in validation["warnings"]],
            "human_review_flags": [x["message"] for x in validation["review_items"]],
            "next_actions": ["Review the draft and resolve blocking issues, then revalidate before publishing."]}}

        from datetime import datetime, timezone
        supabase_request(f"/rest/v1/schedule_generation_runs?id=eq.{run_id}", token,
                          {"status": "completed" if assignments else "failed", "current_stage": "completed" if assignments else "manager_review_required", "metadata": metadata,
                           "completed_at": datetime.now(timezone.utc).isoformat(), "failure_message": None if assignments else "No feasible schedule found. Review availability and constraints."}, "PATCH")
        return {"ok": True, "message": "Draft created. Review and revalidate before publishing." if assignments else "No feasible draft found. Review the generation details."}
    except Exception:
        supabase_request(f"/rest/v1/schedule_generation_runs?id=eq.{run_id}", token,
                          {"status": "failed", "current_stage": "failed", "failure_message": "Generation failed or availability changed. Review readiness and try again."}, "PATCH")
        raise


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond(200, {"status": "ready", "service": "scheduling-engine"})

    def do_POST(self):
        token = self.headers.get("Authorization", "")
        if not token.startswith("Bearer "):
            return self.respond(401, {"message": "Sign in to generate schedules."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 4096:
                return self.respond(400, {"message": "Invalid request."})
            result = run_schedule(json.loads(self.rfile.read(length)), token)
            self.respond(200, result)
        except PermissionError:
            self.respond(403, {"message": "Manager access required."})
        except HTTPError as error:
            self.respond(400 if error.code < 500 else 502, {"message": "Scheduling could not complete. Refresh and check the generation details."})
        except (ValueError, KeyError):
            self.respond(400, {"message": "Scheduling inputs changed or are incomplete. Refresh and try again."})
        except Exception:
            self.respond(500, {"message": "Schedule generation failed. Please try again."})

    def respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())
