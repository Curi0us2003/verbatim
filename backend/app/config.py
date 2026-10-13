"""Reads settings from the project's .env file (see .env.example for every option)."""

import os
from functools import cached_property
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# verbatim/ — two levels up from backend/app/config.py
ROOT_DIR = Path(__file__).resolve().parents[2]

NoiseLevel = Literal["off", "light", "strong"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    # Engines — local is the private default
    transcribe_engine: Literal["local", "groq"] = "local"
    llm_engine: Literal["ollama", "groq"] = "ollama"

    # WhisperX
    whisper_model: str = "large-v3"
    whisper_device: Literal["auto", "cuda", "cpu"] = "auto"
    whisper_compute_type: str = "auto"
    whisper_batch_size: int = 8
    vad_method: Literal["pyannote", "silero"] = "pyannote"
    align_model_kn: str = ""  # optional wav2vec2 model for Kannada word timings

    # Background noise: default for new sessions (each session can override)
    noise_reduction: NoiseLevel = "light"

    # pyannote speaker separation
    hf_token: str = ""
    diarization_model: str = "pyannote/speaker-diarization-3.1"

    # Ollama
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:7b"
    ollama_num_ctx: int = 8192
    llm_temperature: float = 0.2

    # Groq cloud mode (optional)
    groq_api_key: str = ""
    groq_whisper_model: str = "whisper-large-v3"
    groq_llm_model: str = "llama-3.3-70b-versatile"

    # Privacy
    encryption_key: str = ""  # Fernet key; when set, audio is encrypted at rest

    # Storage and server
    data_dir: Path = Path("data")
    models_dir: Path = Path("")  # where downloaded speech models are cached ("" = default HF cache)
    app_host: str = "127.0.0.1"
    app_port: int = 8000

    def _resolve(self, path: Path) -> Path:
        return path if path.is_absolute() else ROOT_DIR / path

    @cached_property
    def data_path(self) -> Path:
        """Absolute data folder; relative values are resolved against the project root."""
        path = self._resolve(self.data_dir)
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
    def models_path(self) -> Path | None:
        if not str(self.models_dir) or str(self.models_dir) == ".":
            return None
        path = self._resolve(self.models_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def cloud_mode(self) -> bool:
        """True when any engine sends data to a third-party service."""
        return self.transcribe_engine == "groq" or self.llm_engine == "groq"

    @property
    def llm_model_name(self) -> str:
        return self.groq_llm_model if self.llm_engine == "groq" else self.ollama_model


settings = Settings()

# Keep every model download (Hugging Face, torch hub) inside MODELS_DIR when it is set.
if settings.models_path is not None:
    os.environ.setdefault("HF_HOME", str(settings.models_path / "huggingface"))
    os.environ.setdefault("TORCH_HOME", str(settings.models_path / "torch"))
