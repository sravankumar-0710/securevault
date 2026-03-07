import os
import json
import secrets
import math
import statistics
import base64
import numpy as np
import cv2
import mediapipe as mp

from security.crypto_utils import generate_fernet_key

AIRGESTURE_FILE_PREFIX = "airgesture_profile_"

# ── MediaPipe solutions ──────────────────────────────────────
mp_hands    = mp.solutions.hands
mp_face     = mp.solutions.face_mesh
mp_drawing  = mp.solutions.drawing_utils


class AirGestureAuth:

    def __init__(self, meta_dir):
        self.meta_dir = meta_dir
        # Persistent detector instances — initialized once, reused every frame
        # This is the biggest performance win: avoids reloading the model per frame
        self._hands_1  = None  # one hand detector
        self._hands_2  = None  # two hands detector
        self._face     = None  # face mesh detector

    def _get_hands(self, max_hands):
        if max_hands == 1:
            if self._hands_1 is None:
                self._hands_1 = mp_hands.Hands(
                    static_image_mode=False,
                    max_num_hands=1,
                    model_complexity=0,
                    min_detection_confidence=0.5,
                    min_tracking_confidence=0.5
                )
            return self._hands_1
        else:
            if self._hands_2 is None:
                self._hands_2 = mp_hands.Hands(
                    static_image_mode=False,
                    max_num_hands=2,
                    model_complexity=0,
                    min_detection_confidence=0.5,
                    min_tracking_confidence=0.5
                )
            return self._hands_2

    def _get_face(self):
        if self._face is None:
            self._face = mp_face.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=False,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5
            )
        return self._face

    def __del__(self):
        # Clean up MediaPipe resources
        try:
            if self._hands_1: self._hands_1.close()
            if self._hands_2: self._hands_2.close()
            if self._face:    self._face.close()
        except Exception:
            pass

    # ─────────────────────────────────────────────────────────
    # LANDMARK EXTRACTION
    # ─────────────────────────────────────────────────────────

    def extract_landmarks(self, frame_b64: str, tracking: list) -> dict:
        """
        Given a base64-encoded JPEG frame and a list of tracking modes
        (e.g. ["one_hand"], ["two_hands"], ["face"], ["one_hand","face"]),
        returns a dict of landmarks and an annotated frame.

        tracking modes:
            "one_hand"  — dominant/first detected hand
            "two_hands" — both hands (padded if only one visible)
            "face"      — face mesh key points (subset of 10)

        NOTE: Uses static_image_mode=False so MediaPipe reuses the loaded
        model across frames instead of reinitializing every call.
        """
        # Decode frame
        img_bytes = base64.b64decode(frame_b64)
        np_arr    = np.frombuffer(img_bytes, np.uint8)
        frame     = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if frame is None:
            return {"landmarks": None, "annotated": None}

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = {}

        # ── Hand tracking — uses persistent detector (no reload per frame) ──
        if "one_hand" in tracking or "two_hands" in tracking:
            max_hands  = 2 if "two_hands" in tracking else 1
            hands      = self._get_hands(max_hands)
            hand_results = hands.process(rgb)
            hand_data  = []

            if hand_results.multi_hand_landmarks:
                for hand_lm in hand_results.multi_hand_landmarks:
                    pts = [{"x": lm.x, "y": lm.y} for lm in hand_lm.landmark]
                    hand_data.append(pts)
                    mp_drawing.draw_landmarks(frame, hand_lm, mp_hands.HAND_CONNECTIONS)

            if "two_hands" in tracking:
                while len(hand_data) < 2:
                    hand_data.append(None)
                result["hands"] = hand_data
            else:
                result["hands"] = [hand_data[0]] if hand_data else [None]

        # ── Face tracking — uses persistent detector ──────────
        if "face" in tracking:
            KEY_INDICES  = [1, 4, 33, 61, 199, 263, 291, 362, 473, 468]
            face_mesh    = self._get_face()
            face_results = face_mesh.process(rgb)

            if face_results.multi_face_landmarks:
                lms = face_results.multi_face_landmarks[0].landmark
                result["face"] = [
                    {"x": lms[i].x, "y": lms[i].y}
                    for i in KEY_INDICES if i < len(lms)
                ]
            else:
                result["face"] = None

        # Encode annotated frame back to base64
        _, buf     = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        annotated  = base64.b64encode(buf).decode()

        return {
            "landmarks": result,   # dict with "hands" and/or "face"
            "annotated": annotated # base64 JPEG with drawings
        }

    # ─────────────────────────────────────────────────────────
    # NORMALIZE A SEQUENCE
    # ─────────────────────────────────────────────────────────

    def _normalize_sequence(self, sequence: list, tracking: list) -> list:
        """
        Takes a list of landmark snapshots (one per frame) and
        normalises each snapshot into a flat feature vector.

        Returns list of flat vectors: [[x0,y0,x1,y1,...], ...]
        """
        normalized = []

        for snap in sequence:
            vec = []

            if "hands" in snap and snap["hands"]:
                for hand in snap["hands"]:
                    if hand is None:
                        # Missing hand — pad with zeros
                        vec.extend([0.0] * 42)  # 21 landmarks * 2
                    else:
                        for pt in hand:
                            vec.append(float(pt["x"]))
                            vec.append(float(pt["y"]))

            if "face" in snap and snap["face"]:
                for pt in snap["face"]:
                    vec.append(float(pt["x"]))
                    vec.append(float(pt["y"]))

            if vec:
                normalized.append(vec)

        return normalized

    # ─────────────────────────────────────────────────────────
    # RESAMPLE SEQUENCE
    # ─────────────────────────────────────────────────────────

    def _resample_sequence(self, sequence: list, target: int = 30) -> list:
        """
        Resamples a variable-length sequence to exactly `target` frames
        using linear interpolation so comparisons are length-consistent.
        """
        if len(sequence) == 0:
            return []

        if len(sequence) == target:
            return sequence

        indices     = np.linspace(0, len(sequence) - 1, target)
        resampled   = []

        for idx in indices:
            lo  = int(math.floor(idx))
            hi  = min(lo + 1, len(sequence) - 1)
            t   = idx - lo

            interp = [
                sequence[lo][j] * (1 - t) + sequence[hi][j] * t
                for j in range(len(sequence[lo]))
            ]
            resampled.append(interp)

        return resampled

    # ─────────────────────────────────────────────────────────
    # BUILD PROFILE FROM SAMPLES
    # ─────────────────────────────────────────────────────────

    def _build_profile(self, all_sequences: list) -> dict:
        """
        Takes 3+ resampled sequences and builds a mean+variance profile.
        """
        n_frames  = len(all_sequences[0])
        n_dims    = len(all_sequences[0][0])

        mean_seq     = []
        variance_seq = []

        for f in range(n_frames):
            frame_mean = []
            frame_var  = []

            for d in range(n_dims):
                vals = [seq[f][d] for seq in all_sequences]
                frame_mean.append(statistics.mean(vals))
                frame_var.append(max(statistics.pvariance(vals), 1e-6))

            mean_seq.append(frame_mean)
            variance_seq.append(frame_var)

        return {
            "mean":     mean_seq,
            "variance": variance_seq,
            "n_frames": n_frames,
            "n_dims":   n_dims
        }

    # ─────────────────────────────────────────────────────────
    # SETUP
    # ─────────────────────────────────────────────────────────

    def setup(self, samples: list, tracking: list) -> bytes:
        """
        samples:  list of 3 gesture recordings.
                  Each recording is a list of landmark snapshots.
        tracking: list of active tracking modes e.g. ["one_hand"]

        Returns unlock token (bytes).
        """
        if len(samples) < 2:
            raise ValueError("Need at least 2 gesture samples")

        all_sequences = []

        for sample in samples:
            normalized = self._normalize_sequence(sample, tracking)
            if len(normalized) < 5:
                raise ValueError("Gesture too short — move more slowly")
            resampled = self._resample_sequence(normalized, target=30)
            all_sequences.append(resampled)

        profile      = self._build_profile(all_sequences)
        unlock_token = generate_fernet_key()

        filename = AIRGESTURE_FILE_PREFIX + secrets.token_hex(12)
        path     = os.path.join(self.meta_dir, filename)

        with open(path, "w") as f:
            json.dump({
                "tracking":         tracking,
                "profile":          profile,
                "encrypted_unlock": unlock_token.hex()
            }, f)

        print(f"Air gesture profile saved: tracking={tracking}, frames={profile['n_frames']}, dims={profile['n_dims']}")

        return unlock_token

    # ─────────────────────────────────────────────────────────
    # VERIFY
    # ─────────────────────────────────────────────────────────

    def verify(self, attempt_sequence: list, tracking: list):
        """
        Returns (True, unlock_token_bytes) on success,
                (False, error_string)       on failure.
        """
        normalized = self._normalize_sequence(attempt_sequence, tracking)

        if len(normalized) < 5:
            return False, "Gesture too short"

        resampled = self._resample_sequence(normalized, target=30)

        files = [
            f for f in os.listdir(self.meta_dir)
            if f.startswith(AIRGESTURE_FILE_PREFIX)
        ]

        for filename in files:
            path = os.path.join(self.meta_dir, filename)

            try:
                with open(path, "r") as f:
                    data = json.load(f)

                # Only compare if tracking modes match
                if set(data["tracking"]) != set(tracking):
                    continue

                profile = data["profile"]
                score   = self._zscore_compare(profile, resampled)

                print(f"Air gesture Z-score: {score:.4f}")

                if score < 2.5:
                    # Adaptive update on confident match
                    if score < 1.5:
                        self._update_profile(path, data, resampled)

                    return True, bytes.fromhex(data["encrypted_unlock"])

            except Exception as e:
                print(f"Air gesture verify error: {e}")
                continue

        return False, "Air gesture mismatch"

    # ─────────────────────────────────────────────────────────
    # Z-SCORE COMPARISON
    # ─────────────────────────────────────────────────────────

    def _zscore_compare(self, profile: dict, attempt: list) -> float:
        """
        Computes average Z-score between attempt and stored profile.
        Lower = more similar.
        """
        mean_seq = profile["mean"]
        var_seq  = profile["variance"]

        if len(attempt) != len(mean_seq):
            attempt = self._resample_sequence(attempt, target=len(mean_seq))

        total_z = 0.0
        count   = 0

        for f in range(len(mean_seq)):
            for d in range(len(mean_seq[f])):
                variance = var_seq[f][d] if var_seq[f][d] > 1e-6 else 1e-6
                z = abs(attempt[f][d] - mean_seq[f][d]) / math.sqrt(variance)
                total_z += z
                count   += 1

        return total_z / count if count > 0 else float("inf")

    # ─────────────────────────────────────────────────────────
    # ADAPTIVE PROFILE UPDATE
    # ─────────────────────────────────────────────────────────

    def _update_profile(self, path: str, data: dict, attempt: list):
        """
        Slightly nudges the mean profile toward a successful attempt.
        """
        LEARNING_RATE = 0.05
        mean_seq      = data["profile"]["mean"]

        for f in range(len(mean_seq)):
            for d in range(len(mean_seq[f])):
                mean_seq[f][d] = (
                    (1 - LEARNING_RATE) * mean_seq[f][d]
                    + LEARNING_RATE * attempt[f][d]
                )

        data["profile"]["mean"] = mean_seq

        with open(path, "w") as f:
            json.dump(data, f)