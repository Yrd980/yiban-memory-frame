from __future__ import annotations

import json
from typing import Any

from pgvector.psycopg import Vector

from . import cache, db
from .ai import engine
from .config import settings
from .ids import make_id
from .logic import CN_TZ, infer_photo_context, share_policy_for, simple_ai_reply, split_lines, split_list


def _loads(value: Any) -> Any:
    if value is None:
        return []
    if isinstance(value, str):
        return json.loads(value)
    return value


def _iso(value: Any) -> str:
    if hasattr(value, "astimezone"):
        return value.astimezone(CN_TZ).isoformat()
    return str(value)


def _photo(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "imageUrl": row["image_url"],
        "people": _loads(row["people"]),
        "sceneTags": _loads(row["scene_tags"]),
        "memoryPrompts": _loads(row["memory_prompts"]),
        "createdAt": _iso(row["created_at"]),
    }


def _message(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "from": row["sender"],
        "to": row["recipient"],
        "type": row["type"],
        "content": row["content"],
        "photoId": row["photo_id"],
        "createdAt": _iso(row["created_at"]),
        "played": row["played"],
    }


def _turn(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "speaker": row["speaker"],
        "text": row["text"],
        "photoId": row["photo_id"],
        "sharePolicy": row["share_policy"],
        "audioAssetId": row["audio_asset_id"],
        "createdAt": _iso(row["created_at"]),
    }


def _memory(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "sourceConversationId": row["source_conversation_id"],
        "photoId": row["photo_id"],
        "content": row["content"],
        "emotionTags": _loads(row["emotion_tags"]),
        "sharePolicy": row["share_policy"],
        "createdAt": _iso(row["created_at"]),
    }


def _summary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "body": row["body"],
        "suggestedReplies": _loads(row["suggested_replies"]),
        "sourceConversationIds": _loads(row["source_conversation_ids"]),
        "createdAt": _iso(row["created_at"]),
    }


def state() -> dict[str, Any]:
    family = db.fetch_one("SELECT * FROM families WHERE id = %s", (settings.family_id,))
    device = db.fetch_one("SELECT * FROM devices WHERE family_id = %s LIMIT 1", (settings.family_id,))
    photos = db.fetch_all("SELECT * FROM photos WHERE family_id = %s ORDER BY created_at DESC", (settings.family_id,))
    messages = db.fetch_all("SELECT * FROM messages WHERE family_id = %s ORDER BY created_at DESC", (settings.family_id,))
    turns = db.fetch_all("SELECT * FROM conversation_turns WHERE family_id = %s ORDER BY created_at ASC", (settings.family_id,))
    memories = db.fetch_all("SELECT * FROM memories WHERE family_id = %s ORDER BY created_at DESC", (settings.family_id,))
    summaries = db.fetch_all("SELECT * FROM summaries WHERE family_id = %s ORDER BY created_at DESC", (settings.family_id,))
    return {
        "family": {"id": family["id"], "elderName": family["elder_name"], "deviceName": family["device_name"]},
        "device": {
            "presence": device["presence"],
            "micMuted": device["mic_muted"],
            "mode": device["mode"],
            "lastSeenAt": _iso(device["last_seen_at"]) if device["last_seen_at"] else None,
        },
        "photos": [_photo(item) for item in photos],
        "messages": [_message(item) for item in messages],
        "conversations": [_turn(item) for item in turns],
        "memories": [_memory(item) for item in memories],
        "summaries": [_summary(item) for item in summaries],
    }


def get_photo(photo_id: str | None) -> dict[str, Any] | None:
    if not photo_id:
        return None
    row = db.fetch_one("SELECT * FROM photos WHERE id = %s AND family_id = %s", (photo_id, settings.family_id))
    return _photo(row) if row else None


