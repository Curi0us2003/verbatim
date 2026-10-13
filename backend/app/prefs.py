"""Counsellor settings changed from the app (stored in DATA_DIR/settings.json, not in .env)."""

from __future__ import annotations

import json
import secrets
import threading
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from .config import settings

_lock = threading.Lock()


class Prefs(BaseModel):
    password_hash: Optional[str] = None
    secret: str = Field(default_factory=lambda: secrets.token_hex(32))  # signs login cookies
    retention_days: int = 0  # 0 = keep audio until the session is deleted
    auto_insights: bool = False  # F4: generate insights automatically after transcription
    noise_reduction: Optional[Literal["off", "light", "strong"]] = None  # None = use .env default


class PrefsUpdate(BaseModel):
    retention_days: Optional[int] = Field(default=None, ge=0, le=3650)
    auto_insights: Optional[bool] = None
    noise_reduction: Optional[Literal["off", "light", "strong"]] = None


def _path():
    return settings.data_path / "settings.json"


def load() -> Prefs:
    with _lock:
        path = _path()
        if path.exists():
            return Prefs.model_validate_json(path.read_text(encoding="utf-8"))
        prefs = Prefs()
        path.write_text(prefs.model_dump_json(indent=2), encoding="utf-8")
        return prefs


def save(prefs: Prefs) -> None:
    with _lock:
        _path().write_text(prefs.model_dump_json(indent=2), encoding="utf-8")


def update(**changes: Any) -> Prefs:
    prefs = load()
    for key, value in changes.items():
        setattr(prefs, key, value)
    save(prefs)
    return prefs


def public(prefs: Prefs) -> dict:
    return {
        "retention_days": prefs.retention_days,
        "auto_insights": prefs.auto_insights,
        "noise_reduction": prefs.noise_reduction or settings.noise_reduction,
    }


def default_noise() -> str:
    return load().noise_reduction or settings.noise_reduction


def as_json(prefs: Prefs) -> str:
    return json.dumps(public(prefs))
