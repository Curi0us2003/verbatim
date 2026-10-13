"""Background worker: runs one job at a time (the speech models need a lot of memory).

Jobs: "process" (convert → transcribe → identify speakers → turns/roles/exchanges) and
"insights" (per-exchange AI interpretations + session summary). Also enforces audio retention.
"""

from __future__ import annotations

import logging
import queue
import tempfile
import threading
import time
from datetime import timedelta
from pathlib import Path

from sqlmodel import Session as DBSession
from sqlmodel import delete, select

from . import prefs, storage
from .ai import insights as ai_insights
from .ai.llm import LLMError
from .models import PROCESSING, Exchange, Role, Session, SessionStatus, Summary, Turn, engine, utcnow
from .pipeline import audio as audio_mod
from .pipeline.diarize import DiarizationUnavailable, diarize
from .pipeline.roles import detect_counsellor, guess_speakers_without_diarization
from .pipeline.transcribe import transcribe
from .pipeline.turns import build_turns, rebuild_exchanges

log = logging.getLogger("verbatim.jobs")


class PipelineError(RuntimeError):
    pass


class Worker:
    def __init__(self) -> None:
        self._queue: queue.Queue[tuple[str, int]] = queue.Queue()
        self._pending: set[tuple[str, int]] = set()
        self.progress: dict[int, float] = {}  # session id → percent within the current stage
        self._thread: threading.Thread | None = None
        self._retention: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        recover_interrupted()
        self._thread = threading.Thread(target=self._loop, name="verbatim-worker", daemon=True)
        self._thread.start()
        self._retention = threading.Thread(target=self._retention_loop, name="verbatim-retention", daemon=True)
        self._retention.start()

    def enqueue(self, kind: str, session_id: int) -> None:
        if (kind, session_id) in self._pending:
            return
        self._pending.add((kind, session_id))
        self.progress[session_id] = 0
        self._queue.put((kind, session_id))

    def is_busy(self, session_id: int) -> bool:
        return any(sid == session_id for _, sid in self._pending)

    def wait_idle(self, timeout: float = 120) -> None:
        """Used by tests: block until the queue is empty."""
        end = time.time() + timeout
        while (self._pending or not self._queue.empty()) and time.time() < end:
            time.sleep(0.05)

    def _loop(self) -> None:
        while True:
            kind, session_id = self._queue.get()
            try:
                if kind == "process":
                    process_session(session_id, lambda p, sid=session_id: self._set(sid, p))
                    if prefs.load().auto_insights:
                        self._pending.add(("insights", session_id))
                        self._queue.put(("insights", session_id))
                elif kind == "insights":
                    insights_job(session_id, lambda p, sid=session_id: self._set(sid, p))
            except Exception:
                log.exception("Job %s for session %s crashed", kind, session_id)
            finally:
                self._pending.discard((kind, session_id))
                self.progress.pop(session_id, None)

    def _set(self, session_id: int, percent: float) -> None:
        self.progress[session_id] = max(0.0, min(100.0, percent))

    def _retention_loop(self) -> None:
        while True:
            try:
                apply_retention(self)
            except Exception:
                log.exception("Retention check failed")
            time.sleep(3600)


worker = Worker()


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


def _set_status(session_id: int, status: SessionStatus, **fields) -> None:
    with DBSession(engine) as db:
        s = db.get(Session, session_id)
        if s is None:
            raise PipelineError("Session was deleted.")
        s.status = status
        for k, v in fields.items():
            setattr(s, k, v)
        db.add(s)
        db.commit()


def process_session(session_id: int, progress) -> None:
    try:
        _process(session_id, progress)
    except Exception as exc:
        log.exception("Processing failed for session %s", session_id)
        message = str(exc) if isinstance(exc, (PipelineError, audio_mod.AudioError)) else f"Processing failed: {exc}"
        try:
            _set_status(session_id, SessionStatus.failed, error=message[:1000])
        except PipelineError:
            pass


