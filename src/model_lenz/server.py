"""FastAPI app factory and uvicorn launcher.

The ``create_app`` function is also used by tests to spin up an in-process app
without binding a port.
"""

from __future__ import annotations

import contextlib
import socket
import webbrowser
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from model_lenz import __version__
from model_lenz.api.cache import ModelCache
from model_lenz.api.routes import router as api_router

FRONTEND_DIST = Path(__file__).parent / "frontend_dist"


def create_app(
    pbip_path: str | Path,
    *,
    diff_context: dict | None = None,
) -> FastAPI:
    app = FastAPI(
        title="Model Lenz",
        version=__version__,
        description="Open-source PBIP analyzer.",
    )
    app.state.pbip_path = str(Path(pbip_path).resolve())
    app.state.cache = ModelCache()
    # diff_context is None for `model-lenz serve`. It's populated by
    # `model-lenz diff` and read by the /api/diff* routes. Holding it on
    # app.state keeps the API stateless from the caller's perspective.
    app.state.diff_context = diff_context
    app.include_router(api_router)

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict:
        return {"ok": True, "version": __version__, "pbip": app.state.pbip_path}

    # Static SPA — falls through to index.html when the bundle exists; otherwise
    # serve a tiny placeholder so first-time users see *something* before M3 lands.
    if FRONTEND_DIST.exists() and any(FRONTEND_DIST.iterdir()):
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            app.mount(
                "/assets",
                StaticFiles(directory=FRONTEND_DIST / "assets", check_dir=False),
                name="assets",
            )

            @app.get("/{full_path:path}", include_in_schema=False)
            def spa_fallback(full_path: str):
                target = FRONTEND_DIST / full_path
                if full_path and target.exists() and target.is_file():
                    return FileResponse(target)
                return FileResponse(index)

            return app

    # Placeholder root when no frontend bundle is present.
    @app.get("/", include_in_schema=False)
    def root() -> JSONResponse:
        return JSONResponse(
            {
                "service": "model-lenz",
                "version": __version__,
                "pbip": app.state.pbip_path,
                "message": "Frontend bundle not yet built. Use the API at /api/* (OpenAPI: /docs).",
                "docs": "/docs",
            }
        )

    return app


def serve(
    pbip_path: str | Path,
    *,
    host: str = "127.0.0.1",
    port: int = 0,
    open_browser: bool = True,
    diff_context: dict | None = None,
    landing_path: str = "/",
) -> None:
    """Start uvicorn in the foreground. When `diff_context` is set, opens the
    browser to `landing_path` ("/diff" by default for the diff CLI)."""
    import uvicorn

    bound_port = port or _find_free_port(host)
    app = create_app(pbip_path, diff_context=diff_context)

    if open_browser:
        url = f"http://{host}:{bound_port}{landing_path}"
        with contextlib.suppress(Exception):  # nosec - best-effort browser open
            webbrowser.open(url)

    uvicorn.run(app, host=host, port=bound_port, log_level="info")


def _find_free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]
