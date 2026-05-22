from __future__ import annotations

from fastapi import APIRouter

from .. import repository
from ..ai import engine


router = APIRouter(prefix="/api/memories", tags=["memories"])


@router.get("/search")
def search_memories(q: str, limit: int = 5) -> dict:
    vector = engine.embed(q)
    return {"items": repository.search_memories(vector, max(1, min(limit, 20)))}
