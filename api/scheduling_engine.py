"""Authenticated review API and signed durable-worker entrypoint."""
import json
import sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "scheduling-engine"))
from app.runtime.database import DatabaseError, DeadlineExceeded, log_event
from app.runtime.security import verify_worker
from app.runtime.worker import process_run, review_draft


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond(200, {"status": "ready", "service": "scheduling-engine"})

    def do_POST(self):
        request_id = None
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                return self.respond(400, {"message": "Invalid request."})
            raw = self.rfile.read(length)
            body = json.loads(raw)
            if not isinstance(body, dict):
                return self.respond(400, {"message": "Invalid request."})
            if self.headers.get("X-Schedule-Signature"):
                if not verify_worker(raw, self.headers.get("X-Schedule-Timestamp"), self.headers.get("X-Schedule-Signature")):
                    return self.respond(403, {"message": "Worker authorization failed."})
                request_id = str(UUID(body["run_id"]))
                return self.respond(200, process_run(request_id))
            token = self.headers.get("Authorization", "")
            if not token.startswith("Bearer "):
                return self.respond(401, {"message": "Sign in to check schedules."})
            if body.get("action") not in ("validate", "publish"):
                return self.respond(400, {"message": "Use the website to queue generation."})
            self.respond(200, review_draft(body["period_id"], token, publish=body["action"] == "publish"))
        except DatabaseError as error:
            log_event("schedule.api_error", request_id=request_id, error_code=error.code, error_type="DatabaseError")
            status = 503 if error.retryable else 403 if error.code == "42501" or error.status in (401,403) else 409
            self.respond(status, {"message": "Inputs or draft changed. Refresh and check again." if status == 409 else
                "You do not have permission to check this schedule." if status == 403 else "Scheduling is temporarily unavailable. Please try again."})
        except (ValueError, KeyError, TypeError):
            self.respond(400, {"message": "Invalid schedule request."})
        except DeadlineExceeded:
            self.respond(503, {"message": "The schedule check timed out. Please try again."})
        except Exception as error:
            log_event("schedule.api_error", request_id=request_id, error_type=type(error).__name__, error_code="unexpected_error")
            self.respond(503, {"message": "Scheduling is temporarily unavailable. Please try again."})

    def log_message(self, format, *args):
        # BaseHTTPRequestHandler's default logs can include request URLs/tokens.
        pass

    def respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())
