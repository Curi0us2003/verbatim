"""FastAPI app and routes. All routes live under /api (see SPEC.md, REST API table)."""

from __future__ import annotations

import importlib.util
import logging
import re
import shutil
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session as DBSession
from sqlmodel import select

from . import export, prefs, security, storage
from .ai import llm
from .config import settings
from .jobs import clear_transcript, worker
from .models import (
    PROCESSING,
    Exchange,
    ExchangeUpdate,
    RedactRequest,
    ReprocessRequest,
    Role,
    Session,
    SessionCreate,
    SessionDetail,
    SessionRead,
    SessionStatus,
    Summary,
    SummaryRead,
    Turn,
    TurnSplit,
    TurnUpdate,
    get_db,
    init_db,
    utcnow,
)
from .pipeline import audio as audio_mod
from .pipeline.turns import PAUSE_RE, rebuild_exchanges, reindex, session_turns

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# Large uploads are spooled to a temporary file; keep those next to the data, not on the system drive.
_tmp = settings.data_path / "tmp"
_tmp.mkdir(exist_ok=True)
tempfile.tempdir = str(_tmp)

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".webm", ".mp4"}
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
CLIENT_CODE = re.compile(r"^[A-Za-z]{1,4}-?\d{1,5}$")
LANGUAGES = {"auto", "en", "hi", "kn"}
PUBLIC = {"/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/setup"}

DB = Annotated[DBSession, Depends(get_db)]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    prefs.load()
    worker.start()
    yield


app = FastAPI(title="Verbatim", lifespan=lifespan)
api = APIRouter(prefix="/api")


@app.middleware("http")
async def require_login(request: Request, call_next):
    """App lock: every /api route except login/setup/health needs the signed cookie."""
    path = request.url.path
    if path.startswith("/api") and path not in PUBLIC:
        if not security.token_valid(request.cookies.get(security.COOKIE)):
            return JSONResponse({"detail": "Please sign in."}, status_code=401)
    return await call_next(request)


# ---------------------------------------------------------------------------
# Health and settings
# ---------------------------------------------------------------------------


@api.get("/health")
def health() -> dict:
    """Backend check, active engines (for the cloud-mode banner) and a short system check."""
    try:
        audio_mod.ffmpeg_path()
        ffmpeg_ok = True
    except audio_mod.AudioError:
        ffmpeg_ok = False
    return {
        "status": "ok",
        "transcribe_engine": settings.transcribe_engine,
        "llm_engine": settings.llm_engine,
        "cloud_mode": settings.cloud_mode,
        "checks": {
            "ffmpeg": ffmpeg_ok,
            "whisperx": importlib.util.find_spec("whisperx") is not None,
            "hf_token": bool(settings.hf_token),
            "encryption": storage.encryption_enabled(),
            "whisper_model": settings.whisper_model,
            "llm_model": settings.llm_model_name,
        },
    }


@api.get("/health/llm")
def health_llm() -> dict:
    return llm.status()


@api.get("/settings")
def get_settings() -> dict:
    return prefs.public(prefs.load())


@api.patch("/settings")
def patch_settings(body: prefs.PrefsUpdate) -> dict:
    changes = body.model_dump(exclude_none=True)
    updated = prefs.update(**changes)
    if "retention_days" in changes:
        from .jobs import apply_retention

        apply_retention(worker)
    return prefs.public(updated)


# ---------------------------------------------------------------------------
# App lock
# ---------------------------------------------------------------------------


class PasswordBody(BaseModel):
    password: str


class ChangePasswordBody(BaseModel):
    current: str
    new: str


def _login_response(response: Response) -> dict:
    response.set_cookie(
        security.COOKIE, security.make_token(), max_age=security.LIFETIME_SEC,
        httponly=True, samesite="strict", path="/",
    )
    return {"ok": True}


@api.get("/auth/status")
def auth_status(request: Request) -> dict:
    return {
        "has_password": security.has_password(),
        "logged_in": security.token_valid(request.cookies.get(security.COOKIE)),
    }


@api.post("/auth/setup")
def auth_setup(body: PasswordBody, response: Response) -> dict:
    if security.has_password():
        raise HTTPException(409, "A password is already set.")
    try:
        security.set_password(body.password)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return _login_response(response)


