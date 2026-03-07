import os
import json
from security.crypto_utils import encrypt_with_key, decrypt_with_key


class PolicyManager:

    def __init__(self, user_dir):
        self.policy_file = os.path.join(user_dir,"meta", "policy.dat")

    def create_policy(self, master_key, enabled_methods, threshold, primary):
        policy = {
            "enabled": enabled_methods,
            "threshold": threshold,
            "primary": primary
        }

        encrypted = encrypt_with_key(
            master_key,
            json.dumps(policy).encode()
        )

        open(self.policy_file, "wb").write(encrypted)

    def load_policy(self, master_key):
        raw = open(self.policy_file, "rb").read()
        decrypted = decrypt_with_key(master_key, raw)
        return json.loads(decrypted.decode())

    def validate(self, policy, success_methods):
        if len(success_methods) < policy["threshold"]:
            return False

        return True

    def require_primary(self, policy, success_methods):
        return policy["primary"] in success_methods
