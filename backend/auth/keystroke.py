import os
import json
import secrets
import statistics

from security.crypto_utils import generate_fernet_key

KEYSTROKE_FILE_PREFIX = "ks_profile_"


class KeystrokeAuth:

    def __init__(self, user_meta_dir):
        self.meta_dir = user_meta_dir

    # -----------------------------
    # FEATURE EXTRACTION
    # -----------------------------

    def _extract_features(self, intervals):
        """
        Accepts list of dicts: [{"key": "a", "down": 1000, "up": 1080, "dwell": 80}, ...]

        Returns a list of feature dicts:
            {
                "dwell":  float,   # how long key was held (ms)
                "flight": float    # gap between key-up and next key-down (ms)
                                   # None for the last keystroke
            }

        Both dwell AND flight time are used for comparison.
        """
        if not intervals or not isinstance(intervals[0], dict):
            raise ValueError("Expected list of keystroke event dicts")

        # Filter out entries missing timing data
        valid = [
            item for item in intervals
            if item.get("dwell") is not None
            and item.get("down")  is not None
            and item.get("up")    is not None
            and item["dwell"] > 0
        ]

        if len(valid) < 3:
            raise ValueError(f"Too few valid keystrokes (got {len(valid)}, need 3+)")

        features = []

        for i, item in enumerate(valid):
            dwell = float(item["dwell"])

            # Flight time = next key down - this key up
            if i < len(valid) - 1:
                flight = float(valid[i + 1]["down"]) - float(item["up"])
                flight = max(0.0, flight)  # clamp negative (overlap typing) to 0
            else:
                flight = None  # last keystroke has no flight

            features.append({
                "dwell":  dwell,
                "flight": flight
            })

        return features

    # -----------------------------
    # SETUP
    # -----------------------------

    def setup(self, intervals):
        """
        Saves keystroke profile with dwell + flight features.
        Returns unlock token (bytes).
        """
        features = self._extract_features(intervals)

        unlock_token = generate_fernet_key()

        filename = KEYSTROKE_FILE_PREFIX + secrets.token_hex(12)
        path = os.path.join(self.meta_dir, filename)

        with open(path, "w") as f:
            json.dump({
                "samples":          [features],
                "encrypted_unlock": unlock_token.hex()
            }, f)

        print(f"Keystroke profile saved: {len(features)} keystrokes")
        self._debug_features(features)

        return unlock_token

    # -----------------------------
    # VERIFY
    # -----------------------------

    def verify(self, attempt_intervals):
        """
        Returns (True, unlock_token_bytes) on success,
                (False, error_string)       on failure.
        """
        try:
            attempt_features = self._extract_features(attempt_intervals)
        except ValueError as e:
            return False, str(e)

        files = [
            f for f in os.listdir(self.meta_dir)
            if f.startswith(KEYSTROKE_FILE_PREFIX)
        ]

        for filename in files:
            path = os.path.join(self.meta_dir, filename)

            try:
                with open(path, "r") as f:
                    data = json.load(f)

                for stored_sample in data["samples"]:
                    match, score = self._compare(stored_sample, attempt_features)
                    print(f"Keystroke match={match}  score={round(score, 4) if score is not None else 'N/A'}")

                    if match:
                        unlock_token = bytes.fromhex(data["encrypted_unlock"])
                        return True, unlock_token

            except Exception as e:
                print(f"Keystroke verify error on {filename}: {e}")
                continue

        return False, "Keystroke mismatch"

    # -----------------------------
    # COMPARISON
    # -----------------------------

    def _compare(self, stored, attempt):
        """
        Compares two feature sequences.

        Dwell time  -> weight 0.7  (more reliable on short passwords)
        Flight time -> weight 0.3  (useful but capped — pauses inflate it)

        Flight error is capped at 1.0 to prevent one big pause from
        destroying the entire score.

        Returns (matched: bool, avg_weighted_error: float)
        """
        length = min(len(stored), len(attempt))

        if length < 3:
            return False, None

        stored  = stored[:length]
        attempt = attempt[:length]

        DWELL_WEIGHT  = 0.7
        FLIGHT_WEIGHT = 0.3
        FLIGHT_CAP    = 1.0  # cap flight error — a 10x pause treated same as 1x

        total_error = 0.0
        count       = 0

        for i in range(length):
            s = stored[i]
            a = attempt[i]

            # ── Dwell error ──────────────────────────────────
            if s["dwell"] and s["dwell"] > 0:
                dwell_error  = abs(a["dwell"] - s["dwell"]) / s["dwell"]
                total_error += DWELL_WEIGHT * dwell_error
                count       += DWELL_WEIGHT
                print(f"  [{i}] dwell  stored={s['dwell']:.1f}ms  attempt={a['dwell']:.1f}ms  err={dwell_error:.3f}")

            # ── Flight error (capped) ─────────────────────────
            if s["flight"] is not None and a["flight"] is not None:
                if s["flight"] > 0:
                    raw_err = abs(a["flight"] - s["flight"]) / s["flight"]
                else:
                    raw_err = 0.0 if a["flight"] < 50 else 1.0

                flight_error = min(raw_err, FLIGHT_CAP)
                total_error += FLIGHT_WEIGHT * flight_error
                count       += FLIGHT_WEIGHT
                print(f"  [{i}] flight stored={s['flight']:.1f}ms  attempt={a['flight']:.1f}ms  err={flight_error:.3f} (raw={raw_err:.3f})")

        if count == 0:
            return False, None

        avg_error = total_error / count
        print(f"  -> Weighted avg error: {avg_error:.4f}")

        THRESHOLD = 0.55
        return avg_error < THRESHOLD, avg_error

    # -----------------------------
    # DEBUG HELPER
    # -----------------------------

    def _debug_features(self, features):
        print("  Keystroke feature breakdown:")
        for i, f in enumerate(features):
            flight_str = f"{f['flight']:.1f}ms" if f["flight"] is not None else "-"
            print(f"    [{i}] dwell={f['dwell']:.1f}ms  flight={flight_str}")
