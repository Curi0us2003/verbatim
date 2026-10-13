"""SQLModel tables (Session, Turn, Exchange, Summary), read models and the database engine."""

from collections.abc import Iterator
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import field_serializer
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel, create_engine
from sqlmodel import Session as DBSession

from .config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SessionStatus(str, Enum):
    uploading = "uploading"
    converting = "converting"
    transcribing = "transcribing"
    diarizing = "diarizing"
    ready = "ready"
    insights = "insights"
    failed = "failed"


class Role(str, Enum):
    counsellor = "counsellor"
    client = "client"


class Feedback(str, Enum):
    agree = "agree"
    disagree = "disagree"


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------


class SessionBase(SQLModel):
    title: str
    client_code: str = Field(index=True)  # pseudonym such as C-014, never a real name
    language: str = "auto"  # auto | en | hi | kn
    created_at: datetime = Field(default_factory=utcnow)
    consent_at: Optional[datetime] = None  # when the consent box was ticked (Privacy section)
    duration_sec: Optional[float] = None
    status: SessionStatus = SessionStatus.uploading
    error: Optional[str] = None
    counsellor_speaker: Optional[str] = None  # SPEAKER_00 or SPEAKER_01


class Session(SessionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    audio_path: Optional[str] = None


class Turn(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", index=True)
    index: int
    speaker_raw: str  # SPEAKER_00 / SPEAKER_01 from diarization
    role: Role
    start: float
    end: float
    text: str
    # [{"word": "um,", "start": 1.2, "end": 1.4, "score": 0.91}, ...]
    words_json: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    edited: bool = False


class Exchange(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", index=True)
    index: int
    counsellor_turn_ids: list[int] = Field(default_factory=list, sa_column=Column(JSON))
    client_turn_ids: list[int] = Field(default_factory=list, sa_column=Column(JSON))
    insight_json: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    counsellor_feedback: Optional[Feedback] = None
    counsellor_note: Optional[str] = None


class Summary(SQLModel, table=True):
    session_id: int = Field(foreign_key="session.id", primary_key=True)
    summary_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    model_used: str
    created_at: datetime = Field(default_factory=utcnow)


# ---------------------------------------------------------------------------
# API read models (audio_path stays internal)
# ---------------------------------------------------------------------------


class SessionRead(SessionBase):
    id: int

    @field_serializer("created_at", "consent_at")
    def _as_utc(self, value: Optional[datetime]) -> Optional[str]:
        # SQLite drops the timezone; every stored time is UTC, so label it as such.
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()


class SessionDetail(SessionRead):
    turns: list[Turn] = []
    exchanges: list[Exchange] = []
    summary: Optional[Summary] = None


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

engine = create_engine(
    f"sqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_db() -> Iterator[DBSession]:
    with DBSession(engine) as db:
        yield db
