from __future__ import annotations

import hashlib
import json
import logging
import tempfile
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from .config import settings


logger = logging.getLogger(__name__)


class SpeechService:
    def __init__(self) -> None:
        self._vad_model: Any | None = None
        self._vad_utils: Any | None = None
        self._asr_pipeline: Any | None = None

    def vad(self, audio_path: Path) -> list[dict[str, float]]:
        if not settings.ai_enable_real_models:
            return [{"start": 0.0, "end": 0.0}]
        try:
            import torch

            if self._vad_model is None or self._vad_utils is None:
                self._vad_model, self._vad_utils = torch.hub.load(
                    repo_or_dir=settings.silero_vad_repo,
                    model="silero_vad",
                    trust_repo=True,
                )
            get_speech_timestamps, _, read_audio, _, _ = self._vad_utils
            wav = read_audio(str(audio_path), sampling_rate=16000)
            timestamps = get_speech_timestamps(wav, self._vad_model, sampling_rate=16000)
            return [{"start": item["start"] / 16000.0, "end": item["end"] / 16000.0} for item in timestamps]
        except Exception:
            if not settings.yiban_dev_mode:
                raise
            logger.exception("Silero VAD failed; using development fallback")
            return [{"start": 0.0, "end": 0.0}]

    def transcribe(self, audio_path: Path) -> str:
        if not settings.ai_enable_real_models:
            return "这是一段开发模式语音转写。"
        try:
            from modelscope.pipelines import pipeline
            from modelscope.utils.constant import Tasks

            if self._asr_pipeline is None:
                self._asr_pipeline = pipeline(
                    task=Tasks.auto_speech_recognition,
                    model=settings.sensevoice_model,
                    model_revision=None,
                )
            result = self._asr_pipeline(str(audio_path))
            if isinstance(result, dict):
                return str(result.get("text") or result.get("result") or "").strip()
            return str(result).strip()
        except Exception:
            if not settings.yiban_dev_mode:
                raise
            logger.exception("SenseVoice ASR failed; using development fallback")
            return "我刚才说小宝又长高了，周末有空就回来吃饭。"

    def process_audio_bytes(self, data: bytes, suffix: str) -> tuple[list[dict[str, float]], str]:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
            tmp.write(data)
            tmp.flush()
            path = Path(tmp.name)
            segments = self.vad(path)
            if not segments:
                return [], ""
            return segments, self.transcribe(path)


class EmbeddingService:
    def __init__(self) -> None:
        self._embedder: Any | None = None

    def embed(self, text: str) -> list[float]:
        if settings.ai_enable_real_models:
            try:
                from sentence_transformers import SentenceTransformer

                if self._embedder is None:
                    self._embedder = SentenceTransformer(
                        settings.bge_m3_model,
                        cache_folder=str(settings.model_cache_dir),
                    )
                vector = self._embedder.encode([text], normalize_embeddings=True)[0]
                return self._fit_1024(vector)
            except Exception:
                if not settings.yiban_dev_mode:
                    raise
                logger.exception("bge-m3 embedding failed; using deterministic development fallback")
        return self._hash_embedding(text)

    def _fit_1024(self, vector: Any) -> list[float]:
        arr = np.asarray(vector, dtype=np.float32).flatten()
        if arr.size > 1024:
            arr = arr[:1024]
        elif arr.size < 1024:
            arr = np.pad(arr, (0, 1024 - arr.size))
        norm = np.linalg.norm(arr)
        if norm:
            arr = arr / norm
        return arr.astype(np.float32).tolist()

    def _hash_embedding(self, text: str) -> list[float]:
        seed = hashlib.sha256(text.encode("utf-8")).digest()
        values: list[float] = []
        counter = 0
        while len(values) < 1024:
            digest = hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
            values.extend((byte / 127.5) - 1.0 for byte in digest)
            counter += 1
        arr = np.asarray(values[:1024], dtype=np.float32)
        norm = np.linalg.norm(arr)
        if norm:
            arr = arr / norm
        return arr.tolist()


