"""Shared test setup: a throwaway data folder, encryption on, and fake speech/AI engines.

The fake engines let the whole pipeline (upload → ffmpeg → turns → roles → exchanges →
insights → export) run in seconds without downloading models. tests/test_real_models.py
exercises the real WhisperX engine when VERBATIM_REAL_MODELS=1.
"""

import atexit
import json
import os
import shutil
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="verbatim-test-")


@atexit.register
def _remove_test_data() -> None:
    """Delete the throwaway data folder (close the database first: Windows locks open files)."""
    try:
        from app.models import engine

        engine.dispose()
    except Exception:
        pass
    shutil.rmtree(os.environ["DATA_DIR"], ignore_errors=True)
os.environ["TRANSCRIBE_ENGINE"] = "local"
os.environ["LLM_ENGINE"] = "ollama"
os.environ["ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["HF_TOKEN"] = ""
os.environ["VOICE_CHECK"] = "false"  # tests that need it switch it on with fake fingerprints
if os.environ.get("VERBATIM_REAL_MODELS") != "1":
    os.environ["MODELS_DIR"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE = FIXTURES / "sample_dialogue.wav"
PASSWORD = "test-password-123"


def _words(text: str, start: float, end: float, low: tuple[int, ...] = ()) -> list[dict]:
    tokens = text.split()
    step = (end - start) / len(tokens)
    return [
        {"word": w, "start": round(start + i * step, 2), "end": round(start + (i + 1) * step, 2),
         "score": 0.3 if i in low else 0.92}
        for i, w in enumerate(tokens)
    ]


LINES = [
    (0.5, 4.5, "Hello, thanks for coming in today. How have you been feeling this week?", "SPEAKER_00", ()),
    (5.2, 11.0, "Um, honestly, it has been hard. I keep worrying about my exams, and I, I can't really sleep.",
     "SPEAKER_01", (9,)),
    (14.2, 18.0, "That sounds really tiring. What goes through your mind at night?", "SPEAKER_00", ()),
    (18.7, 23.5, "Mostly that I will fail and let my parents down. Yeah. That's the main thing.", "SPEAKER_01", ()),
]


def fake_segments() -> list[dict]:
    return [{"start": s, "end": e, "text": t, "words": _words(t, s, e, low)} for s, e, t, _spk, low in LINES]


def fake_transcribe(audio, wav, language, progress):
    progress(100)
    return fake_segments(), "en"


def fake_diarize(audio, segments, progress):
    for seg, (_s, _e, _t, speaker, _low) in zip(segments, LINES):
        seg["speaker"] = speaker
        for w in seg["words"]:
            w["speaker"] = speaker
    return segments


INSIGHT = {
    "client_meaning": "The client seems worried about exams and is not sleeping well.",
    "evidence": ["I can't really sleep"],
    "emotions": ["worried", "tired"],
    "underlying_need": "May need reassurance and rest.",
    "confidence": "High",
    "suggested_follow_up": "What helps you wind down at night?",
    "risk_flag": False,
    "risk_note": "",
}
SUMMARY = {
    "overview": "The client described exam worries and poor sleep.",
    "main_themes": ["Exam stress"],
    "client_goals": ["Sleep better"],
    "key_concerns": ["Fear of failing"],
    "emotional_shifts": ["early: tense -> later: open"],
    "strengths_noticed": ["Able to name worries"],
    "topics_for_next_session": ["Sleep routine"],
    "risk_flags": [],
}


class FakeLLM:
    """Answers like a model would; the very first insight reply is broken to exercise the retry."""

    def __init__(self):
        self.calls = 0

    def __call__(self, messages):
        self.calls += 1
        system = messages[0]["content"]
        if "label speakers" in system:
            return json.dumps({"counsellor": "SPEAKER_00", "confidence": 0.9, "reason": "asks questions"})
        if "Summarise" in system:
            return "```json\n" + json.dumps(SUMMARY) + "\n```"
        if self.calls == 1:
            return "Sure! Here is my reading: the client is stressed."  # not JSON → retry
        # Echo the reply being interpreted, so tests can check each card got its own exchange.
        reply = messages[1]["content"].rsplit('Client: "', 1)[-1].rstrip('"')
        return json.dumps({**INSIGHT, "evidence": [reply]})


@pytest.fixture
def fake_engines(monkeypatch):
    from app import jobs
    from app.ai import llm

    fake_llm = FakeLLM()
    monkeypatch.setattr(jobs, "transcribe", fake_transcribe)
    monkeypatch.setattr(jobs, "diarize", fake_diarize)
    monkeypatch.setattr(llm, "complete", fake_llm)
    monkeypatch.setattr(llm, "unload", lambda: None)
    return fake_llm


@pytest.fixture
def client():
    from app.main import app

    with TestClient(app) as c:
        status = c.get("/api/auth/status").json()
        if status["has_password"]:
            assert c.post("/api/auth/login", json={"password": PASSWORD}).status_code == 200
        else:
            assert c.post("/api/auth/setup", json={"password": PASSWORD}).status_code == 200
        yield c


def upload(client, path: Path = SAMPLE, **fields) -> dict:
    data = {"title": "Test session", "client_code": "C-014", "consent": "true", "language": "auto", **fields}
    with open(path, "rb") as f:
        resp = client.post("/api/sessions/upload", data=data, files={"file": (path.name, f, "audio/wav")})
    assert resp.status_code == 200, resp.text
    return resp.json()


def wait_ready(client, session_id: int) -> dict:
    from app.jobs import worker

    worker.wait_idle()
    return client.get(f"/api/sessions/{session_id}").json()


def fake_window_fingerprints(lines, dim: int = 16, seed: int = 0):
    """Stand-in for the voice model: windows inside a line get that speaker's voice (plus a little
    noise); windows in silence get random vectors."""
    import numpy as np

    rng = np.random.default_rng(seed)
    voices = {spk: rng.normal(size=dim) for spk in {line[3] for line in lines}}

    def fingerprints(audio, device):
        centres = np.arange(0.75, len(audio) / 16000 - 0.75, 0.5)
        vecs = []
        for c in centres:
            spk = next((line[3] for line in lines if line[0] <= c <= line[1]), None)
            base = voices[spk] if spk else rng.normal(size=dim)
            vecs.append(base + rng.normal(scale=0.3, size=dim))
        m = np.array(vecs, dtype=np.float32)
        return m / np.linalg.norm(m, axis=1, keepdims=True), centres

    return fingerprints, voices


@pytest.fixture
def fake_voices(monkeypatch):
    """Voice analysis on, with synthetic fingerprints following the sample dialogue's speakers."""
    from app.config import settings
    from app.pipeline import voices

    fingerprints, base = fake_window_fingerprints(LINES)
    monkeypatch.setattr(voices, "window_fingerprints", fingerprints)
    monkeypatch.setattr(settings, "voice_check", True)
    return base
