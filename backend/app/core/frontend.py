"""Serving the built web app from the backend, for a single-service deployment.

The API stays under /api. Any other GET returns the file of that name from
the build (scripts, styles, the 3D model, voice and face-model files) or,
for the app's own routes such as /sessions/{id}/report, index.html, so the
browser router can take over. Paths cannot leave the build folder.
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

# Hashed build files never change, so browsers may keep them; everything else is checked each time.
IMMUTABLE = "public, max-age=31536000, immutable"


def serve_frontend(app: FastAPI, dist: Path) -> None:
    root = dist.resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"FRONTEND_DIST has no index.html: {root}")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        file = (root / path).resolve()
        if path and file.is_file() and file.is_relative_to(root):
            headers = {"Cache-Control": IMMUTABLE} if path.startswith("assets/") else {"Cache-Control": "no-cache"}
            return FileResponse(file, headers=headers)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
