from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_sock import Sock
import os
import io
import json
import secrets

from auth.engine import AuthEngine
from auth.airgesture import AirGestureAuth
from auth.imagepoints import ImagePointsAuth
from vault.engine import VaultEngine
from session.manager import SessionManager
from security.audit import log_event
from security.crypto_utils import decrypt_with_key, encrypt_with_key
from policy.manager import PolicyManager
from security.rate_limiter import check as rl_check, record_failure, record_success
from security.user_registry import UserRegistry

app = Flask(__name__, static_folder='static', static_url_path='/static')
sock = Sock(app)
CORS(app, resources={r"/*": {"origins": "*"}})

BASE_USERS_DIR = os.path.join(os.path.dirname(__file__), "users")
_registry = UserRegistry(BASE_USERS_DIR)

BUILTIN_IMAGES = ["city.jpg", "nature.jpg", "room.jpg", "map.jpg", "abstract.jpg"]

# Singleton extractor — MediaPipe model loaded ONCE, reused for all WebSocket connections
_air_extractor = AirGestureAuth("")


import threading

# ── Periodic session cleanup (runs every 5 minutes) ──────────
def _session_cleanup_loop():
    while True:
        time.sleep(300)
        SessionManager.cleanup()

import time
_cleanup_thread = threading.Thread(target=_session_cleanup_loop, daemon=True)
_cleanup_thread.start()

# ─────────────────────────────────────────────────────────────
# MASTER KEY FILE HELPERS
# Master key files are stored with random names (not master.password.enc)
# A method_map.dat file maps method → random filename
# This prevents an attacker from knowing which auth methods a user has
# ─────────────────────────────────────────────────────────────

def _get_method_map(meta_dir: str) -> dict:
    """Load the method→filename map."""
    path = os.path.join(meta_dir, "method_map.dat")
    if os.path.exists(path):
        try:
            return json.load(open(path))
        except Exception:
            return {}
    return {}

def _save_method_map(meta_dir: str, method_map: dict):
    json.dump(method_map, open(os.path.join(meta_dir, "method_map.dat"), "w"))

def _write_master_key(meta_dir: str, method: str, unlock_token: bytes, master_key: bytes):
    """Write master key file with random name, update method map."""
    import secrets as _sec
    method_map = _get_method_map(meta_dir)
    if method not in method_map:
        method_map[method] = _sec.token_hex(16)
        _save_method_map(meta_dir, method_map)
    filename = method_map[method]
    open(os.path.join(meta_dir, filename), "wb").write(
        encrypt_with_key(unlock_token, master_key)
    )

def _get_master_key_path(meta_dir: str, method: str) -> str | None:
    """Get the actual file path for a method's master key."""
    method_map = _get_method_map(meta_dir)
    # Backwards compat: fall back to old predictable names
    if method in method_map:
        return os.path.join(meta_dir, method_map[method])
    old_path = os.path.join(meta_dir, f"master.{method}.enc")
    return old_path if os.path.exists(old_path) else None

def _method_enabled(meta_dir: str, method: str) -> bool:
    return _get_master_key_path(meta_dir, method) is not None



# ─────────────────────────────────────────────────────────────
# SETUP
# ─────────────────────────────────────────────────────────────

@app.route("/setup", methods=["POST"])
def setup_user():
    data              = request.json
    username          = data.get("username")
    password          = data.get("password")
    mouse_samples     = data.get("mouse_samples")
    keystroke_samples = data.get("keystroke_samples")
    enabled           = data.get("enabled", [])
    threshold         = data.get("threshold", 1)
    primary           = data.get("primary")

    if primary not in enabled:
        return jsonify({"error": "Primary must be one of the enabled methods"}), 400
    if threshold > len(enabled):
        return jsonify({"error": "Threshold exceeds enabled methods"}), 400
    if threshold < 1:
        return jsonify({"error": "Threshold must be at least 1"}), 400
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    if _registry.user_exists(username):
        return jsonify({"error": "User already exists"}), 400

    try:
        user_dir = _registry.create_user(username)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    meta_dir    = os.path.join(user_dir, "meta")
    storage_dir = os.path.join(user_dir, "storage")

    from security.crypto_utils import generate_fernet_key
    from auth.password import PasswordAuth
    from auth.mouse import MouseAuth
    from auth.keystroke import KeystrokeAuth

    master_key = generate_fernet_key()

    # PASSWORD
    pw = PasswordAuth(meta_dir)
    password_unlock = pw.setup(password)
    _write_master_key(meta_dir, "password", password_unlock, master_key)

    # MOUSE
    if mouse_samples and "mouse" in enabled:
        if len(mouse_samples) < 3:
            return jsonify({"error": "At least 3 mouse samples required"}), 400
        mouse = MouseAuth(meta_dir)
        mouse_unlock = mouse.setup(mouse_samples)
        _write_master_key(meta_dir, "mouse", mouse_unlock, master_key)

    # KEYSTROKE
    if keystroke_samples and "keystroke" in enabled:
        ks = KeystrokeAuth(meta_dir)
        keystroke_unlock = ks.setup(keystroke_samples[0])
        _write_master_key(meta_dir, "keystroke", keystroke_unlock, master_key)

    # POLICY
    PolicyManager(user_dir).create_policy(master_key, enabled, threshold, primary)

    return jsonify({"message": "User created successfully"})


