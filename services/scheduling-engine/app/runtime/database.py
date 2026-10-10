"""Bounded database calls and safe diagnostics shared by website workers."""
import json
import logging
import os
import time
import ssl
import certifi
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger("schedule.runtime")


class DatabaseError(Exception):
    def __init__(self, status, code=None):
        self.status, self.code = status, code
        super().__init__("Database request failed")

    @property
    def retryable(self):
        return self.status >= 500 or self.status == 429 or self.code in ("40001", "40P01")


class DeadlineExceeded(Exception):
    pass


class Database:
    def __init__(self, token=None, seconds=125):
        self.token = token
        self.key = (os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")) if token else os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.deadline = time.monotonic() + seconds

    def request(self, path, data=None, method=None):
        remaining = self.deadline - time.monotonic()
        if remaining <= 1:
            raise DeadlineExceeded()
        headers = {"apikey": self.key, "Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = self.token
        elif self.key.startswith("eyJ"):
            headers["Authorization"] = "Bearer " + self.key
        req = Request(os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + path,
            data=json.dumps(data).encode() if data is not None else None, method=method,
            headers=headers)
        try:
            with urlopen(req, timeout=min(15, remaining), context=ssl.create_default_context(cafile=certifi.where())) as response:
                body = response.read()
                return json.loads(body) if body else None
        except HTTPError as error:
            try:
                code = json.loads(error.read()).get("code")
            except (ValueError, AttributeError):
                code = None
            raise DatabaseError(error.code, code) from None
        except (URLError, TimeoutError):
            raise DatabaseError(503) from None

    def rpc(self, name, **arguments):
        return self.request("/rest/v1/rpc/" + name, arguments)


def log_event(event, **fields):
    # Explicit allowlist: no credentials, full planning inputs, names or exception messages.
    allowed = {key: value for key, value in fields.items() if key in
        ("run_id", "period_id", "stage", "duration_ms", "error_code", "error_type", "attempt", "request_id")}
    logger.warning(json.dumps({"event": event, **allowed}, sort_keys=True))