def _process(session_id: int, progress) -> None:
    with DBSession(engine) as db:
        s = db.get(Session, session_id)
        if s is None or not s.original_path:
            raise PipelineError("The recording for this session is missing.")
        original = Path(s.original_path)
        noise, language = s.noise_reduction, s.language
    if not original.exists():
        raise PipelineError("The recording file is missing from disk.")

    _set_status(session_id, SessionStatus.converting, error=None, warning=None)
    progress(5)
    sdir = storage.session_dir(session_id)
    with tempfile.TemporaryDirectory(dir=sdir, prefix="work-") as tmp:
        work = Path(tmp)
        # Plaintext copies exist only inside this temporary folder and are removed afterwards.
        plain_name = original.name.removesuffix(storage.ENC_SUFFIX)
        src = storage.decrypt_to(original, work / plain_name)
        wav = work / "audio.wav"
        audio_mod.convert_to_wav(src, wav, noise)
        src.unlink(missing_ok=True)
        wav_bytes = wav.read_bytes()
        duration = audio_mod.wav_duration(wav_bytes)
        if duration < 1:
            raise PipelineError("The recording is too short (under one second).")
        stored = sdir / storage.stored_name("audio.wav")
        for old in sdir.glob("audio.wav*"):
            old.unlink()
        storage.write_bytes(stored, wav_bytes)
        audio = audio_mod.wav_to_array(wav_bytes)
        del wav_bytes
        _set_status(session_id, SessionStatus.transcribing, audio_path=str(stored), duration_sec=round(duration, 2))
        progress(0)

        segments, detected = transcribe(audio, wav, language, progress)
        wav.unlink(missing_ok=True)
    if not segments:
        raise PipelineError(
            "No speech was found in this recording. If it is very noisy, try Re-process with "
            "a different background-noise setting."
        )

    _set_status(session_id, SessionStatus.diarizing, detected_language=detected)
    progress(0)
    warning = None
    try:
        segments = diarize(audio, segments, progress)
        guessed = False
    except DiarizationUnavailable as exc:
        # Still give a usable transcript: guess speakers from questions, the counsellor can fix them.
        warning = str(exc)
        guessed = True
        for seg, label in zip(segments, guess_speakers_without_diarization(segments)):
            seg["speaker"] = label
            for w in seg["words"]:
                w.pop("speaker", None)
    del audio

    turn_dicts = build_turns(segments)
    if not turn_dicts:
        raise PipelineError("No speech was found in this recording.")
    if guessed:
        counsellor = "SPEAKER_00"
    else:
        counsellor, how = detect_counsellor(turn_dicts)
        log.info("Session %s: counsellor is %s (%s)", session_id, counsellor, how)
    roles = [Role.counsellor if t["speaker_raw"] == counsellor else Role.client for t in turn_dicts]

    with DBSession(engine) as db:
        clear_transcript(db, session_id)
        for i, (t, role) in enumerate(zip(turn_dicts, roles)):
            db.add(Turn(
                session_id=session_id, index=i, speaker_raw=t["speaker_raw"], role=role,
                start=t["start"], end=t["end"], text=t["text"], words_json=t["words"],
            ))
        db.commit()
        rebuild_exchanges(db, session_id)
    _set_status(session_id, SessionStatus.ready, counsellor_speaker=counsellor, warning=warning)
    progress(100)


def clear_transcript(db: DBSession, session_id: int) -> None:
    db.exec(delete(Exchange).where(Exchange.session_id == session_id))
    db.exec(delete(Turn).where(Turn.session_id == session_id))
    summary = db.get(Summary, session_id)
    if summary:
        db.delete(summary)
    db.commit()


def insights_job(session_id: int, progress) -> None:
    with DBSession(engine) as db:
        s = db.get(Session, session_id)
        if s is None:
            return
        previous_warning = s.warning
    _set_status(session_id, SessionStatus.insights)
    try:
        warning = ai_insights.generate_for_session(session_id, progress)
    except LLMError as exc:
        warning = f"AI insights could not be generated: {exc}"
    except Exception as exc:
        log.exception("Insights failed for session %s", session_id)
        warning = f"AI insights could not be generated: {exc}"
    # Keep a speaker-separation warning; replace any older AI warning.
    keep = previous_warning if previous_warning and "Speaker separation" in previous_warning else None
    combined = " ".join(w for w in (keep, warning) if w) or None
    try:
        _set_status(session_id, SessionStatus.ready, warning=combined)
    except PipelineError:
        pass


def recover_interrupted() -> None:
    """After a restart, sessions stuck mid-job are marked so the counsellor can re-run them."""
    with DBSession(engine) as db:
        for s in db.exec(select(Session)).all():
            if s.status in PROCESSING:
                s.status = SessionStatus.failed
                s.error = "Processing was interrupted because the app was closed. Use Re-process to run it again."
                db.add(s)
            elif s.status == SessionStatus.insights:
                s.status = SessionStatus.ready
                db.add(s)
        db.commit()


def apply_retention(w: Worker | None = None) -> int:
    """Delete audio older than the retention setting, keeping the (edited) transcript."""
    days = prefs.load().retention_days
    if days <= 0:
        return 0
    cutoff = utcnow() - timedelta(days=days)
    removed = 0
    with DBSession(engine) as db:
        for s in db.exec(select(Session).where(Session.audio_deleted_at.is_(None))).all():  # type: ignore[union-attr]
            created = s.created_at if s.created_at.tzinfo else s.created_at.replace(tzinfo=cutoff.tzinfo)
            if created > cutoff or s.status in PROCESSING or s.status == SessionStatus.uploading:
                continue
            if w is not None and w.is_busy(s.id):
                continue
            storage.delete_session_audio(s.id)
            s.audio_path = None
            s.original_path = None
            s.audio_deleted_at = utcnow()
            db.add(s)
            removed += 1
        db.commit()
    return removed