# ─────────────────────────────────────────────────────────────
# LOGOUT
# ─────────────────────────────────────────────────────────────

@app.route("/logout", methods=["POST"])
def logout():
    token = request.headers.get("Authorization")
    if token:
        SessionManager.invalidate(token)
    return jsonify({"message": "Logged out"})


# ─────────────────────────────────────────────────────────────
# LOGIN
# ─────────────────────────────────────────────────────────────

@app.route("/login", methods=["POST"])
def login():
    data     = request.json
    username = data.get("username", "")
    ip       = request.remote_addr or "unknown"
    print("DEBUG → Received keystroke length:", len(data.get("keystroke", [])))

    # ── Rate limit check ──────────────────────────────────
    allowed, retry_after = rl_check(username, ip)
    if not allowed:
        log_event(username, "LOGIN", "BLOCKED", ip=ip)
        return jsonify({
            "error": f"Too many failed attempts. Try again in {retry_after} seconds.",
            "retry_after": retry_after
        }), 429

    user_dir = _registry.get_user_dir(username)
    if not user_dir:
        record_failure(username, ip)
        log_event(username, "LOGIN", "FAILED", ip=ip)
        return jsonify({"error": "Invalid credentials"}), 401

    auth_engine      = AuthEngine(user_dir)
    success, result  = auth_engine.authenticate(username, data)

    if not success:
        record_failure(username, ip)
        log_event(username, "LOGIN", "FAILED", ip=ip)
        return jsonify({"error": result, "details": auth_engine.last_results}), 401

    record_success(username, ip)
    session_token = SessionManager.create(username, result["master_key"], result["methods"])
    log_event(username, "LOGIN", "SUCCESS", ip=ip)
    return jsonify({"session_token": session_token})


# ─────────────────────────────────────────────────────────────
# USER POLICY (public — used by login page to know which methods to show)
# ─────────────────────────────────────────────────────────────

@app.route("/user-policy/<username>", methods=["GET"])
def get_user_policy(username):
    user_dir = _registry.get_user_dir(username)
    if not user_dir:
        return jsonify({"error": "User not found"}), 404

    meta_dir = os.path.join(user_dir, "meta")
    methods = [m for m in ["password","keystroke","mouse","airgesture","imagepoints"]
               if _method_enabled(meta_dir, m)]

    # Read public metadata (image id, tracking mode) — written during setup
    pub = {}
    public_meta_path = os.path.join(meta_dir, "public_meta.json")
    if os.path.exists(public_meta_path):
        try:
            pub = json.load(open(public_meta_path))
        except Exception:
            pass

    return jsonify({
        "enabled":                 methods,
        "airgesture_tracking":     pub.get("airgesture_tracking", ["one_hand"]),
        "imagepoints_image_id":    pub.get("imagepoints_image_id"),
        "imagepoints_point_count": pub.get("imagepoints_point_count", 3),
    })


# ─────────────────────────────────────────────────────────────
# VAULT — FILES
# ─────────────────────────────────────────────────────────────

@app.route("/files", methods=["GET"])
def list_files():
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    folder     = request.args.get("folder", "")
    user_dir   = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    result     = VaultEngine(user_dir).list_folder(master_key, folder)
    return jsonify(result)


@app.route("/folders", methods=["POST"])
def create_folder():
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    folder     = request.json.get("folder", "").strip()
    if not folder:
        return jsonify({"error": "Folder name required"}), 400

    user_dir   = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    VaultEngine(user_dir).create_folder(master_key, folder)
    log_event(session["username"], "CREATE_FOLDER", "SUCCESS")
    return jsonify({"message": "Folder created"})


