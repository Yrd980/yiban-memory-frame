from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from minio.error import S3Error
from psycopg import Error as PsycopgError
from redis import RedisError


logger = logging.getLogger(__name__)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(PsycopgError)
    async def database_error_handler(_: Request, exc: PsycopgError) -> JSONResponse:
        logger.exception("Database operation failed")
        return JSONResponse({"error": "database_error", "message": "数据库暂时不可用"}, status_code=503)

    @app.exception_handler(RedisError)
    async def redis_error_handler(_: Request, exc: RedisError) -> JSONResponse:
        logger.exception("Redis operation failed")
        return JSONResponse({"error": "cache_error", "message": "缓存服务暂时不可用"}, status_code=503)

    @app.exception_handler(S3Error)
    async def storage_error_handler(_: Request, exc: S3Error) -> JSONResponse:
        logger.exception("Object storage operation failed")
        return JSONResponse({"error": "storage_error", "message": "对象存储暂时不可用"}, status_code=503)
