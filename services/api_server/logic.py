from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta
from typing import Any


CN_TZ = timezone(timedelta(hours=8))


def now_iso() -> str:
    return datetime.now(CN_TZ).isoformat(timespec="seconds")


def split_list(value: str | list[Any]) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in re.split(r"[,，、\s]+", str(value)) if item.strip()]


def split_lines(value: str | list[Any]) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [line.strip() for line in str(value).splitlines() if line.strip()]


def share_policy_for(text: str) -> str:
    return "local_only" if re.search(r"别发|别告诉|不告诉|不要发", text or "") else "summary_allowed"


def infer_photo_context(photo: dict[str, Any] | None) -> str:
    if not photo:
        return "这段对话没有绑定具体照片。"
    tags = "、".join(photo.get("sceneTags") or photo.get("scene_tags") or []) or "家庭照片"
    people = "、".join(photo.get("people") or []) or "家人"
    return f"当前照片是《{photo.get('title', '未命名照片')}》，画面里有{people}，场景线索包括{tags}。"


def simple_ai_reply(text: str, photo: dict[str, Any] | None, related_memories: list[dict[str, Any]] | None = None) -> str:
    clean = text.strip()
    if not clean:
        return "我在这里。你想看看这张照片，还是听听孩子们的留言？"
    if any(word in clean for word in ["别发", "别告诉", "不告诉", "不要发"]):
        return "好，这段我只留在相册里，不发给孩子。"
    if any(word in clean for word in ["发给", "告诉", "回一句", "帮我说"]):
        return "好，我可以帮你整理成一句清楚的话，发送前会再问你一遍。"
    if related_memories:
        memory = related_memories[0]["content"]
        return f"我记得你之前也提到过：{memory}。这张照片又让你想起这件事了吗？"
    if photo:
        prompts = photo.get("memoryPrompts") or photo.get("memory_prompts") or []
        prompt = prompts[0] if prompts else "这张照片让你想起了什么？"
        return f"{photo.get('description', '这是一张很有回忆的照片')}。{prompt}"
    return "听起来这是很重要的一段回忆。你愿意多讲一点吗？"
