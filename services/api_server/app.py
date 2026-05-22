from __future__ import annotations

import mimetypes
import posixpath
import logging
from urllib.parse import unquote

import uvicorn
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from . import cache, db
from .api import conversations, device, health, memories, messages, photos, state, summaries
from .config import ROOT, settings
from .errors import install_error_handlers
from .storage import ensure_buckets


logger = logging.getLogger(__name__)

STATIC_DIRS = {
    "/device": ROOT / "apps" / "device-ui",
    "/family": ROOT / "apps" / "family-web",
}


app = FastAPI(title="Yiban Memory Frame", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
install_error_handlers(app)
app.include_router(health.router)
app.include_router(state.router)
app.include_router(photos.router)
app.include_router(messages.router)
app.include_router(conversations.router)
app.include_router(memories.router)
app.include_router(summaries.router)
app.include_router(device.router)


@app.on_event("startup")
def startup() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    db.init_db()
    ensure_buckets()
    try:
        cache.ping()
    except Exception as exc:
        if not settings.yiban_dev_mode:
            raise
        logger.warning("Redis unavailable in development mode: %s", exc)


@app.get("/")
def root() -> RedirectResponse:
    return RedirectResponse("/device/")


@app.get("/assets/{name}")
def assets(name: str) -> Response:
    if name == "sample-park.svg":
        return svg("公园", "#4c9f70", "#f6d365")
    if name == "sample-family.svg":
        return svg("团圆", "#7c5c9e", "#f4a261")
    raise HTTPException(status_code=404, detail="Asset not found")


@app.get("/{prefix:path}", response_model=None)
def static(prefix: str):
    path = "/" + prefix
    for mount, directory in STATIC_DIRS.items():
        if path == mount:
            return RedirectResponse(mount + "/")
        if path.startswith(mount + "/"):
            rel = path[len(mount) :].lstrip("/") or "index.html"
            rel = posixpath.normpath(unquote(rel))
            if rel.startswith("../"):
                raise HTTPException(status_code=400, detail="Invalid path")
            target = directory / rel
            if target.is_dir():
                target = target / "index.html"
            if not target.exists():
                target = directory / "index.html"
            media_type = mimetypes.guess_type(target.name)[0]
            return FileResponse(target, media_type=media_type)
    raise HTTPException(status_code=404, detail="Not found")


def svg(label: str, color_a: str, color_b: str) -> Response:
    data = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
<rect width="1200" height="800" fill="{color_a}"/>
<circle cx="980" cy="170" r="120" fill="{color_b}" opacity=".85"/>
<rect x="110" y="120" width="980" height="560" rx="28" fill="#fff7" stroke="#fff" stroke-width="8"/>
<text x="600" y="405" text-anchor="middle" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="88" fill="#fff">{label}</text>
<text x="600" y="485" text-anchor="middle" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="34" fill="#fff" opacity=".9">Yiban Memory Frame</text>
</svg>"""
    return Response(data, media_type="image/svg+xml; charset=utf-8")


def run() -> None:
    uvicorn.run("services.api_server.app:app", host=settings.host, port=settings.port, reload=False)
