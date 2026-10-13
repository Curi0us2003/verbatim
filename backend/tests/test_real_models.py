"""Real WhisperX transcription of the sample dialogue (slow; downloads a model on first run).

Run with:  set VERBATIM_REAL_MODELS=1  then  npm test -- tests/test_real_models.py
WHISPER_MODEL in .env decides the model (use "small" for a quick check).
"""

import os

import pytest
from conftest import SAMPLE

pytestmark = pytest.mark.skipif(os.environ.get("VERBATIM_REAL_MODELS") != "1", reason="set VERBATIM_REAL_MODELS=1")


def test_whisperx_transcribes_sample(tmp_path):
    from app.pipeline import audio
    from app.pipeline.transcribe import transcribe_local
    from app.pipeline.turns import build_turns

    wav = tmp_path / "a.wav"
    audio.convert_to_wav(SAMPLE, wav, "light")
    samples = audio.wav_to_array(wav.read_bytes())
    segments, language = transcribe_local(samples, None, lambda p: None)
    text = " ".join(s["text"] for s in segments).lower()
    print("\nTRANSCRIPT:", text)
    assert language == "en"
    assert "exams" in text and "sleep" in text
    words = [w for s in segments for w in s["words"]]
    assert all(w["start"] is None or w["start"] >= 0 for w in words)
    assert sum(w["score"] is not None for w in words) > len(words) / 2  # aligned with confidence
    turns = build_turns(segments)
    assert any("[pause" in t["text"] for t in turns) or len(segments) > 1