@app.route("/folders/rename", methods=["POST"])
def rename_folder():
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    data     = request.json
    old_path = data.get("old_path", "").strip("/")
    new_path = data.get("new_path", "").strip("/")

    if not old_path or not new_path:
        return jsonify({"error": "old_path and new_path required"}), 400

    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    user_dir   = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    vault      = VaultEngine(user_dir)
    index      = vault.load_index(master_key)

    # Rename all keys that start with old_path/
    old_prefix  = old_path + "/"
    new_prefix  = new_path + "/"
    new_index   = {}

    for key, blob_id in index.items():
        if key == old_prefix or key.startswith(old_prefix):
            new_key = new_prefix + key[len(old_prefix):]
            new_index[new_key] = blob_id
        else:
            new_index[key] = blob_id

    vault._save_index(master_key, new_index)
    log_event(session["username"], "RENAME_FOLDER", "SUCCESS", ip=request.remote_addr or "")
    return jsonify({"message": "Folder renamed"})


@app.route("/folders/<path:folder_path>", methods=["DELETE"])
def delete_folder(folder_path):
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    user_dir   = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    VaultEngine(user_dir).delete_folder(master_key, folder_path)
    log_event(session["username"], "DELETE_FOLDER", "SUCCESS")
    return jsonify({"message": "Folder deleted"})


@app.route("/upload", methods=["POST"])
def upload_file():
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    user_dir   = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file          = request.files["file"]
    folder        = request.form.get("folder", "").strip("/")
    relative_path = request.form.get("relative_path", "").strip("/")

    engine = VaultEngine(user_dir)

    # Auto-create every subfolder in the relative path so nested
    # folder uploads land in the right place without the user having
    # to create them first.
    if relative_path:
        parts        = relative_path.split("/")
        accumulated  = folder.split("/") if folder else []
        for part in parts:
            if not part:
                continue
            accumulated.append(part)
            subfolder_path = "/".join(accumulated)
            try:
                engine.create_folder(master_key, subfolder_path)
            except Exception:
                pass  # already exists — safe to ignore

    engine.add_file(master_key, file.filename, file.read(), folder)
    log_event(session["username"], "UPLOAD", "SUCCESS")
    return jsonify({"message": "File uploaded successfully"})


@app.route("/download/<path:file_path>", methods=["GET"])
def download_file(file_path):
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    user_dir   = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    file_data  = VaultEngine(user_dir).get_file(master_key, file_path)

    if not file_data:
        return jsonify({"error": "File not found"}), 404

    filename = file_path.split("/")[-1]
    return send_file(io.BytesIO(file_data), as_attachment=True, download_name=filename)


@app.route("/preview/<path:file_path>", methods=["GET"])
def preview_file(file_path):
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    user_dir   = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    file_data  = VaultEngine(user_dir).get_file(master_key, file_path)

    if not file_data:
        return jsonify({"error": "File not found"}), 404

    filename = file_path.split("/")[-1].lower()
    ext      = filename.rsplit(".", 1)[-1] if "." in filename else ""

    MIME_MAP = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
        "gif": "image/gif",  "webp": "image/webp", "svg": "image/svg+xml",
        "pdf": "application/pdf",
        "txt": "text/plain", "md":  "text/plain",  "csv": "text/plain",
        "json": "application/json", "py": "text/plain", "js": "text/plain",
        "html": "text/html", "css": "text/plain",
    }
    mime = MIME_MAP.get(ext, "application/octet-stream")

    from flask import Response
    return Response(
        file_data,
        mimetype=mime,
        headers={"Content-Disposition": "inline"}
    )


@app.route("/delete/<path:file_path>", methods=["DELETE"])
def delete_file(file_path):
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    user_dir   = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    success    = VaultEngine(user_dir).delete_file(master_key, file_path)

    if not success:
        return jsonify({"error": "File not found"}), 404

    log_event(session["username"], "DELETE", "SUCCESS")
    return jsonify({"message": "File deleted successfully"})


# ─────────────────────────────────────────────────────────────
# POLICY MANAGEMENT
# ─────────────────────────────────────────────────────────────

@app.route("/move", methods=["POST"])
def move_file():
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    data     = request.json
    old_path = data.get("old_path", "").strip("/")
    new_path = data.get("new_path", "").strip("/")

    if not old_path or not new_path:
        return jsonify({"error": "old_path and new_path required"}), 400

    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    user_dir   = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    success    = VaultEngine(user_dir).rename_file(master_key, old_path, new_path)

    if not success:
        return jsonify({"error": "File not found"}), 404

    log_event(session["username"], "MOVE", "SUCCESS")
    return jsonify({"message": "File moved"})


