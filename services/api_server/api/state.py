from __future__ import annotations

from fastapi import APIRouter

from .. import repository


router = APIRouter(prefix="/api", tags=["state"])


@router.get("/state")
def get_state() -> dict:
    return repository.state()
