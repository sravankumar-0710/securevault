"""
Audit logging — writes structured JSON entries per user.

Each user gets their own log file at:
    users/<username>/meta/audit.log

Each line is a JSON object (newline-delimited JSON / NDJSON):
    {"ts": 1234567890, "action": "LOGIN", "status": "SUCCESS", "ip": "127.0.0.1", "detail": ""}

The global audit.log in security/ still exists for server-level events
(startup, errors) but user auth events go into the per-user file.
"""

import os
import json
import time

# Server-level log (startup, errors, non-user events)
_SERVER_LOG = os.path.join(os.path.dirname(__file__), "audit.log")

# Per-user log lives in users/<username>/meta/audit.log
_BASE_USERS_DIR = os.path.join(os.path.dirname(__file__), "..", "users")

# Human-readable labels for the UI
ACTION_LABELS = {
    "LOGIN":               "Login",
    "LOGIN_BLOCKED":       "Login blocked (rate limit)",
    "LOGOUT":              "Logout",
    "UPLOAD":              "File uploaded",
    "DOWNLOAD":            "File downloaded",
    "DELETE":              "File deleted",
    "CREATE_FOLDER":       "Folder created",
    "DELETE_FOLDER":       "Folder deleted",
    "MOVE":                "File moved",
    "CHANGE_POLICY":       "Policy changed",
    "REENROLL_PASSWORD":   "Password re-enrolled",
    "REENROLL_MOUSE":      "Mouse gesture re-enrolled",
    "REENROLL_KEYSTROKE":  "Keystroke re-enrolled",
    "AIRGESTURE_SETUP":    "Air gesture enrolled",
    "IMAGEPOINTS_SETUP":   "Image points enrolled",
    "DISABLE_AIRGESTURE":  "Air gesture disabled",
    "DISABLE_IMAGEPOINTS": "Image points disabled",
    "DISABLE_MOUSE":       "Mouse gesture disabled",
    "DISABLE_KEYSTROKE":   "Keystroke disabled",
}

STATUS_COLORS = {
    "SUCCESS": "green",
    "FAILED":  "red",
    "BLOCKED": "orange",
}


def log_event(username: str, action: str, status: str, ip: str = "", detail: str = ""):
    """Write a structured log entry to both the per-user and server logs."""
    entry = {
        "ts":     int(time.time()),
        "action": action,
        "status": status,
        "ip":     ip,
        "detail": detail,
    }
    line = json.dumps(entry)

    # Per-user log
    try:
        user_meta = os.path.join(_BASE_USERS_DIR, username, "meta")
        if os.path.exists(user_meta):
            with open(os.path.join(user_meta, "audit.log"), "a") as f:
                f.write(line + "\n")
    except Exception as e:
        print(f"Audit log error (user): {e}")

    # Server log (plain text, human readable)
    try:
        ts_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(entry["ts"]))
        with open(_SERVER_LOG, "a") as f:
            f.write(f"[{ts_str}] USER={username} ACTION={action} STATUS={status} IP={ip}\n")
    except Exception as e:
        print(f"Audit log error (server): {e}")


def read_user_log(username: str, limit: int = 100) -> list:
    """
    Read the most recent `limit` entries for a user.
    Returns list of dicts with added `label` and `color` fields for the UI.
    """
    log_path = os.path.join(_BASE_USERS_DIR, username, "meta", "audit.log")
    if not os.path.exists(log_path):
        return []

    entries = []
    try:
        with open(log_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    entry["label"] = ACTION_LABELS.get(entry.get("action", ""), entry.get("action", ""))
                    entry["color"] = STATUS_COLORS.get(entry.get("status", ""), "gray")
                    entry["ts_str"] = time.strftime(
                        "%Y-%m-%d %H:%M:%S",
                        time.localtime(entry.get("ts", 0))
                    )
                    entries.append(entry)
                except Exception:
                    continue
    except Exception as e:
        print(f"Audit read error: {e}")

    # Return most recent first, capped at limit
    return list(reversed(entries[-limit:]))