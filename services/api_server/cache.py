from __future__ import annotations

import json
from typing import Any

import redis

from .config import settings


_client: redis.Redis | None = None


def client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def ping() -> None:
    client().ping()


def check() -> bool:
    return bool(client().ping())


def set_json(key: str, value: dict[str, Any], ttl_seconds: int = 3600) -> None:
    client().setex(key, ttl_seconds, json.dumps(value, ensure_ascii=False))


def push_event(stream: str, event: dict[str, Any]) -> None:
    client().xadd(stream, {"payload": json.dumps(event, ensure_ascii=False)}, maxlen=1000, approximate=True)
