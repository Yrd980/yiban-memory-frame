from __future__ import annotations

from fastapi import APIRouter

from .. import cache, db
from ..storage import ensure_buckets


router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/ready")
def ready() -> dict:
    checks = {
        "database": db.check(),
        "redis": cache.check(),
        "minio": True,
    }
    ensure_buckets()
    return {"status": "ok" if all(checks.values()) else "degraded", "checks": checks}
