import uuid
import time
from security.crypto_utils import encrypt_with_key, generate_fernet_key

SESSIONS = {}

IDLE_TIMEOUT     = 900    # 15 min of inactivity → expire
ABSOLUTE_TIMEOUT = 3600   # 1 hour max regardless of activity → force re-login


class SessionManager:

    @staticmethod
    def create(username, master_key, methods):
        token       = str(uuid.uuid4())
        session_key = generate_fernet_key()
        now         = time.time()

        SESSIONS[token] = {
            "username":         username,
            "methods":          methods,
            "session_key":      session_key,
            "encrypted_master": encrypt_with_key(session_key, master_key),
            "created":          now,
            "last_active":      now,
            "expires":          now + IDLE_TIMEOUT,        # idle expiry
            "absolute_expiry":  now + ABSOLUTE_TIMEOUT,   # hard expiry
        }

        return token

    @staticmethod
    def validate(token):
        session = SESSIONS.get(token)

        if not session:
            return None

        now = time.time()

        # Hard expiry — force re-login after 1 hour no matter what
        if now > session["absolute_expiry"]:
            del SESSIONS[token]
            return None

        # Idle expiry — 15 min of no activity
        if now > session["expires"]:
            del SESSIONS[token]
            return None

        # Refresh idle timer on every valid use
        session["last_active"] = now
        session["expires"]     = now + IDLE_TIMEOUT

        return session

    @staticmethod
    def invalidate(token):
        """Explicit logout — delete the session immediately."""
        if token in SESSIONS:
            del SESSIONS[token]

    @staticmethod
    def cleanup():
        """Remove all expired sessions — call this periodically or on startup."""
        now     = time.time()
        expired = [t for t, s in SESSIONS.items()
                   if now > s["expires"] or now > s["absolute_expiry"]]
        for t in expired:
            del SESSIONS[t]
        if expired:
            print(f"Session cleanup: removed {len(expired)} expired sessions")