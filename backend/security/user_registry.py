"""
user_registry.py — maps usernames to opaque user IDs

The users/ directory on disk never contains real usernames.
Instead every user gets a random UUID as their folder name.

  users/
    3f8a21bc.../        ← random UUID, not "john"
      meta/
      storage/
    a19d77ff.../        ← another user

The registry itself (users/registry.dat) maps
username → folder_id. It is HMAC-signed so it cannot
be silently tampered with.

This means:
  - An attacker who lists backend/users/ sees only random UUIDs
  - They cannot tell how many users exist or what their names are
  - Even if they find the registry, usernames are stored as
    HMAC-SHA256 digests (one-way), not plaintext
"""

import os
import json
import hmac
import hashlib
import secrets
from security.crypto_utils import _PEPPER

REGISTRY_FILE = "registry.dat"
_HMAC_KEY     = hashlib.sha256(b"sv-registry-hmac-" + _PEPPER).digest()


def _sign(data: dict) -> str:
    payload = json.dumps(data, sort_keys=True).encode()
    return hmac.new(_HMAC_KEY, payload, hashlib.sha256).hexdigest()


def _hash_username(username: str) -> str:
    """One-way hash of username — stored in registry instead of plaintext."""
    return hmac.new(_HMAC_KEY, username.lower().encode(), hashlib.sha256).hexdigest()


class UserRegistry:

    def __init__(self, base_users_dir: str):
        self.base_dir = base_users_dir
        self.path     = os.path.join(base_users_dir, REGISTRY_FILE)
        os.makedirs(base_users_dir, exist_ok=True)

    def _load(self) -> dict:
        if not os.path.exists(self.path):
            return {}
        try:
            with open(self.path) as f:
                obj = json.load(f)
            stored_sig = obj.pop("__sig__", "")
            if not hmac.compare_digest(stored_sig, _sign(obj)):
                raise ValueError("Registry signature mismatch — possible tampering")
            return obj
        except (json.JSONDecodeError, KeyError):
            return {}

    def _save(self, data: dict):
        data["__sig__"] = _sign({k: v for k, v in data.items() if k != "__sig__"})
        with open(self.path, "w") as f:
            json.dump(data, f)

    def user_exists(self, username: str) -> bool:
        return _hash_username(username) in self._load()

    def get_user_dir(self, username: str) -> str | None:
        """Returns the full path to the user's folder, or None if not found."""
        registry = self._load()
        folder   = registry.get(_hash_username(username))
        if not folder:
            return None
        return os.path.join(self.base_dir, folder)

    def create_user(self, username: str) -> str:
        """Creates a new random-named folder for the user. Returns full path."""
        registry  = self._load()
        user_hash = _hash_username(username)
        if user_hash in registry:
            raise ValueError("User already exists")

        folder_id = secrets.token_hex(16)   # e.g. "3f8a21bc4d7e..."
        registry[user_hash] = folder_id
        self._save(registry)

        full_path = os.path.join(self.base_dir, folder_id)
        os.makedirs(os.path.join(full_path, "meta"),    exist_ok=True)
        os.makedirs(os.path.join(full_path, "storage"), exist_ok=True)
        return full_path

    def delete_user(self, username: str):
        registry  = self._load()
        user_hash = _hash_username(username)
        if user_hash in registry:
            del registry[user_hash]
            self._save(registry)