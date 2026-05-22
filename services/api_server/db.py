from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from typing import Any, Iterator

from pgvector.psycopg import register_vector
from psycopg import ProgrammingError
from psycopg import Connection, rows
from psycopg_pool import ConnectionPool

from .config import settings


logger = logging.getLogger(__name__)
pool = ConnectionPool(settings.database_url, min_size=1, max_size=10, open=False)


@contextmanager
def connection() -> Iterator[Connection]:
    if pool.closed:
        pool.open()
    with pool.connection() as conn:
        try:
            register_vector(conn)
        except ProgrammingError:
            conn.rollback()
        conn.row_factory = rows.dict_row
        yield conn


def fetch_one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()


def fetch_all(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())


def execute(sql: str, params: tuple[Any, ...] = ()) -> None:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)


def check() -> bool:
    row = fetch_one("SELECT 1 AS ok")
    return bool(row and row["ok"] == 1)


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def init_db() -> None:
    logger.info("Initializing PostgreSQL schema")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            register_vector(conn)
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS families (
                    id text PRIMARY KEY,
                    elder_name text NOT NULL,
                    device_name text NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS devices (
                    id text PRIMARY KEY,
                    family_id text NOT NULL REFERENCES families(id),
                    presence boolean NOT NULL DEFAULT false,
                    mic_muted boolean NOT NULL DEFAULT false,
                    mode text NOT NULL DEFAULT 'idle_album',
                    last_seen_at timestamptz
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS photos (
                    id text PRIMARY KEY,
                    family_id text NOT NULL REFERENCES families(id),
                    title text NOT NULL,
                    description text NOT NULL,
                    image_url text NOT NULL,
                    object_key text,
                    people jsonb NOT NULL DEFAULT '[]',
                    scene_tags jsonb NOT NULL DEFAULT '[]',
                    memory_prompts jsonb NOT NULL DEFAULT '[]',
                    created_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id text PRIMARY KEY,
                    family_id text NOT NULL REFERENCES families(id),
                    sender text NOT NULL,
                    recipient text NOT NULL DEFAULT 'elder',
                    type text NOT NULL DEFAULT 'text',
                    content text NOT NULL,
                    photo_id text REFERENCES photos(id),
                    played boolean NOT NULL DEFAULT false,
                    created_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS conversation_turns (
                    id text PRIMARY KEY,
                    family_id text NOT NULL REFERENCES families(id),
                    speaker text NOT NULL,
                    text text NOT NULL,
                    photo_id text REFERENCES photos(id),
                    share_policy text NOT NULL DEFAULT 'summary_allowed',
                    audio_asset_id text,
                    created_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS audio_assets (
                    id text PRIMARY KEY,
                    family_id text NOT NULL REFERENCES families(id),
                    bucket text NOT NULL,
                    object_key text NOT NULL,
                    content_type text NOT NULL,
                    size_bytes bigint NOT NULL,
                    vad_segments jsonb NOT NULL DEFAULT '[]',
                    transcript text,
                    created_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS memories (
                    id text PRIMARY KEY,
                    family_id text NOT NULL REFERENCES families(id),
                    source_conversation_id text REFERENCES conversation_turns(id),
                    photo_id text REFERENCES photos(id),
                    content text NOT NULL,
                    emotion_tags jsonb NOT NULL DEFAULT '[]',
                    share_policy text NOT NULL DEFAULT 'summary_allowed',
                    embedding vector(1024),
                    created_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS summaries (
                    id text PRIMARY KEY,
                    family_id text NOT NULL REFERENCES families(id),
                    title text NOT NULL,
                    body text NOT NULL,
                    suggested_replies jsonb NOT NULL DEFAULT '[]',
                    source_conversation_ids jsonb NOT NULL DEFAULT '[]',
                    created_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_memories_embedding
                ON memories USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 20)
                """
            )
            cur.execute(
                """
                INSERT INTO families (id, elder_name, device_name)
                VALUES (%s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (settings.family_id, settings.elder_name, settings.device_name),
            )
            cur.execute(
                """
                INSERT INTO devices (id, family_id)
                VALUES (%s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                ("device-demo", settings.family_id),
            )
            cur.execute(
                """
                INSERT INTO photos (
                    id, family_id, title, description, image_url, people, scene_tags, memory_prompts
                )
                VALUES
                    (
                        'photo-demo-1',
                        %s,
                        '公园里的小宝',
                        '小宝在公园放风筝，看起来很开心。',
                        '/assets/sample-park.svg',
                        %s::jsonb,
                        %s::jsonb,
                        %s::jsonb
                    ),
                    (
                        'photo-demo-2',
                        %s,
                        '过年的全家福',
                        '一家人坐在饭桌前，像是春节团圆时拍的照片。',
                        '/assets/sample-family.svg',
                        %s::jsonb,
                        %s::jsonb,
                        %s::jsonb
                    )
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    settings.family_id,
                    json_dumps(["小宝"]),
                    json_dumps(["公园", "放风筝", "春天"]),
                    json_dumps(["你还记得小宝第一次放风筝是什么时候吗？", "这张照片让你想到谁小时候？"]),
                    settings.family_id,
                    json_dumps(["妈妈", "女儿", "小宝"]),
                    json_dumps(["春节", "团圆", "家里"]),
                    json_dumps(["那年过年家里最热闹的事情是什么？", "这张照片里你最想跟孩子们说什么？"]),
                ),
            )
            cur.execute(
                """
                INSERT INTO messages (id, family_id, sender, content, photo_id, created_at)
                VALUES (
                    'msg-demo-1',
                    %s,
                    '女儿',
                    '妈，今天小宝去公园放风筝了，给你看看。',
                    'photo-demo-1',
                    '2026-05-20T10:10:00+08:00'
                )
                ON CONFLICT (id) DO NOTHING
                """,
                (settings.family_id,),
            )
