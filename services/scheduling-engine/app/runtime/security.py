import hashlib
import hmac
import os
import time

ENGINE_VERSION = "0.8.0"
RULES_VERSION = "2"


def worker_signature(body, timestamp, key=None):
    secret = key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return hmac.new(secret.encode(), b"schedule-worker-v1\n" + str(timestamp).encode() + b"\n" + body,
                    hashlib.sha256).hexdigest()


def verify_worker(body, timestamp, signature, now=None):
    try:
        if abs((now or time.time()) - int(timestamp)) > 90:
            return False
        return hmac.compare_digest(worker_signature(body, timestamp), signature or "")
    except (ValueError, TypeError, KeyError):
        return False