# ─────────────────────────────────────────────────────────────
# AUDIT LOG
# ─────────────────────────────────────────────────────────────

@app.route("/audit", methods=["GET"])
def get_audit_log():
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    from security.audit import read_user_log
    limit   = min(int(request.args.get("limit", 100)), 500)
    entries = read_user_log(session["username"], limit)
    return jsonify({"entries": entries})


# ─────────────────────────────────────────────────────────────
# SETTINGS — RE-ENROLL & METHOD MANAGEMENT
# ─────────────────────────────────────────────────────────────

@app.route("/settings/methods", methods=["GET"])
def settings_methods():
    """Return which methods the current user has enabled."""
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    meta_dir = os.path.join(BASE_USERS_DIR, session["username"], "meta")
    methods = [m for m in ["password","keystroke","mouse","airgesture","imagepoints"]
               if _method_enabled(meta_dir, m)]
    return jsonify({"enabled": methods})


@app.route("/settings/reenroll", methods=["POST"])
def settings_reenroll():
    """
    Re-register an auth method for the current session user.
    Replaces the existing master key file for that method.
    """
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    data       = request.json
    method     = data.get("method")
    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    username   = session["username"]
    user_dir   = _registry.get_user_dir(username) or os.path.join(BASE_USERS_DIR, username)
    meta_dir   = os.path.join(user_dir, "meta")

    if method == "password":
        from auth.password import PasswordAuth
        import json as _json

        current_pw = data.get("current_password")
        new_pw     = data.get("new_password")
        if not current_pw or not new_pw:
            return jsonify({"error": "current_password and new_password required"}), 400
        if len(new_pw) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400

        pw = PasswordAuth(meta_dir)

        # Verify current password
        ok, _ = pw.verify(current_pw)
        if not ok:
            return jsonify({"error": "Current password is incorrect"}), 401

        # Find and delete the OLD password profile file before creating new one
        # (password.setup() creates a new random-named file each call)
        from security.crypto_utils import derive_key_from_secret, decrypt_with_key as _dec
        for fname in os.listdir(meta_dir):
            fpath = os.path.join(meta_dir, fname)
            # Skip known non-profile files
            if fname.endswith(".enc") or fname.endswith(".json") or fname.endswith(".log"):
                continue
            try:
                with open(fpath) as _f:
                    _d = _json.load(_f)
                if "salt" in _d and "hash" in _d and "encrypted_unlock" in _d:
                    os.remove(fpath)
                    break
            except Exception:
                continue

        # Create new password profile
        unlock_token = pw.setup(new_pw)
        _write_master_key(meta_dir, "password", unlock_token, master_key)

        # Re-enroll keystroke with new password samples if provided
        keystroke_samples = data.get("keystroke_samples")
        if keystroke_samples:
            from auth.keystroke import KeystrokeAuth
            ks       = KeystrokeAuth(meta_dir)
            ks_token = ks.setup(keystroke_samples[0])
            _write_master_key(meta_dir, "keystroke", ks_token, master_key)

        log_event(username, "REENROLL_PASSWORD", "SUCCESS", ip=request.remote_addr or "")

    elif method == "mouse":
        from auth.mouse import MouseAuth
        samples = data.get("mouse_samples", [])
        if len(samples) < 3:
            return jsonify({"error": "At least 3 mouse samples required"}), 400
        mouse = MouseAuth(meta_dir)
        unlock_token = mouse.setup(samples)
        _write_master_key(meta_dir, "mouse", unlock_token, master_key)
        # Update policy to include mouse if not already there
        _ensure_method_in_policy(master_key, user_dir, "mouse")
        log_event(username, "REENROLL_MOUSE", "SUCCESS", ip=request.remote_addr or "")

    elif method == "keystroke":
        from auth.keystroke import KeystrokeAuth
        samples = data.get("keystroke_samples", [])
        if not samples:
            return jsonify({"error": "keystroke_samples required"}), 400
        ks = KeystrokeAuth(meta_dir)
        unlock_token = ks.setup(samples[0])
        _write_master_key(meta_dir, "keystroke", unlock_token, master_key)
        _ensure_method_in_policy(master_key, user_dir, "keystroke")
        log_event(username, "REENROLL_KEYSTROKE", "SUCCESS", ip=request.remote_addr or "")

    else:
        return jsonify({"error": f"Unknown method: {method}"}), 400

    return jsonify({"message": f"{method} re-enrolled successfully"})


