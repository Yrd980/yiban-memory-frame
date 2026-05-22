from __future__ import annotations

from fastapi import APIRouter

from .. import repository


router = APIRouter(prefix="/api/summaries", tags=["summaries"])


@router.post("/generate", status_code=201)
def generate_summary() -> dict:
    return repository.build_summary()
