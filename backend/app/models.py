"""SQLModel tables (Session, Turn, Exchange, Summary), API models and the database engine."""

from collections.abc import Iterator
from datetime import date as Date
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, field_serializer
from sqlalchemy import JSON, Column, event
from sqlmodel import Field, SQLModel, create_engine
from sqlmodel import Session as DBSession

from .config import NoiseLevel, settings


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


PROCESSING = {SessionStatus.converting, SessionStatus.transcribing, SessionStatus.diarizing}


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
    language: str = "auto"  # auto | en | hi | kn (detected language is stored after transcription)
    created_at: datetime = Field(default_factory=utcnow)
    consent_at: Optional[datetime] = None  # when the consent box was ticked (Privacy section)
    duration_sec: Optional[float] = None
    status: SessionStatus = SessionStatus.uploading
    error: Optional[str] = None
    warning: Optional[str] = None  # non-fatal problem, e.g. speaker separation skipped
    counsellor_speaker: Optional[str] = None  # SPEAKER_00 or SPEAKER_01
    noise_reduction: str = "light"  # off | light | strong (background noise handling)
    detected_language: Optional[str] = None
    audio_deleted_at: Optional[datetime] = None  # set when the retention setting removed the audio


class Session(SessionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    audio_path: Optional[str] = None  # processed 16 kHz WAV (encrypted when a key is set)
    original_path: Optional[str] = None  # the uploaded file / joined recording, kept for re-processing


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
# API models (audio paths stay internal)
# ---------------------------------------------------------------------------


def _iso_utc(value: Optional[datetime]) -> Optional[str]:
    # SQLite drops the timezone; every stored time is UTC, so label it as such.
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


class SessionRead(SessionBase):
    id: int
    has_audio: bool = False

    @field_serializer("created_at", "consent_at", "audio_deleted_at")
    def _as_utc(self, value: Optional[datetime]) -> Optional[str]:
        return _iso_utc(value)

    @classmethod
    def of(cls, s: Session) -> "SessionRead":
        return cls(**s.model_dump(exclude={"audio_path", "original_path"}), has_audio=bool(s.audio_path))


class SummaryRead(BaseModel):
    session_id: int
    summary_json: dict[str, Any]
    model_used: str
    created_at: datetime

    @field_serializer("created_at")
    def _as_utc(self, value: datetime) -> Optional[str]:
        return _iso_utc(value)


class SessionDetail(SessionRead):
    turns: list[Turn] = []
    exchanges: list[Exchange] = []
    summary: Optional[SummaryRead] = None


class SessionCreate(BaseModel):
    title: str
    client_code: str
    language: str = "auto"
    date: Optional[Date] = None
    consent: bool = False
    noise_reduction: Optional[NoiseLevel] = None


class TurnUpdate(BaseModel):
    text: Optional[str] = None
    role: Optional[Role] = None


class TurnSplit(BaseModel):
    at: int  # character offset in the turn text where the second part starts


class ExchangeUpdate(BaseModel):
    counsellor_feedback: Optional[Feedback] = None
    counsellor_note: Optional[str] = None
    clear_feedback: bool = False


class RedactRequest(BaseModel):
    names: list[str]


class ReprocessRequest(BaseModel):
    noise_reduction: Optional[NoiseLevel] = None


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

engine = create_engine(
    f"sqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")  # the API can read while the worker writes
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


def _migrate() -> None:
    """Add columns introduced after Phase 1 to an existing database (SQLite has no auto-migrate)."""
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if "session" not in insp.get_table_names():
        return
    have = {c["name"] for c in insp.get_columns("session")}
    wanted = {
        "warning": "VARCHAR",
        "noise_reduction": "VARCHAR DEFAULT 'light' NOT NULL",
        "detected_language": "VARCHAR",
        "audio_deleted_at": "DATETIME",
        "original_path": "VARCHAR",
    }
    with engine.begin() as conn:
        for name, ddl in wanted.items():
            if name not in have:
                conn.execute(text(f"ALTER TABLE session ADD COLUMN {name} {ddl}"))


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _migrate()


def get_db() -> Iterator[DBSession]:
    with DBSession(engine) as db:
        yield db
