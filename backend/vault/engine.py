import os
import json
import uuid
import base64
from security.crypto_utils import encrypt_file, decrypt_file, encrypt_with_key, decrypt_with_key


class VaultEngine:

    def __init__(self, user_dir):
        self.user_dir    = user_dir
        self.storage_dir = os.path.join(user_dir, "storage")
        self.index_file  = os.path.join(user_dir, "index.dat")

    # ── Index ─────────────────────────────────────────────────
    # The index is a JSON dict  { "filename": "blob_id", ... }
    # The whole dict is AES-256-GCM encrypted as one blob.
    # Filenames are stored as plaintext INSIDE that encrypted blob —
    # no need to double-encrypt them; the outer encryption already
    # hides all contents from an attacker.
    # ──────────────────────────────────────────────────────────

    def load_index(self, master_key) -> dict:
        if not os.path.exists(self.index_file):
            return {}
        raw = open(self.index_file, "rb").read()
        try:
            # Try AES-GCM (new format written by this engine)
            decrypted = decrypt_file(master_key, raw)
        except Exception:
            try:
                # Fall back to Fernet (old format from before upgrade)
                decrypted = decrypt_with_key(master_key, raw)
            except Exception:
                return {}
        try:
            return json.loads(decrypted.decode("utf-8"))
        except Exception:
            return {}

    def _save_index(self, master_key, index: dict):
        payload   = json.dumps(index, ensure_ascii=False).encode("utf-8")
        encrypted = encrypt_file(master_key, payload)
        with open(self.index_file, "wb") as f:
            f.write(encrypted)

    # ── Folder operations ─────────────────────────────────────
    def create_folder(self, master_key, folder_path):
        folder_path = folder_path.strip("/")
        index       = self.load_index(master_key)
        marker      = f"{folder_path}/"
        if marker not in index:
            index[marker] = "__folder__"
            self._save_index(master_key, index)
        return True

    def list_folder(self, master_key, folder_path=""):
        index   = self.load_index(master_key)
        prefix  = (folder_path.strip("/") + "/") if folder_path else ""
        folders = set()
        files   = []
        for name, blob_id in index.items():
            if not name.startswith(prefix):
                continue
            rest = name[len(prefix):]
            if not rest:
                continue
            if "/" in rest:
                folders.add(rest.split("/")[0])
            else:
                if blob_id == "__folder__":
                    folders.add(rest.rstrip("/"))
                else:
                    blob_path = os.path.join(self.storage_dir, blob_id)
                    try:
                        enc_size  = os.path.getsize(blob_path)
                        real_size = max(0, enc_size - 28)  # subtract AES-GCM overhead
                    except OSError:
                        real_size = 0
                    files.append({"name": rest, "size": real_size})
        files.sort(key=lambda f: f["name"])
        return {"folders": sorted(folders), "files": files, "path": folder_path}

    def delete_folder(self, master_key, folder_path):
        folder_path = folder_path.strip("/")
        prefix      = folder_path + "/"
        index       = self.load_index(master_key)
        to_delete   = [k for k in index if k == prefix or k.startswith(prefix)]
        for key in to_delete:
            blob_id = index[key]
            if blob_id != "__folder__":
                self._secure_delete_blob(blob_id)
            del index[key]
        self._save_index(master_key, index)
        return True

    # ── File operations ───────────────────────────────────────
    def add_file(self, master_key, filename, data: bytes, folder=""):
        index   = self.load_index(master_key)
        folder  = folder.strip("/")
        key     = f"{folder}/{filename}" if folder else filename
        blob_id = uuid.uuid4().hex

        encrypted = encrypt_file(master_key, data)
        with open(os.path.join(self.storage_dir, blob_id), "wb") as f:
            f.write(encrypted)

        index[key] = blob_id
        self._save_index(master_key, index)

    def get_file(self, master_key, file_path):
        index   = self.load_index(master_key)
        blob_id = index.get(file_path)
        if not blob_id or blob_id == "__folder__":
            return None
        path = os.path.join(self.storage_dir, blob_id)
        if not os.path.exists(path):
            return None
        raw = open(path, "rb").read()
        try:
            return decrypt_file(master_key, raw)
        except Exception:
            try:
                return decrypt_with_key(master_key, raw)   # old Fernet fallback
            except Exception:
                return None

    def delete_file(self, master_key, file_path):
        index   = self.load_index(master_key)
        blob_id = index.get(file_path)
        if not blob_id or blob_id == "__folder__":
            return False
        self._secure_delete_blob(blob_id)
        del index[file_path]
        self._save_index(master_key, index)
        return True

    def rename_file(self, master_key, old_path, new_path):
        index = self.load_index(master_key)
        if old_path not in index:
            return False
        index[new_path] = index.pop(old_path)
        self._save_index(master_key, index)
        return True

    # ── Helpers ───────────────────────────────────────────────
    def _secure_delete_blob(self, blob_id: str):
        """Overwrite blob with random bytes before deleting (resist recovery)."""
        path = os.path.join(self.storage_dir, blob_id)
        if os.path.exists(path):
            size = os.path.getsize(path)
            with open(path, "wb") as f:
                f.write(os.urandom(size))
            os.remove(path)