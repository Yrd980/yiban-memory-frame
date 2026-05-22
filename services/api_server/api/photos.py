from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile

from .. import repository
from ..config import settings
from ..ids import make_id
from ..storage import get_bytes, put_bytes


router = APIRouter(prefix="/api/photos", tags=["photos"])


@router.post("", status_code=201)
async def create_photo(body: dict) -> dict:
    return repository.create_photo(body)


@router.post("/upload", status_code=201)
async def upload_photo(
    image: UploadFile = File(...),
    title: str = Form(default="新的家庭照片"),
    description: str = Form(default=""),
) -> dict:
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="image is empty")
    suffix = Path(image.filename or "photo.jpg").suffix or ".jpg"
    object_key = f"{make_id('photo')}{suffix}"
    content_type = image.content_type or "application/octet-stream"
    put_bytes(settings.minio_bucket_photos, object_key, data, content_type)
    return repository.create_photo_record(
        title,
        description or "家属新上传了一张照片。",
        f"/api/photos/object/{object_key}",
        [],
        ["家庭照片"],
        ["这张照片让你想起了什么？", "你想跟孩子们说说这张照片吗？"],
        object_key,
    )


@router.get("/object/{object_key}")
def photo_object(object_key: str) -> Response:
    data, content_type = get_bytes(settings.minio_bucket_photos, object_key)
    return Response(data, media_type=content_type)
