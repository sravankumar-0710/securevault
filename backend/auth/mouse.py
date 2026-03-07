import os
import json
import secrets
import math
import statistics

from security.crypto_utils import ( 
    encrypt_with_key,
    decrypt_with_key,
    generate_fernet_key
)

# ✅ Prefix so verify() never accidentally reads password or keystroke files
MOUSE_FILE_PREFIX = "mouse_profile_"


class MouseAuth:

    def __init__(self, meta_dir):
        self.meta_dir = meta_dir

    # ----------------------------
    # NORMALIZE
    # ----------------------------

    def _normalize(self, points):
        """
        Accepts [[x, y], ...] or [[x, y, t], ...].
        Normalizes x and y to [0, 1] range.
        """
        if len(points) < 5:
            raise ValueError("Gesture too short (need at least 5 points)")

        # Support both [x, y] and [x, y, timestamp] formats
        pairs = [(p[0], p[1]) for p in points]

        xs = [p[0] for p in pairs]
        ys = [p[1] for p in pairs]

        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)

        width  = max_x - min_x
        height = max_y - min_y

        if width == 0 or height == 0:
            raise ValueError("Invalid gesture — no movement detected")

        return [
            ((x - min_x) / width, (y - min_y) / height)
            for x, y in pairs
        ]

    # ----------------------------
    # RESAMPLE
    # ----------------------------

    def _resample(self, points, target_count=32):
        """
        Resamples a path to exactly target_count evenly spaced points.
        """
        def dist(p1, p2):
            return math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)

        total_length = sum(dist(points[i-1], points[i]) for i in range(1, len(points)))

        if total_length == 0:
            return [points[0]] * target_count

        interval = total_length / (target_count - 1)
        new_points = [points[0]]
        D = 0
        i = 1

        while i < len(points) and len(new_points) < target_count:
            d = dist(points[i-1], points[i])

            if (D + d) >= interval:
                ratio = (interval - D) / d if d != 0 else 0
                nx = points[i-1][0] + ratio * (points[i][0] - points[i-1][0])
                ny = points[i-1][1] + ratio * (points[i][1] - points[i-1][1])
                new_points.append((nx, ny))
                points[i-1] = (nx, ny)
                D = 0
            else:
                D += d
                i += 1

        # Pad with last point if needed
        while len(new_points) < target_count:
            new_points.append(points[-1])

        return new_points[:target_count]

    # ----------------------------
    # VECTORIZE
    # ----------------------------

    def _to_vectors(self, points):
        """
        Converts a point path into unit direction vectors.
        """
        vectors = []

        for i in range(1, len(points)):
            dx = points[i][0] - points[i-1][0]
            dy = points[i][1] - points[i-1][1]

            magnitude = math.sqrt(dx*dx + dy*dy)

            if magnitude == 0:
                vectors.append((0.0, 0.0))
            else:
                vectors.append((dx / magnitude, dy / magnitude))

        return vectors

    # ----------------------------
    # SETUP (MULTI-SAMPLE)
    # ----------------------------

    def setup(self, samples):
        """
        Takes 3+ gesture samples, builds a mean+variance vector profile,
        saves it with a mouse_profile_ prefix, returns unlock token (bytes).
        """
        print(f"Mouse setup: received {len(samples)} samples")

        all_vectors = []

        for i, sample in enumerate(samples):
            try:
                normalized = self._normalize(sample)
                resampled  = self._resample(normalized)
                vectors    = self._to_vectors(resampled)
                all_vectors.append(vectors)
                print(f"  Sample {i}: {len(sample)} points → {len(vectors)} vectors")
            except ValueError as e:
                print(f"  Sample {i} skipped: {e}")
                continue

        if len(all_vectors) < 2:
            raise ValueError("Need at least 2 valid gesture samples")

        length = min(len(v) for v in all_vectors)

        mean_vector     = []
        variance_vector = []

        for i in range(length):
            xs = [sample[i][0] for sample in all_vectors]
            ys = [sample[i][1] for sample in all_vectors]

            mean_vector.append((statistics.mean(xs), statistics.mean(ys)))
            variance_vector.append((statistics.pvariance(xs), statistics.pvariance(ys)))

        unlock_token = generate_fernet_key()  # raw bytes

        data = {
            "mean_vector":     mean_vector,
            "variance_vector": variance_vector,
            # ✅ FIX: store as plain string (Fernet keys are already url-safe base64)
            "encrypted_unlock": unlock_token.decode()
        }

        # ✅ FIX: Use prefix so verify() only reads mouse files
        filename = MOUSE_FILE_PREFIX + secrets.token_hex(12)
        path = os.path.join(self.meta_dir, filename)

        with open(path, "w") as f:
            json.dump(data, f)

        return unlock_token  # return raw bytes

    # ----------------------------
    # VERIFY (Z-SCORE BASED)
    # ----------------------------

    def verify(self, attempt_points):
        """
        Returns (True, unlock_token_bytes) on success,
                (False, error_string) on failure.
        """
        try:
            normalized    = self._normalize(attempt_points)
            resampled     = self._resample(normalized)
            attempt_vectors = self._to_vectors(resampled)
        except ValueError as e:
            return False, f"Invalid gesture: {e}"

        # ✅ FIX: Only scan mouse profile files
        files = [
            f for f in os.listdir(self.meta_dir)
            if f.startswith(MOUSE_FILE_PREFIX)
        ]

        if not files:
            return False, "No mouse profile found"

        for filename in files:
            path = os.path.join(self.meta_dir, filename)

            try:
                with open(path, "r") as f:
                    data = json.load(f)

                mean_vector     = data["mean_vector"]
                variance_vector = data["variance_vector"]

                if len(attempt_vectors) != len(mean_vector):
                    print(f"Mouse vector length mismatch: {len(attempt_vectors)} vs {len(mean_vector)}")
                    continue

                if len(attempt_vectors) < 20:
                    print("Mouse gesture too short after resampling")
                    continue

                # ---- Direction sanity check (first vector) ----
                first_attempt = attempt_vectors[0]
                first_mean    = mean_vector[0]
                dot = first_attempt[0] * first_mean[0] + first_attempt[1] * first_mean[1]

                if dot < 0.7:
                    print(f"Mouse direction mismatch (dot={dot:.2f})")
                    continue

                # ---- Z-score comparison ----
                total_z = 0
                count   = 0

                for i in range(len(mean_vector)):
                    for j in range(2):
                        variance = variance_vector[i][j]
                        if variance < 0.0001:
                            variance = 0.0001

                        z = abs(attempt_vectors[i][j] - mean_vector[i][j]) / math.sqrt(variance)
                        total_z += z
                        count   += 1

                if count == 0:
                    continue

                average_z = total_z / count
                print(f"Mouse average Z-score: {average_z:.4f}")

                if average_z < 2.0:

                    # ---- Adaptive learning: update profile on confident match ----
                    if average_z < 1.5:
                        LEARNING_RATE = 0.05

                        for i in range(len(mean_vector)):
                            old_x, old_y = mean_vector[i]
                            new_x, new_y = attempt_vectors[i]

                            mean_vector[i] = (
                                (1 - LEARNING_RATE) * old_x + LEARNING_RATE * new_x,
                                (1 - LEARNING_RATE) * old_y + LEARNING_RATE * new_y
                            )

                        data["mean_vector"] = mean_vector

                        with open(path, "w") as f:
                            json.dump(data, f)

                    # ✅ FIX: Return unlock token as bytes correctly
                    unlock_token = data["encrypted_unlock"].encode()
                    return True, unlock_token

            except Exception as e:
                print(f"Mouse verify error on {filename}: {e}")
                continue

        return False, "Gesture mismatch"