def create_photo(body: dict[str, Any]) -> dict[str, Any]:
    item_id = make_id("photo")
    prompts = split_lines(body.get("memoryPrompts", ""))
    if not prompts:
        prompts = ["这张照片让你想起了什么？"]
    db.execute(
        """
        INSERT INTO photos (id, family_id, title, description, image_url, people, scene_tags, memory_prompts)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)
        """,
        (
            item_id,
            settings.family_id,
            body.get("title") or "新的家庭照片",
            body.get("description") or "家属新上传了一张照片。",
            body.get("imageUrl") or "/assets/sample-family.svg",
            json.dumps(split_list(body.get("people", "")), ensure_ascii=False),
            json.dumps(split_list(body.get("sceneTags", "")), ensure_ascii=False),
            json.dumps(prompts, ensure_ascii=False),
        ),
    )
    return get_photo(item_id) or {}


def create_photo_record(
    title: str,
    description: str,
    image_url: str,
    people: list[str],
    scene_tags: list[str],
    memory_prompts: list[str],
    object_key: str | None = None,
) -> dict[str, Any]:
    item_id = make_id("photo")
    db.execute(
        """
        INSERT INTO photos (
            id, family_id, title, description, image_url, object_key, people, scene_tags, memory_prompts
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)
        """,
        (
            item_id,
            settings.family_id,
            title or "新的家庭照片",
            description or "家属新上传了一张照片。",
            image_url,
            object_key,
            json.dumps(people, ensure_ascii=False),
            json.dumps(scene_tags, ensure_ascii=False),
            json.dumps(memory_prompts or ["这张照片让你想起了什么？"], ensure_ascii=False),
        ),
    )
    return get_photo(item_id) or {}


def create_message(body: dict[str, Any]) -> dict[str, Any]:
    item_id = make_id("msg")
    db.execute(
        """
        INSERT INTO messages (id, family_id, sender, recipient, type, content, photo_id)
        VALUES (%s, %s, %s, %s, 'text', %s, %s)
        """,
        (
            item_id,
            settings.family_id,
            body.get("from") or "家人",
            body.get("to") or "elder",
            body.get("content") or "",
            body.get("photoId") or None,
        ),
    )
    row = db.fetch_one("SELECT * FROM messages WHERE id = %s", (item_id,))
    return _message(row) if row else {}


