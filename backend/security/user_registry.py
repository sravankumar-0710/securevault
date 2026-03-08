"""
user_registry.py — maps usernames to opaque folder IDs

The users/ directory on disk never contains real usernames.
Every user gets a random hex ID as their folder name:

  users/
    registry.dat          ← HMAC-signed map: username_hash → folder_id
    registry.key          ← random HMAC key, generated once on first run
    3f8a21bc4d7e.../      ← random ID, not "john"
      meta/
      storage/
    a19d77ff.../

Security properties:
  - Listing users/ shows only random hex IDs — no usernames
  - registry.dat stores HMAC-SHA256(username), never plaintext
  - The HMAC key is random and stored in registry.key
    (separate from SV_PEPPER so changing the env var never breaks it)
  - The registry is signed to detect tampering
  - If the signature fails we log a warning but don't crash —
    an empty registry is safer than a 500 error
"""

import os
import json
import hmac as _hmac
import hashlib
import secrets

REGISTRY_FILE = "registry.dat"
REGISTRY_KEY  = "registry.key"


class UserRegistry:

    def __init__(self, base_users_dir: str):
        self.base_dir = base_users_dir
        self.dat_path = os.path.join(base_users_dir, REGISTRY_FILE)
        self.key_path = os.path.join(base_users_dir, REGISTRY_KEY)
        os.makedirs(base_users_dir, exist_ok=True)
        self._hmac_key = self._load_or_create_key()

    # ── HMAC key — generated once, stored on disk ─────────────
    def _load_or_create_key(self) -> bytes:
        if os.path.exists(self.key_path):
            try:
                key = bytes.fromhex(open(self.key_path).read().strip())
                if len(key) == 32:
                    return key
            except Exception:
                pass
        # Generate a fresh random key
        key = secrets.token_bytes(32)
        with open(self.key_path, "w") as f:
            f.write(key.hex())
        return key

    # ── Signing helpers ────────────────────────────────────────
    def _sign(self, data: dict) -> str:
        payload = json.dumps(data, sort_keys=True).encode()
        return _hmac.new(self._hmac_key, payload, hashlib.sha256).hexdigest()

    def _hash_username(self, username: str) -> str:
        """One-way hash — registry stores this, never the real username."""
        return _hmac.new(self._hmac_key, username.strip().lower().encode(), hashlib.sha256).hexdigest()

    # ── Load / save ────────────────────────────────────────────
    def _load(self) -> dict:
        if not os.path.exists(self.dat_path):
            return {}
        try:
            with open(self.dat_path) as f:
                obj = json.load(f)
            stored_sig = obj.pop("__sig__", "")
            expected   = self._sign(obj)
            if not _hmac.compare_digest(stored_sig, expected):
                # Warn but don't crash — safer to treat as empty than 500
                print("⚠  WARNING: registry.dat signature mismatch — treating as empty. "
                      "If this is a fresh install, delete users/registry.dat and users/registry.key and restart.")
                return {}
            return obj
        except json.JSONDecodeError:
            return {}

    def _save(self, data: dict):
        payload = {k: v for k, v in data.items() if k != "__sig__"}
        payload["__sig__"] = self._sign(payload)
        with open(self.dat_path, "w") as f:
            json.dump(payload, f)

    # ── Public API ─────────────────────────────────────────────
    def user_exists(self, username: str) -> bool:
        return self._hash_username(username) in self._load()

    def get_user_dir(self, username: str):
        """Returns full path to the user's folder, or None if not found."""
        folder = self._load().get(self._hash_username(username))
        if not folder:
            return None
        return os.path.join(self.base_dir, folder)

    def create_user(self, username: str) -> str:
        """Creates a new random-named folder. Returns its full path."""
        registry  = self._load()
        user_hash = self._hash_username(username)
        if user_hash in registry:
            raise ValueError("User already exists")

        folder_id = secrets.token_hex(16)
        registry[user_hash] = folder_id
        self._save(registry)

        full_path = os.path.join(self.base_dir, folder_id)
        os.makedirs(os.path.join(full_path, "meta"),    exist_ok=True)
        os.makedirs(os.path.join(full_path, "storage"), exist_ok=True)
        return full_path

    def delete_user(self, username: str):
        registry  = self._load()
        user_hash = self._hash_username(username)
        if user_hash in registry:
            del registry[user_hash]
            self._save(registry)


# ── Migration helper ───────────────────────────────────────────
# Call this once if you're upgrading from the old pepper-based registry.
# It wipes the old registry.dat and registry.key so a fresh one is created.
# Any existing users will need to re-register (their vault data is untouched).
def reset_registry(base_users_dir: str):
    import os
    for fname in ["registry.dat", "registry.key"]:
        path = os.path.join(base_users_dir, fname)
        if os.path.exists(path):
            os.remove(path)
            print(f"Deleted {path}")
    print("Registry reset. Restart the server — existing user vaults are intact but users must re-register.")