"""Reads settings from the project's .env file (see .env.example for every option)."""

from functools import cached_property
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# verbatim/ — two levels up from backend/app/config.py
ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    # Engines — local is the private default
    transcribe_engine: Literal["local", "groq"] = "local"
    llm_engine: Literal["ollama", "groq"] = "ollama"

    # WhisperX (Phase 2)
    whisper_model: str = "large-v3"
    whisper_device: Literal["auto", "cuda", "cpu"] = "auto"
    whisper_compute_type: str = "auto"

    # pyannote (Phase 3)
    hf_token: str = ""

    # Ollama (Phase 6)
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:7b"

    # Groq cloud mode (optional)
    groq_api_key: str = ""
    groq_whisper_model: str = "whisper-large-v3"
    groq_llm_model: str = "llama-3.3-70b-versatile"

    # Storage and server
    data_dir: Path = Path("data")
    app_host: str = "127.0.0.1"
    app_port: int = 8000

    @cached_property
    def data_path(self) -> Path:
        """Absolute data folder; relative values are resolved against the project root."""
        path = self.data_dir if self.data_dir.is_absolute() else ROOT_DIR / self.data_dir
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def audio_dir(self) -> Path:
        path = self.data_path / "audio"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def db_path(self) -> Path:
        return self.data_path / "verbatim.sqlite3"

    @property
    def cloud_mode(self) -> bool:
        """True when any engine sends data to a third-party service."""
        return self.transcribe_engine == "groq" or self.llm_engine == "groq"


settings = Settings()