class LLMClient:
    def __init__(self) -> None:
        self._http = httpx.Client(timeout=httpx.Timeout(45.0, connect=10.0))

    def ready(self) -> bool:
        return bool(settings.ai_enable_deepseek and settings.deepseek_api_key.strip())

    def chat_reply(
        self,
        elder_text: str,
        photo: dict[str, Any] | None,
        related_memories: list[dict[str, Any]],
        fallback: str,
    ) -> str:
        if not self.ready():
            return fallback
        photo_context = self._photo_context(photo)
        memory_context = "\n".join(f"- {item['content']}" for item in related_memories[:5]) or "暂无可引用的长期记忆。"
        messages = [
            {
                "role": "system",
                "content": (
                    "你是忆伴相册的陪伴式 AI。你的角色不是替代家人，而是帮助老人围绕照片、留言和家庭记忆自然表达。"
                    "请用温和、短句、适合老人听的中文回应。不要像系统报告，不评估老人，不纠正记忆，不编造家庭事实。"
                    "如果老人表达不想分享、别告诉孩子、别发给家人，要明确尊重隐私。"
                    "每次回复控制在 80 个中文字符以内，最多问一个容易回答的问题。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"当前照片：{photo_context}\n"
                    f"相关长期记忆：\n{memory_context}\n"
                    f"老人刚才说：{elder_text}\n"
                    "请给出老人端要播报/显示的一句自然回应。"
                ),
            },
        ]
        return self._chat(messages, fallback)

    def family_summary(
        self,
        elder_name: str,
        latest_text: str | None,
        photo: dict[str, Any] | None,
        recent_turns: list[dict[str, Any]],
        fallback: dict[str, Any],
    ) -> dict[str, Any]:
        if not latest_text or not self.ready():
            return fallback
        recent_context = "\n".join(f"- {item['text']}" for item in recent_turns[:8])
        messages = [
            {
                "role": "system",
                "content": (
                    "你是忆伴相册的亲情摘要助手。把老人主动表达的内容转译成适合子女阅读的亲情摘要。"
                    "不要写监控报告，不输出情绪评分，不包含老人明确不愿分享的内容，不编造事实。"
                    "只输出 JSON，字段为 title、body、suggestedReplies。suggestedReplies 是 2 条短回复。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"老人称呼：{elder_name}\n"
                    f"当前照片：{self._photo_context(photo)}\n"
                    f"最近可分享表达：\n{recent_context}\n"
                    "请生成一条温和亲情摘要。"
                ),
            },
        ]
        raw = self._chat(messages, "", response_format={"type": "json_object"})
        try:
            data = json.loads(raw)
            title = str(data.get("title") or fallback["title"]).strip()
            body = str(data.get("body") or fallback["body"]).strip()
            replies = data.get("suggestedReplies") or fallback["suggestedReplies"]
            replies = [str(item).strip() for item in replies if str(item).strip()][:2]
            return {"title": title, "body": body, "suggestedReplies": replies or fallback["suggestedReplies"]}
        except Exception:
            logger.exception("DeepSeek summary JSON parsing failed; using fallback")
            return fallback

    def _chat(
        self,
        messages: list[dict[str, str]],
        fallback: str,
        response_format: dict[str, str] | None = None,
    ) -> str:
        try:
            payload: dict[str, Any] = {
                "model": settings.deepseek_model,
                "messages": messages,
                "temperature": settings.deepseek_temperature,
                "max_tokens": settings.deepseek_max_tokens,
                "stream": False,
            }
            if response_format:
                payload["response_format"] = response_format
            res = self._http.post(
                f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.deepseek_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if res.is_error:
                raise RuntimeError(f"DeepSeek HTTP {res.status_code}: {res.text[:500]}")
            data = res.json()
            return str(data["choices"][0]["message"]["content"]).strip() or fallback
        except Exception:
            if not settings.yiban_dev_mode:
                raise
            logger.exception("DeepSeek request failed; using fallback")
            return fallback

    def _photo_context(self, photo: dict[str, Any] | None) -> str:
        if not photo:
            return "没有绑定具体照片。"
        people = "、".join(photo.get("people") or []) or "家人"
        tags = "、".join(photo.get("sceneTags") or []) or "家庭照片"
        return f"《{photo.get('title', '未命名照片')}》，描述：{photo.get('description', '')}；人物：{people}；场景：{tags}"


class AIEngine:
    def __init__(self) -> None:
        self.speech = SpeechService()
        self.embeddings = EmbeddingService()
        self.llm = LLMClient()

    def process_audio_bytes(self, data: bytes, suffix: str) -> tuple[list[dict[str, float]], str]:
        return self.speech.process_audio_bytes(data, suffix)

    def embed(self, text: str) -> list[float]:
        return self.embeddings.embed(text)

    def chat_reply(
        self,
        elder_text: str,
        photo: dict[str, Any] | None,
        related_memories: list[dict[str, Any]],
        fallback: str,
    ) -> str:
        return self.llm.chat_reply(elder_text, photo, related_memories, fallback)

    def family_summary(
        self,
        elder_name: str,
        latest_text: str | None,
        photo: dict[str, Any] | None,
        recent_turns: list[dict[str, Any]],
        fallback: dict[str, Any],
    ) -> dict[str, Any]:
        return self.llm.family_summary(elder_name, latest_text, photo, recent_turns, fallback)


engine = AIEngine()
