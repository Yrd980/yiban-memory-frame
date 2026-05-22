from __future__ import annotations

from fastapi import APIRouter

from .. import repository


router = APIRouter(prefix="/api/device", tags=["device"])


@router.post("/presence")
async def update_presence(body: dict) -> dict:
    return repository.update_presence(bool(body.get("presence")))


@router.post("/mic-muted")
async def update_mic_muted(body: dict) -> dict:
    return repository.update_mic_muted(bool(body.get("micMuted")))
