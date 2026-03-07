"""
Rate limiter for auth endpoints.

Two independent buckets per auth attempt:
  - per USERNAME  — prevents targeted account attacks
  - per IP        — prevents distributed attacks across accounts

Lockout is progressive:
  attempts 1-3  → no lockout, just count
  attempt  4-5  → 30 second lockout on each failure
  attempt  6+   → 5 minute lockout on each failure
  attempt  10+  → 1 hour lockout

All state is in-memory. Restarting the server resets limits.
A background cleanup removes stale entries every 10 minutes.
"""

import time
import threading

# { key: {"count": int, "locked_until": float, "first_attempt": float} }
_BUCKETS: dict = {}
_LOCK = threading.Lock()

# Progressive lockout durations based on attempt count
def _lockout_seconds(count: int) -> int:
    if count < 4:  return 0
    if count < 6:  return 30
    if count < 10: return 300   # 5 min
    return 3600                  # 1 hour

MAX_ATTEMPTS_BEFORE_HARD_LOCK = 10  # after this, 1hr lockouts every attempt


def _key(prefix: str, identifier: str) -> str:
    return f"{prefix}:{identifier}"


def check(username: str, ip: str) -> tuple[bool, int]:
    """
    Returns (allowed, retry_after_seconds).
    retry_after_seconds is 0 if allowed.
    """
    now = time.time()
    with _LOCK:
        for k in [_key("user", username), _key("ip", ip)]:
            bucket = _BUCKETS.get(k)
            if not bucket:
                continue
            if now < bucket["locked_until"]:
                wait = int(bucket["locked_until"] - now) + 1
                return False, wait
    return True, 0


def record_failure(username: str, ip: str):
    """Call after every failed auth attempt."""
    now = time.time()
    with _LOCK:
        for k in [_key("user", username), _key("ip", ip)]:
            if k not in _BUCKETS:
                _BUCKETS[k] = {"count": 0, "locked_until": 0.0, "first_attempt": now}
            b = _BUCKETS[k]
            b["count"] += 1
            lockout = _lockout_seconds(b["count"])
            if lockout > 0:
                b["locked_until"] = now + lockout


def record_success(username: str, ip: str):
    """Call after every successful auth — resets the username bucket only."""
    with _LOCK:
        k = _key("user", username)
        if k in _BUCKETS:
            del _BUCKETS[k]
        # intentionally keep IP bucket — IP that had many failures still stays
        # limited briefly to prevent credential-stuffing success from resetting it


def get_status(username: str, ip: str) -> dict:
    """Returns debug info about current rate limit state."""
    now = time.time()
    result = {}
    with _LOCK:
        for label, k in [("user", _key("user", username)), ("ip", _key("ip", ip))]:
            b = _BUCKETS.get(k)
            if b:
                result[label] = {
                    "attempts":      b["count"],
                    "locked":        now < b["locked_until"],
                    "retry_after":   max(0, int(b["locked_until"] - now)),
                }
            else:
                result[label] = {"attempts": 0, "locked": False, "retry_after": 0}
    return result


def cleanup():
    """Remove entries that have been unlocked for >10 minutes."""
    now = time.time()
    with _LOCK:
        stale = [k for k, b in _BUCKETS.items()
                 if b["locked_until"] < now - 600 and b["count"] < 3]
        for k in stale:
            del _BUCKETS[k]


# Background cleanup thread
def _cleanup_loop():
    while True:
        time.sleep(600)
        cleanup()

_t = threading.Thread(target=_cleanup_loop, daemon=True)
_t.start()