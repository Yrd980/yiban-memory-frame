from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .. import repository
from ..ai import engine
from ..config import settings
from ..ids import make_id
from ..storage import put_bytes


router = APIRouter(prefix="/api", tags=["conversations"])


@router.post("/conversations", status_code=201)
async def create_conversation(body: dict) -> dict:
    text = body.get("text") or ""
    embedding = engine.embed(text) if text.strip() else None
    return repository.create_conversation(text, body.get("photoId"), embedding)


@router.post("/audio/conversations", status_code=201)
async def create_audio_conversation(
    audio: UploadFile = File(...),
    photoId: str | None = Form(default=None),
) -> dict:
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="audio is empty")
    suffix = Path(audio.filename or "audio.wav").suffix or ".wav"
    object_key = f"{make_id('audio')}{suffix}"
    content_type = audio.content_type or "application/octet-stream"
    put_bytes(settings.minio_bucket_audio, object_key, data, content_type)
    segments, transcript = engine.process_audio_bytes(data, suffix)
    asset_id = repository.create_audio_asset(
        settings.minio_bucket_audio,
        object_key,
        content_type,
        len(data),
        segments,
        transcript,
    )
    if not transcript.strip():
        return {"audioAssetId": asset_id, "transcript": "", "segments": segments, "message": "没有检测到清晰语音"}
    embedding = engine.embed(transcript)
    result = repository.create_conversation(transcript, photoId, embedding, asset_id)
    return {"audioAssetId": asset_id, "transcript": transcript, "segments": segments, **result}