@app.route("/settings/disable-method", methods=["POST"])
def disable_method():
    """Remove a method from the user's enabled list."""
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    method = request.json.get("method")
    if method == "password":
        return jsonify({"error": "Cannot disable password"}), 400

    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    username   = session["username"]
    user_dir   = _registry.get_user_dir(username) or os.path.join(BASE_USERS_DIR, username)
    meta_dir   = os.path.join(user_dir, "meta")

    # Remove the master key file for this method
    key_file = _get_master_key_path(meta_dir, method)
    if key_file and os.path.exists(key_file):
        # Overwrite before deleting
        size = os.path.getsize(key_file)
        open(key_file, "wb").write(os.urandom(size))
        os.remove(key_file)
    # Remove from method map
    method_map = _get_method_map(meta_dir)
    if method in method_map:
        del method_map[method]
        _save_method_map(meta_dir, method_map)

    # Remove from policy
    policy_manager = PolicyManager(user_dir)
    try:
        policy = policy_manager.load_policy(master_key)
        if method in policy.get("enabled", []):
            policy["enabled"].remove(method)
        # Adjust threshold if needed
        enabled_count = len(policy["enabled"])
        if policy.get("threshold", 1) > enabled_count:
            policy["threshold"] = max(1, enabled_count)
        # Reset primary if it was this method
        if policy.get("primary") == method:
            policy["primary"] = "password"
        open(policy_manager.policy_file, "wb").write(
            encrypt_with_key(master_key, json.dumps(policy).encode())
        )
    except Exception as e:
        print("Policy update error:", e)

    # Update public_meta if needed
    if method in ("airgesture", "imagepoints"):
        pub_path = os.path.join(meta_dir, "public_meta.json")
        try:
            pub = json.load(open(pub_path)) if os.path.exists(pub_path) else {}
            if method == "airgesture":
                pub.pop("airgesture_tracking", None)
            elif method == "imagepoints":
                pub.pop("imagepoints_image_id", None)
                pub.pop("imagepoints_point_count", None)
            json.dump(pub, open(pub_path, "w"))
        except Exception:
            pass

    log_event(username, f"DISABLE_{method.upper()}", "SUCCESS")
    return jsonify({"message": f"{method} disabled"})


def _ensure_method_in_policy(master_key, user_dir, method):
    """Helper: add method to policy enabled list if not already there."""
    policy_manager = PolicyManager(user_dir)
    try:
        policy = policy_manager.load_policy(master_key)
        if method not in policy.get("enabled", []):
            policy["enabled"].append(method)
            open(policy_manager.policy_file, "wb").write(
                encrypt_with_key(master_key, json.dumps(policy).encode())
            )
    except Exception as e:
        print(f"_ensure_method_in_policy error: {e}")


# ─────────────────────────────────────────────────────────────
# ACCOUNT DELETION
# ─────────────────────────────────────────────────────────────

@app.route("/sessions", methods=["GET"])
def list_sessions():
    """Return all active sessions for the current user."""
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    from session.manager import SESSIONS
    import time
    username = session["username"]
    now      = time.time()
    result   = []

    for t, s in list(SESSIONS.items()):
        if s["username"] != username:
            continue
        result.append({
            "token_hint":    t[:8] + "...",   # never send full token
            "token_id":      t,               # used for invalidation
            "is_current":    t == token,
            "created":       int(s.get("created", 0)),
            "last_active":   int(s.get("last_active", 0)),
            "expires_in":    max(0, int(s["expires"] - now)),
            "methods":       s.get("methods", []),
        })

    result.sort(key=lambda x: x["last_active"], reverse=True)
    return jsonify({"sessions": result})


@app.route("/sessions/<session_id>", methods=["DELETE"])
def revoke_session(session_id):
    """Revoke a specific session by ID."""
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    from session.manager import SESSIONS
    target = SESSIONS.get(session_id)

    if not target:
        return jsonify({"error": "Session not found"}), 404

    # Can only revoke your own sessions
    if target["username"] != session["username"]:
        return jsonify({"error": "Forbidden"}), 403

    SessionManager.invalidate(session_id)
    log_event(session["username"], "REVOKE_SESSION", "SUCCESS", ip=request.remote_addr or "")
    return jsonify({"message": "Session revoked"})