@api.post("/auth/login")
def auth_login(body: PasswordBody, response: Response) -> dict:
    if not security.check_password(body.password):
        time.sleep(1)  # slows down guessing
        raise HTTPException(401, "That password is not right.")
    return _login_response(response)


@api.post("/auth/logout")
def auth_logout(response: Response) -> dict:
    response.delete_cookie(security.COOKIE, path="/")
    return {"ok": True}


@api.post("/auth/password")
def auth_change(body: ChangePasswordBody, response: Response) -> dict:
    if not security.check_password(body.current):
        time.sleep(1)
        raise HTTPException(401, "The current password is not right.")
    try:
        security.set_password(body.new)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return _login_response(response)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def _get(db: DBSession, session_id: int) -> Session:
    s = db.get(Session, session_id)
    if s is None:
        raise HTTPException(404, "Session not found")
    return s


def _detail(db: DBSession, s: Session) -> SessionDetail:
    exchanges = db.exec(select(Exchange).where(Exchange.session_id == s.id).order_by(Exchange.index)).all()
    summary = db.get(Summary, s.id)
    return SessionDetail(
        **SessionRead.of(s).model_dump(),
        turns=session_turns(db, s.id),
        exchanges=exchanges,
        summary=SummaryRead.model_validate(summary.model_dump()) if summary else None,
    )


def _validate_meta(title: str, client_code: str, language: str, consent: bool) -> None:
    if not consent:
        raise HTTPException(400, "The client's informed consent is required before recording or uploading.")
    if not title.strip():
        raise HTTPException(400, "Please give the session a title.")
    if not CLIENT_CODE.match(client_code.strip()):
        raise HTTPException(400, "Use a client code such as C-014, never a real name.")
    if language not in LANGUAGES:
        raise HTTPException(400, "Language must be auto, en, hi or kn.")


def _new_session(db: DBSession, body: SessionCreate) -> Session:
    _validate_meta(body.title, body.client_code, body.language, body.consent)
    now = utcnow()
    created = now
    if body.date:
        local_now = datetime.now().astimezone()
        created = datetime.combine(body.date, local_now.timetz()).astimezone(timezone.utc)
    s = Session(
        title=body.title.strip(),
        client_code=body.client_code.strip().upper(),
        language=body.language,
        created_at=created,
        consent_at=now,
        status=SessionStatus.uploading,
        noise_reduction=body.noise_reduction or prefs.default_noise(),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def _busy(s: Session) -> bool:
    return s.status in PROCESSING or s.status == SessionStatus.insights or worker.is_busy(s.id)


@api.post("/sessions", response_model=SessionRead)
def create_session(body: SessionCreate, db: DB):
    """Start a live recording: metadata + consent first, audio chunks follow."""
    return SessionRead.of(_new_session(db, body))


@api.post("/sessions/upload", response_model=SessionRead)
def upload_session(
    db: DB,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form()],
    client_code: Annotated[str, Form()],
    consent: Annotated[bool, Form()],
    language: Annotated[str, Form()] = "auto",
    date: Annotated[str | None, Form()] = None,
    noise_reduction: Annotated[Literal["off", "light", "strong"] | None, Form()] = None,
):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in AUDIO_EXTENSIONS:
        raise HTTPException(400, "Please upload an mp3, wav, m4a, ogg, webm or mp4 file.")
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "The file is larger than 500 MB.")
    try:
        parsed_date = datetime.strptime(date, "%Y-%m-%d").date() if date else None
    except ValueError:
        raise HTTPException(400, "Date must look like 2026-10-14.")
    s = _new_session(db, SessionCreate(
        title=title, client_code=client_code, language=language, date=parsed_date,
        consent=consent, noise_reduction=noise_reduction,
    ))
    dst = storage.session_dir(s.id) / storage.stored_name(f"original{ext}")
    try:
        with storage.AudioWriter(dst) as w:
            while chunk := file.file.read(storage.BLOCK):
                w.write(chunk)
                if w.size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "The file is larger than 500 MB.")
    except HTTPException:
        db.delete(s)
        db.commit()
        storage.delete_session_audio(s.id)
        raise
    s.original_path = str(dst)
    s.status = SessionStatus.converting
    db.add(s)
    db.commit()
    db.refresh(s)
    worker.enqueue("process", s.id)
    return SessionRead.of(s)


