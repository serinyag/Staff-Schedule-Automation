import copy
import time
from uuid import UUID
from app.generator import generate_schedule
from app.generator.flexible import flexible_context, comparison
from app.models import GenerateScheduleRequest, PlanningContext, DraftAssignment
from app.validator import validate_schedule
from app.runtime.database import Database, DatabaseError, DeadlineExceeded, log_event
from app.runtime.security import ENGINE_VERSION, RULES_VERSION


def validation_for(context, assignments, mode="standard"):
    parsed = PlanningContext.model_validate(context)
    if mode == "flexible":
        parsed, _ = flexible_context(parsed)
    return validate_schedule(planning_context=parsed,
        assignments=[DraftAssignment.model_validate(a) for a in assignments],
        engine_version=ENGINE_VERSION, rules_version=RULES_VERSION).model_dump(mode="json")


def process_run(run_id, db=None):
    run_id = str(UUID(run_id))
    db = db or Database()
    job = db.rpc("claim_schedule_job", p_run_id=run_id)
    if job["state"] in ("done", "failed"):
        return {"ok": True, "state": job["state"]}
    if job["state"] == "busy":
        return {"ok": False, "state": "retry"}
    started = time.monotonic()
    lease = job["lease_token"]
    period_id = job["period_id"]
    log_event("schedule.started", run_id=run_id, period_id=period_id, attempt=job["attempt"])
    stage = "planning"
    try:
        context, mode = job["context"], job["mode"]
        baseline = job["baseline"]
        if mode == "adopt_flexible":
            preview = job["preview"]
            if preview.get("engine_version") != ENGINE_VERSION:
                raise ValueError("Obsolete preview")
            result = copy.deepcopy(preview)
            result["generation_run_id"] = run_id
        else:
            parsed = PlanningContext.model_validate(context)
            caps = None
            if mode == "flexible_preview":
                if not baseline:
                    raise ValueError("Missing standard draft")
                parsed, caps = flexible_context(parsed)
            payload = GenerateScheduleRequest(generation_run_id=run_id, period_id=period_id,
                rules_version=RULES_VERSION, planning_context=parsed,
                engine_configuration={"max_solve_seconds": 60})
            result = generate_schedule(payload, engine_version=ENGINE_VERSION,
                rules_version=RULES_VERSION).response.model_dump(mode="json")
            if mode == "flexible_preview":
                result["comparison"] = comparison(PlanningContext.model_validate(context), baseline, result, caps)
        stage = "validating"
        log_event("schedule.validating", run_id=run_id, stage=stage)
        # Adoption and generation both pass the same validator. Include selected proposals.
        validation_context = {**context, "shifts": [*context["shifts"], *result.get("proposed_shifts", [])]}
        result["validation"] = validation_for(validation_context, result["draft_assignments"],
            "flexible" if mode in ("adopt_flexible", "flexible_preview") else "standard")
        result["duration_ms"] = int((time.monotonic() - started) * 1000)
        stage = "saving"
        saved = db.rpc("finish_schedule_job", p_run_id=run_id, p_lease_token=lease, p_result=result)
        log_event("schedule.completed", run_id=run_id, period_id=period_id, duration_ms=result["duration_ms"])
        return {"ok": True, "state": saved["state"]}
    except Exception as error:
        transient = isinstance(error, DeadlineExceeded) or isinstance(error, DatabaseError) and error.retryable
        code = "runtime_timeout" if isinstance(error, DeadlineExceeded) else "database_unavailable" if transient else "inputs_changed" if isinstance(error, DatabaseError) and error.code == "P0001" else "invalid_result" if isinstance(error, ValueError) else "runtime_error"
        log_event("schedule.failed", run_id=run_id, period_id=period_id, error_code=code,
                  error_type=type(error).__name__, stage=stage, duration_ms=int((time.monotonic() - started) * 1000))
        # A fresh, short deadline allows recording failure even after the solve deadline.
        failure_db = db if db is not None and not isinstance(db, Database) else Database(seconds=15)
        try:
            outcome = failure_db.rpc("fail_schedule_job", p_run_id=run_id, p_lease_token=lease,
                                    p_error_code=code, p_retryable=transient)
            return {"ok": outcome["state"] != "retry", "state": outcome["state"]}
        except Exception:
            # Do not replace the original error or falsely acknowledge a job whose state is unknown.
            log_event("schedule.failure_record_unavailable", run_id=run_id, error_code=code)
            raise error


def review_draft(period_id, user_token, publish=False, db=None, user_db=None):
    period_id = str(UUID(period_id))
    snapshot = (user_db or Database(user_token, seconds=25)).rpc("schedule_review_snapshot", p_period_id=period_id)
    validation = validation_for(snapshot["context"], snapshot["assignments"], snapshot["mode"])
    saved = (db or Database(seconds=25)).rpc("record_schedule_validation",
        p_period_id=period_id, p_actor_id=snapshot["actor_id"],
        p_input_hash=snapshot["input_hash"], p_draft_hash=snapshot["draft_hash"],
        p_engine_version=ENGINE_VERSION, p_validation=validation, p_publish=publish)
    return {"ok": True, "ready": saved["ready"], "message":
        "Schedule published." if publish and saved["ready"] else "Schedule checked." if saved["ready"] else
        "Review the flagged schedule issues before publishing.", "validation": validation}