@app.route("/storage/usage", methods=["GET"])
def storage_usage():
    """Return total encrypted bytes stored for the current user."""
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    user_dir    = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    storage_dir = os.path.join(user_dir, "storage")
    master_key  = decrypt_with_key(session["session_key"], session["encrypted_master"])

    # Count real files and sizes from the vault index
    vault    = VaultEngine(user_dir)
    index    = vault.load_index(master_key)
    files    = {k: v for k, v in index.items() if v != "__folder__"}

    total_bytes = 0
    file_count  = 0
    for blob_id in files.values():
        blob_path = os.path.join(storage_dir, blob_id)
        if os.path.exists(blob_path):
            total_bytes += os.path.getsize(blob_path)
            file_count  += 1

    return jsonify({
        "bytes":       total_bytes,
        "file_count":  file_count,
        "folder_count": len([k for k in index if index[k] == "__folder__"]),
    })


@app.route("/account/delete", methods=["POST"])
def delete_account():
    """
    Permanently delete the account and all vault data.
    Requires password confirmation to prevent accidents.
    """
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    data     = request.json
    password = data.get("password", "")
    username = session["username"]
    ip       = request.remote_addr or ""

    if not password:
        return jsonify({"error": "Password required to confirm deletion"}), 400

    user_dir = _registry.get_user_dir(username) or os.path.join(BASE_USERS_DIR, username)
    meta_dir = os.path.join(user_dir, "meta")

    # Verify password before deleting anything
    from auth.password import PasswordAuth
    pw = PasswordAuth(meta_dir)
    ok, _ = pw.verify(password)
    if not ok:
        log_event(username, "DELETE_ACCOUNT", "FAILED", ip=ip)
        return jsonify({"error": "Incorrect password"}), 401

    # Invalidate session first
    SessionManager.invalidate(token)

    # Wipe all user data
    import shutil
    try:
        shutil.rmtree(user_dir)
        _registry.delete_user(username)
    except Exception as e:
        return jsonify({"error": f"Could not delete account data: {e}"}), 500

    log_event(username, "DELETE_ACCOUNT", "SUCCESS", ip=ip)
    return jsonify({"message": "Account deleted"})


@app.route("/change-policy", methods=["POST"])
def change_policy():
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    master_key     = decrypt_with_key(session["session_key"], session["encrypted_master"])
    user_dir       = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    policy_manager = PolicyManager(user_dir)
    policy         = policy_manager.load_policy(master_key)

    if not policy_manager.require_primary(policy, session["methods"]):
        return jsonify({"error": "Primary method required"}), 403

    data          = request.json
    new_threshold = data.get("threshold")
    new_enabled   = data.get("enabled")

    if new_threshold is not None:
        policy["threshold"] = new_threshold
    if new_enabled is not None:
        policy["enabled"] = new_enabled

    open(policy_manager.policy_file, "wb").write(
        encrypt_with_key(master_key, json.dumps(policy).encode())
    )
    log_event(session["username"], "CHANGE_POLICY", "SUCCESS")
    return jsonify({"message": "Policy updated successfully"})


# ─────────────────────────────────────────────────────────────
# IMAGE POINTS — HTTP ROUTES
# ─────────────────────────────────────────────────────────────

@app.route("/imagepoints/images", methods=["GET"])
def list_images():
    static_dir = os.path.join(os.path.dirname(__file__), "static", "images")
    images = []
    for filename in BUILTIN_IMAGES:
        if os.path.exists(os.path.join(static_dir, filename)):
            images.append({
                "id":  filename,
                "url": f"https://127.0.0.1:5000/static/images/{filename}"
            })
    return jsonify({"images": images})


