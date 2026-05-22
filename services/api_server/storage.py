from __future__ import annotations

import logging
from io import BytesIO

from minio import Minio
from minio.error import S3Error

from .config import settings


logger = logging.getLogger(__name__)
client = Minio(
    settings.minio_endpoint,
    access_key=settings.minio_access_key,
    secret_key=settings.minio_secret_key,
    secure=settings.minio_secure,
)


def ensure_buckets() -> None:
    for bucket in [settings.minio_bucket_photos, settings.minio_bucket_audio]:
        try:
            if not client.bucket_exists(bucket):
                client.make_bucket(bucket)
        except S3Error as exc:
            if not settings.yiban_dev_mode:
                raise
            logger.warning("MinIO unavailable for bucket %s: %s", bucket, exc)


def put_bytes(bucket: str, object_key: str, data: bytes, content_type: str) -> None:
    client.put_object(
        bucket,
        object_key,
        BytesIO(data),
        length=len(data),
        content_type=content_type,
    )


def get_bytes(bucket: str, object_key: str) -> tuple[bytes, str]:
    response = client.get_object(bucket, object_key)
    try:
        data = response.read()
        content_type = response.headers.get("content-type") or "application/octet-stream"
        return data, content_type
    finally:
        response.close()
        response.release_conn()
