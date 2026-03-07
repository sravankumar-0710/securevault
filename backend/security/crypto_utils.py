import os
import base64
import hashlib
import hmac
import ctypes
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ─────────────────────────────────────────────────────────────
# PEPPER — never stored on disk, lives only in environment
# Set SV_PEPPER in your environment before starting the server:
#   Windows:  set SV_PEPPER=your_random_64char_string
#   Linux:    export SV_PEPPER=your_random_64char_string
# ─────────────────────────────────────────────────────────────
_PEPPER = os.environ.get("SV_PEPPER", "").encode()
if not _PEPPER:
    print("⚠  WARNING: SV_PEPPER not set. Add it to your environment for full security.")
    _PEPPER = b"sv-fallback-pepper-change-in-production-xK9#mQ2$"

# ─────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────
PBKDF2_ITERATIONS  = 600_000   # OWASP 2024 recommended minimum
BIOMETRIC_ITERS    = 200_000   # for biometric key derivation
SALT_SIZE          = 32        # 256-bit salt
AES_NONCE_SIZE     = 12        # 96-bit nonce for AES-256-GCM


# ─────────────────────────────────────────────────────────────
# SECURE WIPE — zero out sensitive bytes in memory
# ─────────────────────────────────────────────────────────────
def secure_wipe(data: bytes):
    try:
        ctypes.memset(id(data), 0, len(data))
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
# SALT
# ─────────────────────────────────────────────────────────────
def generate_salt() -> bytes:
    return os.urandom(SALT_SIZE)


# ─────────────────────────────────────────────────────────────
# PASSWORD HASHING — PBKDF2 + pepper + 600k iterations
# ─────────────────────────────────────────────────────────────
def hash_password(password: str, salt: bytes) -> bytes:
    peppered = password.encode() + _PEPPER
    return hashlib.pbkdf2_hmac("sha256", peppered, salt, PBKDF2_ITERATIONS)


def verify_password(password: str, salt: bytes, stored_hash: bytes) -> bool:
    return hmac.compare_digest(hash_password(password, salt), stored_hash)


# ─────────────────────────────────────────────────────────────
# PASSWORD KEY DERIVATION — separate from hashing
# Used to encrypt the unlock token in PasswordAuth
# Uses its own salt so cracking the hash doesn't give the key
# ─────────────────────────────────────────────────────────────
def derive_key_from_password(password: str, salt: bytes) -> bytes:
    peppered = password.encode() + _PEPPER
    raw = hashlib.pbkdf2_hmac("sha256", peppered, salt, PBKDF2_ITERATIONS)
    return base64.urlsafe_b64encode(raw)


# ─────────────────────────────────────────────────────────────
# BIOMETRIC KEY DERIVATION — was plain SHA-256, now PBKDF2
# ─────────────────────────────────────────────────────────────
def derive_key_from_secret(secret: bytes, salt: bytes = None) -> bytes:
    if salt is None:
        salt = hashlib.sha256(secret + _PEPPER).digest()
    raw = hashlib.pbkdf2_hmac("sha256", secret + _PEPPER, salt, BIOMETRIC_ITERS)
    return base64.urlsafe_b64encode(raw)


# ─────────────────────────────────────────────────────────────
# AES-256-GCM — used for all FILE encryption
# Authenticated encryption: detects any tampering
# ─────────────────────────────────────────────────────────────
def _fernet_to_raw32(key: bytes) -> bytes:
    """Convert Fernet key (base64url 44 bytes) to raw 32-byte AES key."""
    try:
        raw = base64.urlsafe_b64decode(key + b"==")
        return raw[:32]
    except Exception:
        return hashlib.sha256(key).digest()


def encrypt_file(master_key: bytes, plaintext: bytes) -> bytes:
    """AES-256-GCM file encryption. Returns nonce+ciphertext+tag."""
    raw_key = _fernet_to_raw32(master_key)
    nonce   = os.urandom(AES_NONCE_SIZE)
    ct      = AESGCM(raw_key).encrypt(nonce, plaintext, None)
    secure_wipe(raw_key)
    return nonce + ct


def decrypt_file(master_key: bytes, token: bytes) -> bytes:
    """AES-256-GCM file decryption. Raises on tampered data."""
    raw_key    = _fernet_to_raw32(master_key)
    nonce      = token[:AES_NONCE_SIZE]
    ciphertext = token[AES_NONCE_SIZE:]
    result     = AESGCM(raw_key).decrypt(nonce, ciphertext, None)
    secure_wipe(raw_key)
    return result


# ─────────────────────────────────────────────────────────────
# FERNET — used for session-layer and meta encryption (fast, fine)
# ─────────────────────────────────────────────────────────────
def generate_fernet_key() -> bytes:
    return Fernet.generate_key()


def encrypt_with_key(key: bytes, data: bytes) -> bytes:
    return Fernet(key).encrypt(data)


def decrypt_with_key(key: bytes, token: bytes) -> bytes:
    return Fernet(key).decrypt(token)


# ─────────────────────────────────────────────────────────────
# RANDOM TOKEN
# ─────────────────────────────────────────────────────────────
def generate_random_token(length: int = 32) -> bytes:
    return os.urandom(length)