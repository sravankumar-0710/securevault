import os
import json
import uuid
from security.crypto_utils import encrypt_file, decrypt_file, encrypt_with_key, decrypt_with_key


class VaultEngine:

    def __init__(self, user_dir):
        self.user_dir    = user_dir
        self.storage_dir = os.path.join(user_dir, "storage")
        self.index_file  = os.path.join(user_dir, "index.dat")

    # ── Index ────────────────────────────────────────────────
    def load_index(self, master_key):
        if not os.path.exists(self.index_file):
            return {}
        raw       = open(self.index_file, "rb").read()
        # Try AES-GCM first (new format), fall back to Fernet (old format)
        try:
            decrypted = decrypt_file(master_key, raw)
        except Exception:
            decrypted = decrypt_with_key(master_key, raw)

        encrypted_index = json.loads(decrypted.decode())
        real_index = {}
        for enc_name, blob_id in encrypted_index.items():
            try:
                try:
                    real_name = decrypt_file(master_key, enc_name.encode()).decode()
                except Exception:
                    real_name = decrypt_with_key(master_key, enc_name.encode()).decode()
                real_index[real_name] = blob_id
            except Exception:
                continue
        return real_index

    def _save_index(self, master_key, real_index):
        encrypted_index = {}
        for real_name, blob_id in real_index.items():
            enc_name = encrypt_file(master_key, real_name.encode()).decode()
            encrypted_index[enc_name] = blob_id
        encrypted = encrypt_file(master_key, json.dumps(encrypted_index).encode())
        open(self.index_file, "wb").write(encrypted)

    # ── Folder operations ────────────────────────────────────
    def create_folder(self, master_key, folder_path):
        folder_path = folder_path.strip("/")
        index = self.load_index(master_key)
        marker = f"{folder_path}/"
        if marker not in index:
            index[marker] = "__folder__"
            self._save_index(master_key, index)
        return True

    def list_folder(self, master_key, folder_path=""):
        index  = self.load_index(master_key)
        prefix = (folder_path.strip("/") + "/") if folder_path else ""
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
                    files.append(rest)
        return {"folders": sorted(folders), "files": sorted(files), "path": folder_path}

    def delete_folder(self, master_key, folder_path):
        folder_path = folder_path.strip("/")
        prefix      = folder_path + "/"
        index       = self.load_index(master_key)
        to_delete   = [k for k in index if k == prefix or k.startswith(prefix)]
        for key in to_delete:
            blob_id = index[key]
            if blob_id != "__folder__":
                blob_path = os.path.join(self.storage_dir, blob_id)
                if os.path.exists(blob_path):
                    # Overwrite with random bytes before deleting
                    size = os.path.getsize(blob_path)
                    with open(blob_path, "wb") as f:
                        f.write(os.urandom(size))
                    os.remove(blob_path)
            del index[key]
        self._save_index(master_key, index)
        return True

    # ── File operations ──────────────────────────────────────
    def add_file(self, master_key, filename, data, folder=""):
        index  = self.load_index(master_key)
        folder = folder.strip("/")
        key    = f"{folder}/{filename}" if folder else filename

        blob_id        = uuid.uuid4().hex
        # AES-256-GCM encryption for all files
        encrypted_data = encrypt_file(master_key, data)
        open(os.path.join(self.storage_dir, blob_id), "wb").write(encrypted_data)

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
            # Fall back to Fernet for files encrypted before upgrade
            return decrypt_with_key(master_key, raw)

    def delete_file(self, master_key, file_path):
        index   = self.load_index(master_key)
        blob_id = index.get(file_path)
        if not blob_id or blob_id == "__folder__":
            return False
        blob_path = os.path.join(self.storage_dir, blob_id)
        if os.path.exists(blob_path):
            # Overwrite with random bytes before deleting (secure delete)
            size = os.path.getsize(blob_path)
            with open(blob_path, "wb") as f:
                f.write(os.urandom(size))
            os.remove(blob_path)
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