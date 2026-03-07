import os
import json
import secrets

from security.crypto_utils import (
    generate_salt,
    hash_password,
    verify_password,
    derive_key_from_password,
    encrypt_with_key,
    decrypt_with_key,
    generate_fernet_key,
    secure_wipe,
)

PASSWORD_FILE = "pw.dat"   # fixed name — no longer leaks method info


class PasswordAuth:

    def __init__(self, user_meta_dir):
        self.meta_dir  = user_meta_dir
        self.pw_file   = os.path.join(user_meta_dir, PASSWORD_FILE)

    def setup(self, password: str) -> bytes:
        # Two independent salts: one for hashing, one for key derivation
        # This means cracking the hash still doesn't reveal the encryption key
        hash_salt = generate_salt()
        key_salt  = generate_salt()

        pw_hash      = hash_password(password, hash_salt)
        unlock_token = generate_fernet_key()

        # Derive encryption key using separate salt
        method_key       = derive_key_from_password(password, key_salt)
        encrypted_unlock = encrypt_with_key(method_key, unlock_token)

        # Wipe sensitive values from memory
        secure_wipe(method_key)

        with open(self.pw_file, "w") as f:
            json.dump({
                "hash_salt":        hash_salt.hex(),
                "key_salt":         key_salt.hex(),
                "hash":             pw_hash.hex(),
                "encrypted_unlock": encrypted_unlock.decode()
            }, f)

        return unlock_token

    def verify(self, password: str):
        if not os.path.exists(self.pw_file):
            return False, "No password profile found"

        try:
            with open(self.pw_file) as f:
                data = json.load(f)

            hash_salt   = bytes.fromhex(data["hash_salt"])
            key_salt    = bytes.fromhex(data["key_salt"])
            stored_hash = bytes.fromhex(data["hash"])

            if not verify_password(password, hash_salt, stored_hash):
                return False, "Invalid password"

            method_key       = derive_key_from_password(password, key_salt)
            encrypted_unlock = data["encrypted_unlock"].encode()
            unlock_token     = decrypt_with_key(method_key, encrypted_unlock)

            secure_wipe(method_key)
            return True, unlock_token

        except Exception as e:
            return False, f"Verification error: {e}"