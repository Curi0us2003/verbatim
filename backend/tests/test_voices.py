"""Voice analysis (second who-said-what layer) with synthetic voice fingerprints."""

import copy

import numpy as np
import pytest
from conftest import LINES, fake_segments, upload, wait_ready

from app.pipeline import voices


def _audio(seconds: float = 25.0) -> np.ndarray:
    return np.zeros(int(seconds * 16000), dtype=np.float32)


def _truth(w: dict) -> str:
    mid = (w["start"] + w["end"]) / 2
    return next(line[3] for line in LINES if line[0] - 0.2 <= mid <= line[1] + 0.2)


def _accuracy(segments) -> float:
    words = [w for s in segments for w in s["words"]]
    same = sum(w["speaker"] == _truth(w) for w in words)
    swapped = sum(w["speaker"] != _truth(w) for w in words)
    return max(same, swapped) / len(words)


def test_voices_decide_speakers_without_diarization(fake_voices):
    out, report = voices.check_speakers(_audio(), fake_segments(), diarized=False, progress=lambda p: None)
    assert report["used"] is True
    assert _accuracy(out) == 1.0
    assert all(w["spk_conf"] is not None for s in out for w in s["words"])


def test_voices_correct_a_diarization_mistake(fake_voices):
    segs = fake_segments()
    for seg, line in zip(segs, LINES):
        for w in seg["words"]:
            w["speaker"] = line[3]
    wrong = segs[1]["words"][len(segs[1]["words"]) // 2 :]
    for w in wrong:  # pyannote gave the second half of the client's first answer to the counsellor
        w["speaker"] = "SPEAKER_00"
    # the rest is right, so the layers mostly agree
    out, report = voices.check_speakers(_audio(), segs, diarized=True, progress=lambda p: None)
    assert report["corrected"] >= 1
    assert all(w["speaker"] == "SPEAKER_01" for w in out[1]["words"])
    assert _accuracy(out) == 1.0


def test_broad_disagreement_keeps_pyannote(fake_voices):
    segs = fake_segments()
    for seg in segs:  # pyannote says one speaker for everything but the last answer
        for w in seg["words"]:
            w["speaker"] = "SPEAKER_00"
    for w in segs[3]["words"]:
        w["speaker"] = "SPEAKER_01"
    original = copy.deepcopy(segs)
    out, report = voices.check_speakers(_audio(), segs, diarized=True, progress=lambda p: None)
    assert report["used"] is False and "kept" in report["reason"]
    assert [w["speaker"] for s in out for w in s["words"]] == [w["speaker"] for s in original for w in s["words"]]


def test_voiceprint_picks_the_counsellor(fake_voices):
    base = fake_voices
    voices.save_voiceprint(base["SPEAKER_00"] / np.linalg.norm(base["SPEAKER_00"]), 20, "test")
    try:
        _, report = voices.check_speakers(_audio(), fake_segments(), diarized=False, progress=lambda p: None)
        assert report["counsellor_label"] == "SPEAKER_00"
        voices.save_voiceprint(base["SPEAKER_01"] / np.linalg.norm(base["SPEAKER_01"]), 20, "test")
        _, report = voices.check_speakers(_audio(), fake_segments(), diarized=False, progress=lambda p: None)
        assert report["counsellor_label"] == "SPEAKER_01"  # whoever speaks first is not assumed
    finally:
        voices.delete_voiceprint()


def test_smoothing_ignores_a_single_odd_word():
    scores = np.array([[0.9, 0.1]] * 5 + [[0.4, 0.5]] + [[0.9, 0.1]] * 5)
    gaps = np.zeros(len(scores))
    assert list(voices.smooth(scores, gaps)) == [0] * 11
    scores = np.array([[0.9, 0.1]] * 5 + [[0.1, 0.9]] * 5)
    gaps[5] = 0.6  # a real change of speaker after a pause
    assert list(voices.smooth(scores, gaps)) == [0] * 5 + [1] * 5


def test_two_voices_ignores_a_few_odd_windows():
    rng = np.random.default_rng(1)
    a, b = rng.normal(size=16), rng.normal(size=16)
    rows = [a + rng.normal(scale=0.3, size=16) for _ in range(40)]
    rows += [b + rng.normal(scale=0.3, size=16) for _ in range(30)]
    rows += [rng.normal(size=16) * 3 for _ in range(4)]  # odd windows (coughs, turn edges)
    m = np.array(rows)
    m /= np.linalg.norm(m, axis=1, keepdims=True)
    labels, _ = voices.two_voices(m)
    assert len(set(labels[:40])) == 1 and len(set(labels[40:70])) == 1 and labels[0] != labels[40]


def test_pipeline_stores_voice_check_and_confidence(client, fake_engines, fake_voices, monkeypatch):
    from app import jobs
    from app.pipeline.diarize import diarize

    monkeypatch.setattr(jobs, "diarize", diarize)  # no HF token: voices decide
    detail = wait_ready(client, upload(client)["id"])
    assert detail["status"] == "ready", detail["error"]
    assert detail["voice_check"]["used"] is True
    assert "voice analysis only" in detail["warning"]
    assert [t["role"] for t in detail["turns"]] == ["counsellor", "client", "counsellor", "client"]
    assert all(t["speaker_confidence"] is not None for t in detail["turns"])

    turn = detail["turns"][1]
    updated = client.patch(f"/api/turns/{turn['id']}", json={"role": "counsellor"}).json()
    assert updated["turns"][1]["speaker_confidence"] == 1.0  # confirmed by the counsellor


def test_voiceprint_api(client, monkeypatch):
    calls = {}

    def fake_from_audio(samples, spans=None):
        calls["spans"] = spans
        return np.ones(16, dtype=np.float32) / 4, 20.0

    monkeypatch.setattr(voices, "voiceprint_from_audio", fake_from_audio)
    assert client.get("/api/voice").json() == {"enrolled": False}
    from conftest import SAMPLE

    with open(SAMPLE, "rb") as f:
        resp = client.post("/api/voice/enroll", files={"file": ("me.wav", f, "audio/wav")})
    info = resp.json()
    assert resp.status_code == 200, info
    assert info["enrolled"] is True and info["source"] == "recording"
    stored = list(voices.settings.data_path.glob("voiceprint.json*"))
    assert [p.name for p in stored] == ["voiceprint.json.enc"]  # encrypted at rest
    assert b"embedding" not in stored[0].read_bytes()
    assert client.delete("/api/voice").json() == {"enrolled": False}


def test_learn_voice_from_session(client, fake_engines, monkeypatch):
    seen = {}

    def fake_from_audio(samples, spans=None):
        seen["spans"] = spans
        return np.ones(16, dtype=np.float32) / 4, 9.0

    monkeypatch.setattr(voices, "voiceprint_from_audio", fake_from_audio)
    sid = wait_ready(client, upload(client)["id"])["id"]
    info = client.post(f"/api/voice/learn/{sid}").json()
    assert info["enrolled"] is True and "C-014" in info["source"]
    assert len(seen["spans"]) == 2  # only the counsellor's turns
    client.delete("/api/voice")


@pytest.mark.parametrize("too_alike", [True])
def test_same_voice_twice_is_not_split(monkeypatch, too_alike):
    from conftest import fake_window_fingerprints

    lines = [(s, e, t, "SPEAKER_00", low) for s, e, t, _spk, low in LINES]  # one person only
    fingerprints, _ = fake_window_fingerprints(lines)
    monkeypatch.setattr(voices, "window_fingerprints", fingerprints)
    out, report = voices.check_speakers(_audio(), fake_segments(), diarized=False, progress=lambda p: None)
    assert report["used"] is False and "alike" in report["reason"]
