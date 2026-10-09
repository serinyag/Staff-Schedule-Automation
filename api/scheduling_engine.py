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

ENGINE_VERSION = "0.7.0"


def supabase_request(path, token, data=None, method=None):
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + path
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    request = Request(url, data=json.dumps(data).encode() if data is not None else None,
                      headers={"apikey": key, "Authorization": token, "Content-Type": "application/json", "Prefer": "return=representation"}, method=method)
    with urlopen(request, timeout=20) as response:
        content = response.read()
        return json.loads(content) if content else None


def saved_draft(period_id, token):
    rows = supabase_request(f"/rest/v1/shift_assignments?select=staff_id,shift_id,assignment_kind,shifts!inner(period_id)&shifts.period_id=eq.{period_id}&lifecycle=eq.draft&status=eq.assigned", token)
    return [{k:v for k,v in row.items() if k != "shifts"} for row in rows]


def assignment_signature(rows):
    return sorted((a['staff_id'], a['shift_id'], a.get('assignment_kind', 'coverage')) for a in rows)


def context_fingerprint(context):
    import hashlib
    # Only volatile query timestamps are excluded. Availability, rules and contracts
    # must still match when the manager adopts a stored alternative.
    def stable_value(value):
        if isinstance(value, dict):
            return {k: stable_value(v) for k,v in value.items() if k not in ("generated_at", "updated_at", "created_at")}
        if isinstance(value, list):
            return [stable_value(v) for v in value]
        return value
    stable = stable_value(context)
    return hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()


def run_schedule(body, token):
    mode = body.get("mode", "standard")
    if mode not in ("standard", "flexible_preview", "adopt_flexible"):
        raise ValueError("Unknown scheduling mode.")
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
        from app.generator.flexible import flexible_context, comparison
        if mode == "adopt_flexible":
            source_id = str(UUID(body["preview_run_id"]))
            source = supabase_request(f"/rest/v1/schedule_generation_runs?id=eq.{source_id}&period_id=eq.{period_id}&select=metadata", token)
            metadata = source[0]["metadata"] if source else {}
            if metadata.get("preview_kind") != "flexible" or metadata.get("context_fingerprint") != context_fingerprint(context):
                raise ValueError("The inputs changed. Generate a fresh flexible preview.")
            if assignment_signature(saved_draft(period_id, token)) != assignment_signature(metadata['comparison']['standard_assignments']):
                raise ValueError("The saved draft changed. Generate a new comparison first.")
            result = metadata["preview_result"]
            if result.get("engine_version") != ENGINE_VERSION:
                raise ValueError("Scheduling rules changed. Generate a fresh flexible preview.")
            result["generation_run_id"] = run_id
        else:
            payload = GenerateScheduleRequest.model_validate({"generation_run_id": run_id, "period_id": period_id, "rules_version": "2", "planning_context": context,
                        "engine_configuration": {"max_solve_seconds": 60}})
            caps = None
            if mode == "flexible_preview":
                baseline = saved_draft(period_id, token)
                if not baseline:
                    raise ValueError("Generate a standard draft first.")
                flex, caps = flexible_context(payload.planning_context)
                payload = payload.model_copy(update={"planning_context": flex})
            result = generate_schedule(payload, engine_version=ENGINE_VERSION, rules_version="2").response.model_dump(mode="json", by_alias=False)
            if mode == "flexible_preview":
                # Compare with the saved standard draft, without replacing its assignments.
                if assignment_signature(saved_draft(period_id, token)) != assignment_signature(baseline):
                    raise ValueError("The draft changed during comparison. Try again.")
                from app.models import PlanningContext
                review = comparison(PlanningContext.model_validate(context), baseline, result, caps)
                preview_metadata = {**claimed[0].get("metadata", {}), "preview_kind":"flexible", "preview_result":result,
                    "comparison":review, "context_fingerprint":context_fingerprint(context)}
                from datetime import datetime, timezone
                supabase_request(f"/rest/v1/schedule_generation_runs?id=eq.{run_id}", token,
                    {"status":"completed", "current_stage":"flexible_preview", "metadata":preview_metadata,
                     "completed_at":datetime.now(timezone.utc).isoformat()}, "PATCH")
                return {"ok":True,"message":"Flexible preview ready. Compare it with the saved draft before choosing a version."}
        assignments = result["draft_assignments"]
        if assignments:
            supabase_request("/rest/v1/rpc/save_generated_schedule_draft", token,
                              {"p_generation_run_id": run_id, "p_period_id": period_id, "p_assignments": assignments, "p_proposed_shifts": result.get("proposed_shifts", [])})
        validation = result["validation"]
        metadata = {**claimed[0].get("metadata", {}), **result, "schedule_mode": "flexible" if mode == "adopt_flexible" else "standard",
            "adopted_preview_id": body.get("preview_run_id") if mode == "adopt_flexible" else None,
            "redistribution": metadata.get("comparison") if mode == "adopt_flexible" else None, "manager_review": {
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
            self.respond(400, {"message": "Inputs or the saved draft changed, or required data is missing. Refresh and generate a new preview before choosing it."})
        except Exception:
            self.respond(500, {"message": "Schedule generation failed. Please try again."})

    def respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())
