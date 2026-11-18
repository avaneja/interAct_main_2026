"""Where uploaded files are kept: a private folder on the server.

Files are saved under random names, so a user-supplied filename never
becomes a path. The folder and files are readable only by the server's
user. A hosted deployment can swap this for object storage behind the same
three methods.
"""

import os
import secrets
from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings


class FileStorage:
    def __init__(self, root: Path) -> None:
        self.root = root

    def save(self, data: bytes, suffix: str) -> str:
        """Store `data` under a new random key ending in `suffix`, and return the key."""
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        key = f"{secrets.token_hex(16)}{suffix}"
        descriptor = os.open(self.root / key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as file:
            file.write(data)
        return key

    def path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if path.parent != self.root.resolve():
            raise ValueError("Not a storage key.")
        return path

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)


@lru_cache
def get_storage() -> FileStorage:
    """FastAPI dependency for the configured upload folder."""
    return FileStorage(get_settings().upload_dir)