@app.route("/imagepoints/upload-image", methods=["POST"])
def upload_image():
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    img_file = request.files["image"]
    ext      = os.path.splitext(img_file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        return jsonify({"error": "Unsupported image format"}), 400

    image_id = f"user_{session['username']}_{secrets.token_hex(8)}{ext}"
    save_dir = os.path.join(os.path.dirname(__file__), "static", "images")
    os.makedirs(save_dir, exist_ok=True)
    img_file.save(os.path.join(save_dir, image_id))

    return jsonify({
        "image_id": image_id,
        "url": f"https://127.0.0.1:5000/static/images/{image_id}"
    })


@app.route("/imagepoints/setup", methods=["POST"])
def imagepoints_setup():
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)
    if not session:
        return jsonify({"error": "Invalid session"}), 401

    data      = request.json
    points    = data.get("points", [])
    image_id  = data.get("image_id")
    tolerance = float(data.get("tolerance", 0.05))

    if not image_id:
        return jsonify({"error": "image_id required"}), 400
    if len(points) < 2:
        return jsonify({"error": "At least 2 points required"}), 400
    if not (0.01 <= tolerance <= 0.20):
        return jsonify({"error": "Tolerance must be between 0.01 and 0.20"}), 400

    master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])
    user_dir   = _registry.get_user_dir(session["username"]) or os.path.join(BASE_USERS_DIR, session["username"])
    meta_dir   = os.path.join(user_dir, "meta")

    ip = ImagePointsAuth(meta_dir)
    try:
        unlock_token = ip.setup(points, image_id, tolerance)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Save master key encrypted with this method's unlock token
    _write_master_key(meta_dir, "imagepoints", unlock_token, master_key)

    # Update policy to include imagepoints
    policy_manager = PolicyManager(user_dir)
    try:
        policy = policy_manager.load_policy(master_key)
        if "imagepoints" not in policy["enabled"]:
            policy["enabled"].append("imagepoints")
        policy["imagepoints_image_id"]    = image_id
        policy["imagepoints_point_count"] = len(points)
        open(policy_manager.policy_file, "wb").write(
            encrypt_with_key(master_key, json.dumps(policy).encode())
        )
    except Exception as e:
        print("Policy update error:", e)

    # Write public metadata for login page
    public_meta_path = os.path.join(meta_dir, "public_meta.json")
    try:
        pub = json.load(open(public_meta_path)) if os.path.exists(public_meta_path) else {}
    except Exception:
        pub = {}
    pub["imagepoints_image_id"]    = image_id
    pub["imagepoints_point_count"] = len(points)
    json.dump(pub, open(public_meta_path, "w"))

    log_event(session["username"], "IMAGEPOINTS_SETUP", "SUCCESS")
    return jsonify({"message": "Image points profile saved"})


@app.route("/imagepoints/verify", methods=["POST"])
def imagepoints_verify():
    data     = request.json
    username = data.get("username", "")
    points   = data.get("points", [])
    image_id = data.get("image_id")
    ip_addr  = request.remote_addr or "unknown"

    if not username or not image_id or not points:
        return jsonify({"error": "username, points and image_id required"}), 400

    # ── Rate limit check ──────────────────────────────────
    allowed, retry_after = rl_check(username, ip_addr)
    if not allowed:
        return jsonify({
            "error": f"Too many failed attempts. Try again in {retry_after} seconds.",
            "retry_after": retry_after
        }), 429

    user_dir = _registry.get_user_dir(username) or os.path.join(BASE_USERS_DIR, username)
    meta_dir = os.path.join(user_dir, "meta")
    if not os.path.exists(meta_dir):
        record_failure(username, ip_addr)
        return jsonify({"error": "Invalid credentials"}), 401

    ip = ImagePointsAuth(meta_dir)
    ok, result = ip.verify(points, image_id)

    if ok:
        record_success(username, ip_addr)
        return jsonify({"success": True, "unlock_token": result.hex()})

    record_failure(username, ip_addr)
    return jsonify({"success": False, "error": result}), 401


# ─────────────────────────────────────────────────────────────
# AIR GESTURE — WEBSOCKET ROUTES
# ─────────────────────────────────────────────────────────────

@sock.route("/ws/airgesture/stream")
def airgesture_stream(ws):
    """Real-time landmark extraction — client streams frames, server returns annotated frames."""
    extractor = _air_extractor  # reuse singleton

    while True:
        try:
            data      = json.loads(ws.receive())
            frame_b64 = data.get("frame")
            tracking  = data.get("tracking", ["one_hand"])

            if not frame_b64:
                ws.send(json.dumps({"error": "No frame received"}))
                continue

            result = extractor.extract_landmarks(frame_b64, tracking)
            ws.send(json.dumps({
                "landmarks": result["landmarks"],
                "annotated": result["annotated"]
            }))

        except Exception as e:
            print(f"airgesture_stream error: {e}")
            break


