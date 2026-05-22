from __future__ import annotations

from fastapi import APIRouter

from .. import repository


router = APIRouter(prefix="/api/messages", tags=["messages"])


@router.post("", status_code=201)
async def create_message(body: dict) -> dict:
    return repository.create_message(body)
