import os
import json
import time

from auth.password import PasswordAuth
from auth.keystroke import KeystrokeAuth
from auth.mouse import MouseAuth
from security.crypto_utils import decrypt_with_key
from policy.manager import PolicyManager


class AuthEngine:

    def __init__(self, user_dir):
        self.user_dir = user_dir
        self.meta_dir = os.path.join(user_dir, "meta")

        # FIX 1: policy.dat lives inside meta/, not directly in user_dir
        self.policy_file = os.path.join(self.meta_dir, "policy.dat")

        # FIX 2: always initialize last_results so it's readable even on failure
        self.last_results = {
            "password":    False,
            "keystroke":   False,
            "mouse":       False,
            "airgesture":  False,
            "imagepoints": False
        }

    def _get_method_map(self) -> dict:
        import json
        path = os.path.join(self.meta_dir, "method_map.dat")
        if os.path.exists(path):
            try:
                return json.load(open(path))
            except Exception:
                return {}
        return {}

    def _get_master_key_path(self, method: str):
        method_map = self._get_method_map()
        if method in method_map:
            return os.path.join(self.meta_dir, method_map[method])
        # Backwards compatibility with old predictable names
        old = os.path.join(self.meta_dir, f"master.{method}.enc")
        return old if os.path.exists(old) else None

    # ----------------------------------------
    # LOCKOUT HELPERS  (unified — lock.json only, removed duplicate rate_limiter)
    # ----------------------------------------

    def _get_lock_data(self):
        lock_file = os.path.join(self.meta_dir, "lock.json")
        if os.path.exists(lock_file):
            with open(lock_file, "r") as f:
                return json.load(f), lock_file
        return {"fails": 0, "lock_until": 0}, lock_file

    def _save_lock_data(self, lock_data, lock_file):
        with open(lock_file, "w") as f:
            json.dump(lock_data, f)

    def _record_failure(self):
        lock_data, lock_file = self._get_lock_data()
        lock_data["fails"] += 1
        if lock_data["fails"] >= 3:
            # Exponential back-off: 2, 4, 8 ... capped at 30 min
            lock_minutes = min(2 ** (lock_data["fails"] - 2), 30)
            lock_data["lock_until"] = time.time() + (lock_minutes * 60)
        self._save_lock_data(lock_data, lock_file)

    def _record_success(self):
        _, lock_file = self._get_lock_data()
        self._save_lock_data({"fails": 0, "lock_until": 0}, lock_file)

    def _is_locked(self):
        lock_data, _ = self._get_lock_data()
        return time.time() < lock_data["lock_until"]

    # ----------------------------------------
    # MAIN AUTHENTICATE
    # ----------------------------------------

    def authenticate(self, username, payload):

        # FIX 3: single lockout system only — removed conflicting rate_limiter calls
        if self._is_locked():
            return False, "Account temporarily locked"

        success_methods = []
        unlock_tokens = {}

        # ---- PASSWORD ----
        if "password" in payload and payload["password"]:
            pw = PasswordAuth(self.meta_dir)
            ok, result = pw.verify(payload["password"])
            self.last_results["password"] = ok
            if ok:
                success_methods.append("password")
                unlock_tokens["password"] = result

        # ---- KEYSTROKE ----
        if "keystroke" in payload and payload["keystroke"]:
            ks = KeystrokeAuth(self.meta_dir)
            ok, result = ks.verify(payload["keystroke"])
            print("Keystroke verify result:", ok)
            self.last_results["keystroke"] = ok
            if ok:
                success_methods.append("keystroke")
                unlock_tokens["keystroke"] = result

        # ---- MOUSE ----
        if "mouse" in payload and payload["mouse"]:
            mouse = MouseAuth(self.meta_dir)
            ok, result = mouse.verify(payload["mouse"])
            self.last_results["mouse"] = ok
            if ok:
                success_methods.append("mouse")
                unlock_tokens["mouse"] = result

        # ---- AIR GESTURE ----
        # The frontend sends the unlock token directly (already verified via WebSocket)
        if "airgesture_token" in payload and payload["airgesture_token"]:
            try:
                token_bytes = bytes.fromhex(payload["airgesture_token"])
                master_file = self._get_master_key_path("airgesture")
                if master_file and os.path.exists(master_file):
                    # Validate token by attempting decryption
                    test = decrypt_with_key(token_bytes, open(master_file, "rb").read())
                    if test:
                        success_methods.append("airgesture")
                        unlock_tokens["airgesture"] = token_bytes
                        self.last_results["airgesture"] = True
            except Exception as e:
                print("Air gesture token error:", e)
                self.last_results["airgesture"] = False

        # ---- IMAGE POINTS ----
        # Same pattern — token already verified by /imagepoints/verify endpoint
        if "imagepoints_token" in payload and payload["imagepoints_token"]:
            try:
                token_bytes = bytes.fromhex(payload["imagepoints_token"])
                master_file = self._get_master_key_path("imagepoints")
                if master_file and os.path.exists(master_file):
                    test = decrypt_with_key(token_bytes, open(master_file, "rb").read())
                    if test:
                        success_methods.append("imagepoints")
                        unlock_tokens["imagepoints"] = token_bytes
                        self.last_results["imagepoints"] = True
            except Exception as e:
                print("Image points token error:", e)
                self.last_results["imagepoints"] = False

        # ---- No method passed ----
        if not success_methods:
            self._record_failure()
            return False, "Authentication failed"

        # ---- Decrypt master key using first successful method ----
        method_used = success_methods[0]
        master_file = self._get_master_key_path(method_used)

        if not master_file or not os.path.exists(master_file):
            self._record_failure()
            return False, "Master key file missing"

        try:
            encrypted_master = open(master_file, "rb").read()
            master_key = decrypt_with_key(unlock_tokens[method_used], encrypted_master)
        except Exception as e:
            print("Master key decrypt error:", e)
            self._record_failure()
            return False, "Master key decryption failed"

        # ---- Load and check policy ----
        policy_manager = PolicyManager(self.user_dir)

        try:
            policy = policy_manager.load_policy(master_key)
        except Exception as e:
            print("Policy load error:", e)
            self._record_failure()
            return False, "Policy load failed"

        print("DEBUG → Policy:", policy)
        print("DEBUG → Success methods:", success_methods)

        # ---- Threshold check ----
        if len(success_methods) < policy["threshold"]:
            self._record_failure()
            return False, f"Threshold not met — passed {len(success_methods)}/{policy['threshold']} methods"

        # ---- Primary method check ----
        primary = policy.get("primary")
        if primary and primary not in success_methods:
            self._record_failure()
            return False, f"Primary method '{primary}' must pass"

        # ---- Success ----
        self._record_success()

        return True, {
            "master_key": master_key,
            "methods": success_methods
        }