@sock.route("/ws/airgesture/setup")
def airgesture_setup_ws(ws):
    """
    Records 2-3 gesture samples and saves the profile.
    Actions: start → frame → stop → (repeat) → save
    """
    session_state = {"frames": [], "tracking": [], "samples": [], "username": ""}
    extractor     = _air_extractor  # reuse singleton

    while True:
        try:
            data   = json.loads(ws.receive())
            action = data.get("action")

            if action == "start":
                session_state["frames"]   = []
                session_state["tracking"] = data.get("tracking", ["one_hand"])
                session_state["username"] = data.get("username", "")
                ws.send(json.dumps({"status": "recording"}))

            elif action == "frame":
                result = extractor.extract_landmarks(data.get("frame"), session_state["tracking"])
                if result["landmarks"]:
                    session_state["frames"].append(result["landmarks"])
                ws.send(json.dumps({
                    "annotated":   result["annotated"],
                    "frame_count": len(session_state["frames"])
                }))

            elif action == "stop":
                if len(session_state["frames"]) >= 5:
                    session_state["samples"].append(session_state["frames"])
                    ws.send(json.dumps({
                        "status":       "sample_saved",
                        "sample_count": len(session_state["samples"])
                    }))
                else:
                    ws.send(json.dumps({"error": "Too few frames — move more slowly"}))
                session_state["frames"] = []

            elif action == "save":
                samples  = session_state["samples"]
                tracking = session_state["tracking"]
                username = session_state["username"]

                if len(samples) < 2:
                    ws.send(json.dumps({"error": "Need at least 2 samples"}))
                    continue

                user_dir = _registry.get_user_dir(username) or os.path.join(BASE_USERS_DIR, username)
                meta_dir = os.path.join(user_dir, "meta")

                if not os.path.exists(meta_dir):
                    ws.send(json.dumps({"error": "User not found"}))
                    continue

                token   = data.get("session_token")
                session = SessionManager.validate(token)
                if not session:
                    ws.send(json.dumps({"error": "Invalid session"}))
                    continue

                master_key = decrypt_with_key(session["session_key"], session["encrypted_master"])

                ag           = AirGestureAuth(meta_dir)
                unlock_token = ag.setup(samples, tracking)

                # Save master key encrypted with air gesture unlock token
                _write_master_key(meta_dir, "airgesture", unlock_token, master_key)

                # Update policy to include airgesture
                policy_manager = PolicyManager(user_dir)
                try:
                    policy = policy_manager.load_policy(master_key)
                    if "airgesture" not in policy["enabled"]:
                        policy["enabled"].append("airgesture")
                    policy["airgesture_tracking"] = tracking
                    open(policy_manager.policy_file, "wb").write(
                        encrypt_with_key(master_key, json.dumps(policy).encode())
                    )
                except Exception as e:
                    print("Policy update error:", e)

                # Write public metadata for login page
                public_meta_path = os.path.join(meta_dir, "public_meta.json")
                try:
                    pub = json.load(open(public_meta_path)) if os.path.exists(public_meta_path) else {}
                except Exception:
                    pub = {}
                pub["airgesture_tracking"] = tracking
                json.dump(pub, open(public_meta_path, "w"))

                log_event(username, "AIRGESTURE_SETUP", "SUCCESS")
                ws.send(json.dumps({"status": "saved"}))

        except Exception as e:
            print(f"airgesture_setup_ws error: {e}")
            ws.send(json.dumps({"error": str(e)}))
            break


@sock.route("/ws/airgesture/login")
def airgesture_login_ws(ws):
    """Records a gesture attempt and verifies it against the stored profile."""
    current_frames   = []
    current_tracking = []
    extractor        = _air_extractor  # reuse singleton

    while True:
        try:
            data   = json.loads(ws.receive())
            action = data.get("action")

            if action == "start":
                current_frames   = []
                current_tracking = data.get("tracking", ["one_hand"])
                ws.send(json.dumps({"status": "recording"}))

            elif action == "frame":
                result = extractor.extract_landmarks(data.get("frame"), current_tracking)
                if result["landmarks"]:
                    current_frames.append(result["landmarks"])
                ws.send(json.dumps({
                    "annotated":   result["annotated"],
                    "frame_count": len(current_frames)
                }))

            elif action == "verify":
                username = data.get("username")
                user_dir = _registry.get_user_dir(username) or os.path.join(BASE_USERS_DIR, username)
                meta_dir = os.path.join(user_dir, "meta")

                if not os.path.exists(meta_dir):
                    ws.send(json.dumps({"result": "fail", "error": "User not found"}))
                    continue

                ag = AirGestureAuth(meta_dir)
                ok, result = ag.verify(current_frames, current_tracking)

                if ok:
                    ws.send(json.dumps({"result": "success", "unlock_token": result.hex()}))
                else:
                    ws.send(json.dumps({"result": "fail", "error": result}))

        except Exception as e:
            print(f"airgesture_login_ws error: {e}")
            break


# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host="0.0.0.0", port=port)