@api.post("/sessions/{session_id}/chunks")
def add_chunk(session_id: int, db: DB, index: Annotated[int, Form()], file: Annotated[UploadFile, File()]):
    """Append one ~30-second recording chunk (F2). Re-sending the same index replaces it."""
    s = _get(db, session_id)
    if s.status != SessionStatus.uploading:
        raise HTTPException(409, "This session is no longer recording.")
    ext = Path(file.filename or "chunk.webm").suffix.lower() or ".webm"
    if ext not in AUDIO_EXTENSIONS:
        ext = ".webm"
    chunk_dir = storage.session_dir(session_id) / "chunks"
    chunk_dir.mkdir(exist_ok=True)
    for old in chunk_dir.glob(f"chunk_{index:05d}.*"):
        old.unlink()
    storage.write_bytes(chunk_dir / storage.stored_name(f"chunk_{index:05d}{ext}"), file.file.read())
    return {"ok": True, "index": index}


@api.post("/sessions/{session_id}/finish", response_model=SessionRead)
def finish_recording(session_id: int, db: DB):
    """Stop recording: join the chunks and start the same pipeline as uploads."""
    s = _get(db, session_id)
    if s.status != SessionStatus.uploading:
        raise HTTPException(409, "This recording has already been finished.")
    chunk_dir = storage.session_dir(session_id) / "chunks"
    chunks = sorted(chunk_dir.glob("chunk_*")) if chunk_dir.exists() else []
    if not chunks:
        raise HTTPException(400, "No audio was received for this recording.")
    ext = Path(chunks[0].name.removesuffix(storage.ENC_SUFFIX)).suffix or ".webm"
    dst = storage.session_dir(session_id) / storage.stored_name(f"original{ext}")
    with storage.AudioWriter(dst) as w:
        audio_mod.join_chunks(chunks, w, storage.read_bytes)
    shutil.rmtree(chunk_dir, ignore_errors=True)
    s.original_path = str(dst)
    s.status = SessionStatus.converting
    db.add(s)
    db.commit()
    db.refresh(s)
    worker.enqueue("process", s.id)
    return SessionRead.of(s)


@api.get("/sessions", response_model=list[SessionRead])
def list_sessions(db: DB):
    return [SessionRead.of(s) for s in db.exec(select(Session).order_by(Session.created_at.desc())).all()]


@api.get("/sessions/{session_id}", response_model=SessionDetail)
def get_session(session_id: int, db: DB):
    return _detail(db, _get(db, session_id))


@api.get("/sessions/{session_id}/status")
def session_status(session_id: int, db: DB) -> dict:
    s = _get(db, session_id)
    return {
        "status": s.status,
        "percent": round(worker.progress.get(session_id, 100 if s.status == SessionStatus.ready else 0)),
        "error": s.error,
        "warning": s.warning,
    }


@api.get("/sessions/{session_id}/audio")
def session_audio(session_id: int, request: Request, db: DB):
    """Stream the processed audio with HTTP range support (decrypting on the fly)."""
    s = _get(db, session_id)
    if not s.audio_path or not Path(s.audio_path).exists():
        raise HTTPException(404, "No audio for this session.")
    path = Path(s.audio_path)
    size = storage.plain_size(path)
    start, end, status = 0, size - 1, 200
    match = re.match(r"bytes=(\d*)-(\d*)", request.headers.get("range", ""))
    if match and (match.group(1) or match.group(2)):
        if match.group(1):
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else size - 1
        else:  # suffix range: last N bytes
            start = max(0, size - int(match.group(2)))
        end = min(end, size - 1)
        if start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        status = 206
    headers = {"Accept-Ranges": "bytes", "Content-Length": str(end - start + 1), "Cache-Control": "no-store"}
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(storage.read_range(path, start, end), status_code=status, media_type="audio/wav",
                             headers=headers)


