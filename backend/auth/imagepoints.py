import os
import json
import secrets
import math

from security.crypto_utils import generate_fernet_key, encrypt_with_key, decrypt_with_key

IMAGEPOINTS_FILE_PREFIX = "imgpts_profile_"


class ImagePointsAuth:

    def __init__(self, meta_dir):
        self.meta_dir = meta_dir

    # ─────────────────────────────────────────────────────────
    # SETUP
    # ─────────────────────────────────────────────────────────

    def setup(self, points: list, image_id: str, tolerance: int = 40) -> bytes:
        """
        Saves an image points profile.

        points:     list of {x, y} dicts in the order the user clicked them
                    coordinates are stored as percentages (0.0-1.0) of
                    image width/height so they work at any display size
        image_id:   filename or identifier of the image used
        tolerance:  max pixel distance allowed per point (default 40px)

        Returns unlock token (bytes).
        """
        if len(points) < 2:
            raise ValueError("Need at least 2 points")

        # Store coordinates as percentages — display-size independent
        normalized_points = [
            {"x": float(p["x"]), "y": float(p["y"])}
            for p in points
        ]

        unlock_token = generate_fernet_key()

        filename = IMAGEPOINTS_FILE_PREFIX + secrets.token_hex(12)
        path     = os.path.join(self.meta_dir, filename)

        with open(path, "w") as f:
            json.dump({
                "points":           normalized_points,
                "image_id":         image_id,
                "tolerance":        tolerance,   # stored as % of image width
                "point_count":      len(normalized_points),
                "encrypted_unlock": unlock_token.hex()
            }, f)

        print(f"Image points profile saved: {len(normalized_points)} points, image={image_id}, tolerance={tolerance}%")
        for i, p in enumerate(normalized_points):
            print(f"  Point {i+1}: x={p['x']:.3f}  y={p['y']:.3f}")

        return unlock_token

    # ─────────────────────────────────────────────────────────
    # VERIFY
    # ─────────────────────────────────────────────────────────

    def verify(self, attempt_points: list, image_id: str):
        """
        attempt_points: list of {x, y} in order clicked (as percentages)
        image_id:       must match the registered image

        Returns (True, unlock_token_bytes) on success,
                (False, error_string)       on failure.
        """
        if not attempt_points:
            return False, "No points provided"

        files = [
            f for f in os.listdir(self.meta_dir)
            if f.startswith(IMAGEPOINTS_FILE_PREFIX)
        ]

        for filename in files:
            path = os.path.join(self.meta_dir, filename)

            try:
                with open(path, "r") as f:
                    data = json.load(f)

                # Must be same image
                if data["image_id"] != image_id:
                    continue

                stored_points = data["points"]
                tolerance     = data["tolerance"]  # as % of image width
                point_count   = data["point_count"]

                # Must provide exactly the right number of points
                if len(attempt_points) != point_count:
                    print(f"Image points: wrong count {len(attempt_points)} vs {point_count}")
                    continue

                match, details = self._compare_points(
                    stored_points,
                    attempt_points,
                    tolerance
                )

                print(f"Image points match={match}")
                for d in details:
                    print(f"  Point {d['index']+1}: dist={d['dist']:.4f}  tolerance={tolerance:.4f}  ok={d['ok']}")

                if match:
                    return True, bytes.fromhex(data["encrypted_unlock"])

            except Exception as e:
                print(f"Image points verify error on {filename}: {e}")
                continue

        return False, "Image points mismatch"

    # ─────────────────────────────────────────────────────────
    # COMPARISON
    # ─────────────────────────────────────────────────────────

    def _compare_points(self, stored: list, attempt: list, tolerance: float):
        """
        Compares two point sequences in order.

        Both stored and attempt use percentage coordinates (0.0-1.0).
        Tolerance is also a percentage — e.g. 0.05 means within 5% of image width.

        Returns (all_matched: bool, details: list)
        """
        details     = []
        all_matched = True

        for i in range(len(stored)):
            s = stored[i]
            a = attempt[i]

            # Euclidean distance in percentage space
            dist = math.sqrt(
                (a["x"] - s["x"]) ** 2 +
                (a["y"] - s["y"]) ** 2
            )

            ok = dist <= tolerance
            if not ok:
                all_matched = False

            details.append({
                "index": i,
                "dist":  dist,
                "ok":    ok
            })

        return all_matched, details
