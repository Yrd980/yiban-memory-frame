from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    host: str = "0.0.0.0"
    port: int = 8080
    yiban_dev_mode: bool = True
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    database_url: str = "postgresql://yiban:yiban@localhost:5432/yiban_memory_frame"
    redis_url: str = "redis://localhost:6379/0"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "yiban"
    minio_secret_key: str = "yiban-secret"
    minio_secure: bool = False
    minio_bucket_photos: str = "yiban-photos"
    minio_bucket_audio: str = "yiban-audio"

    model_cache_dir: Path = Field(default=ROOT / ".models")
    ai_enable_real_models: bool = True
    ai_enable_deepseek: bool = True
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_temperature: float = 0.5
    deepseek_max_tokens: int = 800
    sensevoice_model: str = "iic/SenseVoiceSmall"
    bge_m3_model: str = "BAAI/bge-m3"
    silero_vad_repo: str = "snakers4/silero-vad"

    family_id: str = "family-demo"
    elder_name: str = "妈妈"
    device_name: str = "忆伴"


settings = Settings()