@api.post("/sessions/{session_id}/swap-roles", response_model=SessionDetail)
def swap_roles(session_id: int, db: DB):
    s = _get(db, session_id)
    if _busy(s):
        raise HTTPException(409, "Please wait until processing has finished.")
    for t in session_turns(db, session_id):
        t.role = Role.client if t.role == Role.counsellor else Role.counsellor
        db.add(t)
    if s.counsellor_speaker:
        s.counsellor_speaker = "SPEAKER_01" if s.counsellor_speaker == "SPEAKER_00" else "SPEAKER_00"
    summary = db.get(Summary, session_id)
    if summary:
        db.delete(summary)  # it was written with the roles the wrong way round
    db.add(s)
    db.commit()
    rebuild_exchanges(db, session_id)
    return _detail(db, s)


@api.post("/sessions/{session_id}/insights", response_model=SessionRead)
def generate_insights(session_id: int, db: DB):
    s = _get(db, session_id)
    if s.status != SessionStatus.ready or worker.is_busy(session_id):
        raise HTTPException(409, "Insights can be generated once the transcript is ready.")
    if not session_turns(db, session_id):
        raise HTTPException(400, "There is no transcript yet.")
    s.status = SessionStatus.insights
    db.add(s)
    db.commit()
    db.refresh(s)
    worker.enqueue("insights", session_id)
    return SessionRead.of(s)


@api.post("/sessions/{session_id}/reprocess", response_model=SessionRead)
def reprocess(session_id: int, body: ReprocessRequest, db: DB):
    """Run the pipeline again from the original recording (e.g. with a different noise setting)."""
    s = _get(db, session_id)
    if _busy(s):
        raise HTTPException(409, "This session is already being processed.")
    if not s.original_path or not Path(s.original_path).exists():
        raise HTTPException(400, "The original recording is no longer available (it may have been removed by the retention setting).")
    if body.noise_reduction:
        s.noise_reduction = body.noise_reduction
    s.status = SessionStatus.converting
    s.error = None
    db.add(s)
    db.commit()
    db.refresh(s)
    worker.enqueue("process", session_id)
    return SessionRead.of(s)


def _redact_value(value: Any, pattern: re.Pattern) -> Any:
    if isinstance(value, str):
        return pattern.sub("[NAME]", value)
    if isinstance(value, list):
        return [_redact_value(v, pattern) for v in value]
    if isinstance(value, dict):
        return {k: _redact_value(v, pattern) for k, v in value.items()}
    return value


@api.post("/sessions/{session_id}/redact")
def redact_names(session_id: int, body: RedactRequest, db: DB) -> dict:
    """Replace the listed names with [NAME] in the transcript, insights and summary."""
    s = _get(db, session_id)
    if _busy(s):
        raise HTTPException(409, "Please wait until processing has finished.")
    names = sorted({n.strip() for n in body.names if n.strip()}, key=len, reverse=True)
    if not names:
        raise HTTPException(400, "List at least one name.")
    pattern = re.compile(r"\b(" + "|".join(re.escape(n) for n in names) + r")\b", re.IGNORECASE)
    replaced = 0
    for t in session_turns(db, session_id):
        new_text, count = pattern.subn("[NAME]", t.text)
        if not count:
            continue
        replaced += count
        words = [dict(w, word=pattern.sub("[NAME]", w["word"])) for w in t.words_json]
        if len(PAUSE_RE.sub(" ", new_text).split()) != len(words):
            t.edited = True  # a multi-word name became one token; word timings no longer line up
        t.text, t.words_json = new_text, words
        db.add(t)
    for ex in db.exec(select(Exchange).where(Exchange.session_id == session_id)).all():
        if ex.insight_json:
            ex.insight_json = _redact_value(ex.insight_json, pattern)
        if ex.counsellor_note:
            ex.counsellor_note = pattern.sub("[NAME]", ex.counsellor_note)
        db.add(ex)
    summary = db.get(Summary, session_id)
    if summary:
        summary.summary_json = _redact_value(summary.summary_json, pattern)
        db.add(summary)
    db.commit()
    return {"replaced": replaced, "session": _detail(db, s).model_dump(mode="json")}