def search_memories(query_vector: list[float], limit: int = 3) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT id, source_conversation_id, photo_id, content, emotion_tags, share_policy, created_at,
               embedding <=> %s AS distance
        FROM memories
        WHERE family_id = %s AND embedding IS NOT NULL AND share_policy = 'summary_allowed'
        ORDER BY embedding <=> %s
        LIMIT %s
        """,
        (Vector(query_vector), settings.family_id, Vector(query_vector), limit),
    )
    return [{**_memory(row), "distance": float(row["distance"])} for row in rows]


def create_conversation(text: str, photo_id: str | None, embedding: list[float] | None = None, audio_asset_id: str | None = None) -> dict[str, Any]:
    photo = get_photo(photo_id)
    related = search_memories(embedding, 2) if embedding else []
    elder_id = make_id("turn")
    ai_id = make_id("turn")
    policy = share_policy_for(text)
    fallback_reply = simple_ai_reply(text, photo, related)
    ai_text = fallback_reply if policy == "local_only" else engine.chat_reply(text, photo, related, fallback_reply)
    db.execute(
        """
        INSERT INTO conversation_turns (id, family_id, speaker, text, photo_id, share_policy, audio_asset_id)
        VALUES (%s, %s, 'elder', %s, %s, %s, %s), (%s, %s, 'ai', %s, %s, 'summary_allowed', NULL)
        """,
        (elder_id, settings.family_id, text, photo_id, policy, audio_asset_id, ai_id, settings.family_id, ai_text, photo_id),
    )
    if policy == "summary_allowed" and text.strip():
        create_memory(elder_id, photo_id, text, policy, embedding)
    elder = db.fetch_one("SELECT * FROM conversation_turns WHERE id = %s", (elder_id,))
    ai = db.fetch_one("SELECT * FROM conversation_turns WHERE id = %s", (ai_id,))
    return {"elder": _turn(elder), "ai": _turn(ai)}


def create_memory(source_turn_id: str, photo_id: str | None, content: str, policy: str, embedding: list[float] | None) -> dict[str, Any]:
    memory_id = make_id("memory")
    db.execute(
        """
        INSERT INTO memories (
            id, family_id, source_conversation_id, photo_id, content, emotion_tags, share_policy, embedding
        )
        VALUES (%s, %s, %s, %s, %s, '[]'::jsonb, %s, %s)
        """,
        (memory_id, settings.family_id, source_turn_id, photo_id, content, policy, Vector(embedding) if embedding else None),
    )
    row = db.fetch_one("SELECT * FROM memories WHERE id = %s", (memory_id,))
    return _memory(row) if row else {}


def create_audio_asset(bucket: str, object_key: str, content_type: str, size: int, segments: list[dict[str, float]], transcript: str) -> str:
    asset_id = make_id("audio")
    db.execute(
        """
        INSERT INTO audio_assets (id, family_id, bucket, object_key, content_type, size_bytes, vad_segments, transcript)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
        """,
        (
            asset_id,
            settings.family_id,
            bucket,
            object_key,
            content_type,
            size,
            json.dumps(segments, ensure_ascii=False),
            transcript,
        ),
    )
    return asset_id


def build_summary() -> dict[str, Any]:
    rows = db.fetch_all(
        """
        SELECT * FROM conversation_turns
        WHERE family_id = %s AND speaker = 'elder' AND share_policy = 'summary_allowed'
        ORDER BY created_at DESC
        LIMIT 8
        """,
        (settings.family_id,),
    )
    if not rows:
        title = "今天还没有新的亲情摘要"
        body = "今天还没有新的回忆内容。可以给老人发一张照片或一句留言，作为下一次交流的开头。"
        source_ids: list[str] = []
        replies = ["妈，我看到你说的这件事了，晚上我们再聊聊。", "这张照片我也很喜欢，你再给我讲讲那时候的事。"]
    else:
        latest = rows[0]
        photo = get_photo(latest["photo_id"])
        context = infer_photo_context(photo)
        title = f"{settings.elder_name}今天有一段值得回应的回忆"
        body = (
            f"{settings.elder_name}今天围绕相册说到：“{latest['text']}”。"
            f"{context}这段内容适合作为一次轻量回应的开头，可以发一条语音接着聊。"
        )
        source_ids = [latest["id"]]
        replies = ["妈，我看到你说的这件事了，晚上我们再聊聊。", "这张照片我也很喜欢，你再给我讲讲那时候的事。"]
        generated = engine.family_summary(
            settings.elder_name,
            latest["text"],
            photo,
            rows,
            {"title": title, "body": body, "suggestedReplies": replies},
        )
        title = generated["title"]
        body = generated["body"]
        replies = generated["suggestedReplies"]
    summary_id = make_id("summary")
    db.execute(
        """
        INSERT INTO summaries (id, family_id, title, body, suggested_replies, source_conversation_ids)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
        """,
        (
            summary_id,
            settings.family_id,
            title,
            body,
            json.dumps(replies, ensure_ascii=False),
            json.dumps(source_ids, ensure_ascii=False),
        ),
    )
    row = db.fetch_one("SELECT * FROM summaries WHERE id = %s", (summary_id,))
    return _summary(row) if row else {}


def update_presence(presence: bool) -> dict[str, Any]:
    mode = "face_to_face_ready" if presence else "idle_album"
    db.execute(
        "UPDATE devices SET presence = %s, mode = %s, last_seen_at = now() WHERE family_id = %s",
        (presence, mode, settings.family_id),
    )
    device = state()["device"]
    cache.set_json(f"device:{settings.family_id}:state", device)
    cache.push_event("device-events", {"familyId": settings.family_id, "type": "presence", "presence": presence})
    return device


def update_mic_muted(mic_muted: bool) -> dict[str, Any]:
    mode = "mic_muted" if mic_muted else "idle_album"
    db.execute(
        "UPDATE devices SET mic_muted = %s, mode = %s, last_seen_at = now() WHERE family_id = %s",
        (mic_muted, mode, settings.family_id),
    )
    device = state()["device"]
    cache.set_json(f"device:{settings.family_id}:state", device)
    cache.push_event("device-events", {"familyId": settings.family_id, "type": "mic_muted", "micMuted": mic_muted})
    return device