@api.get("/sessions/{session_id}/export")
def export_session(session_id: int, db: DB, format: Literal["pdf", "docx", "txt"] = "txt"):
    s = _get(db, session_id)
    record = export.load(db, s)
    stem = re.sub(r"[^A-Za-z0-9-]+", "_", f"{s.client_code}_{s.created_at:%Y-%m-%d}_{s.title}")[:80].strip("_")
    if format == "txt":
        return Response(export.to_txt(record), media_type="text/plain; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{stem}.txt"'})
    if format == "docx":
        return Response(export.to_docx(record),
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        headers={"Content-Disposition": f'attachment; filename="{stem}.docx"'})
    return HTMLResponse(export.to_print_html(record))


@api.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: DB) -> dict:
    s = _get(db, session_id)
    if worker.is_busy(session_id):
        raise HTTPException(409, "Please wait until processing has finished, then delete.")
    clear_transcript(db, session_id)
    db.delete(s)
    db.commit()
    storage.delete_session_audio(session_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Turns and exchanges
# ---------------------------------------------------------------------------


def _turn(db: DBSession, turn_id: int) -> tuple[Turn, Session]:
    t = db.get(Turn, turn_id)
    if t is None:
        raise HTTPException(404, "Turn not found")
    s = _get(db, t.session_id)
    if _busy(s):
        raise HTTPException(409, "Please wait until processing has finished.")
    return t, s


@api.patch("/turns/{turn_id}", response_model=SessionDetail)
def update_turn(turn_id: int, body: TurnUpdate, db: DB):
    t, s = _turn(db, turn_id)
    regroup = False
    if body.text is not None:
        text = re.sub(r"\s+", " ", body.text).strip()
        if not text:
            raise HTTPException(400, "A turn cannot be empty.")
        if text != t.text:
            t.text, t.edited = text, True
    if body.role is not None and body.role != t.role:
        t.role, regroup = body.role, True
    db.add(t)
    db.commit()
    if regroup:
        rebuild_exchanges(db, s.id)
    return _detail(db, s)


@api.post("/turns/{turn_id}/split", response_model=SessionDetail)
def split_turn(turn_id: int, body: TurnSplit, db: DB):
    """Split a turn in two at a character position; the second part goes to the other speaker."""
    t, s = _turn(db, turn_id)
    at = max(0, min(body.at, len(t.text)))
    left, right = t.text[:at].strip(), t.text[at:].strip()
    if not left or not right:
        raise HTTPException(400, "Choose a point inside the text to split it.")

    def count(text: str) -> int:
        return len(PAUSE_RE.sub(" ", text).split())

    n_left = count(left)
    words = t.words_json
    if not t.edited and len(words) == count(t.text):
        left_words, right_words = words[:n_left], words[n_left:]
    else:
        cut = round(len(words) * n_left / max(1, count(t.text)))
        left_words, right_words = words[:cut], words[cut:]
    fraction = n_left / max(1, count(t.text))
    split_time = next((w["start"] for w in right_words if w.get("start") is not None), None)
    if split_time is None:
        split_time = t.start + (t.end - t.start) * fraction

    for later in db.exec(select(Turn).where(Turn.session_id == s.id, Turn.index > t.index)).all():
        later.index += 1
        db.add(later)
    other_role = Role.client if t.role == Role.counsellor else Role.counsellor
    other_speaker = "SPEAKER_01" if t.speaker_raw == "SPEAKER_00" else "SPEAKER_00"
    db.add(Turn(
        session_id=s.id, index=t.index + 1, speaker_raw=other_speaker, role=other_role,
        start=round(split_time, 3), end=t.end, text=right, words_json=right_words, edited=t.edited,
    ))
    t.text, t.words_json, t.end = left, left_words, round(split_time, 3)
    db.add(t)
    db.commit()
    reindex(db, s.id)
    rebuild_exchanges(db, s.id)
    return _detail(db, s)


@api.patch("/exchanges/{exchange_id}", response_model=Exchange)
def update_exchange(exchange_id: int, body: ExchangeUpdate, db: DB):
    ex = db.get(Exchange, exchange_id)
    if ex is None:
        raise HTTPException(404, "Exchange not found")
    if body.clear_feedback:
        ex.counsellor_feedback = None
    elif body.counsellor_feedback is not None:
        ex.counsellor_feedback = body.counsellor_feedback
    if body.counsellor_note is not None:
        ex.counsellor_note = body.counsellor_note.strip() or None
    db.add(ex)
    db.commit()
    db.refresh(ex)
    return ex


app.include_router(api)
