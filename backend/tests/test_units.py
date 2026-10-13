"""Unit tests: turn building, pauses, exchanges, role heuristic, hallucination filter, storage, JSON parsing."""

import pytest
from pydantic import BaseModel

from app import storage
from app.ai.llm import LLMError, chat_json, extract_json
from app.models import Role, Turn
from app.pipeline.roles import heuristic, is_question
from app.pipeline.transcribe import clean_segments
from app.pipeline.turns import build_turns, group_exchanges


def seg(start, end, text, speaker=None):
    tokens = text.split()
    step = (end - start) / len(tokens)
    words = [{"word": w, "start": start + i * step, "end": start + (i + 1) * step, "score": 0.9,
              **({"speaker": speaker} if speaker else {})} for i, w in enumerate(tokens)]
    return {"start": start, "end": end, "text": text, "words": words, **({"speaker": speaker} if speaker else {})}


def test_build_turns_merges_same_speaker_and_marks_pauses():
    turns = build_turns([
        seg(0, 2, "How are you?", "SPEAKER_00"),
        seg(2.5, 4, "Fine, I guess.", "SPEAKER_01"),
        seg(8.6, 10, "Well, actually not.", "SPEAKER_01"),
        seg(10.2, 11, "Tell me more.", "SPEAKER_00"),
    ])
    assert [t["speaker_raw"] for t in turns] == ["SPEAKER_00", "SPEAKER_01", "SPEAKER_00"]
    assert turns[1]["text"] == "Fine, I guess. [pause 5s] Well, actually not."
    assert len(turns[1]["words"]) == 6  # pause markers are not words
    assert turns[1]["start"] == 2.5 and turns[1]["end"] == 10


def test_build_turns_splits_mid_segment_on_word_speakers():
    s = seg(0, 4, "Is that okay? Yes it is.")
    for i, w in enumerate(s["words"]):
        w["speaker"] = "SPEAKER_00" if i < 3 else "SPEAKER_01"
    turns = build_turns([s])
    assert [t["text"] for t in turns] == ["Is that okay?", "Yes it is."]


def test_split_every_segment_when_no_speakers():
    turns = build_turns([seg(0, 1, "Hello there."), seg(1.2, 2, "Hi.")], split_every_segment=True)
    assert len(turns) == 2


def _turn(i, role):
    return Turn(id=i, session_id=1, index=i, speaker_raw="S", role=role, start=i, end=i + 1, text="x")


def test_group_exchanges():
    c, k = Role.counsellor, Role.client
    turns = [_turn(1, k), _turn(2, c), _turn(3, k), _turn(4, k), _turn(5, c), _turn(6, c), _turn(7, k), _turn(8, c)]
    assert group_exchanges(turns) == [([], [1]), ([2], [3, 4]), ([5, 6], [7]), ([8], [])]


def test_role_heuristic():
    assert is_question("[pause 3s] how did that feel")
    assert is_question("Can you say more?")
    assert not is_question("I felt awful.")
    turns = [
        {"speaker_raw": "SPEAKER_01", "text": "What brings you here?"},
        {"speaker_raw": "SPEAKER_00", "text": "My job, mostly."},
        {"speaker_raw": "SPEAKER_01", "text": "How long has that been going on?"},
        {"speaker_raw": "SPEAKER_00", "text": "A year."},
    ]
    speaker, margin = heuristic(turns)
    assert speaker == "SPEAKER_01" and margin > 0.5


def test_hallucinations_dropped_only_when_unsure():
    noise = {"start": 0, "end": 2, "text": " Thank you for watching!", "words": [{"word": "Thank", "start": 0, "end": 1, "score": 0.1}]}
    real = {"start": 3, "end": 4, "text": "Thank you.", "words": [{"word": "Thank", "start": 3, "end": 3.5, "score": 0.95}, {"word": "you.", "start": 3.5, "end": 4, "score": 0.9}]}
    unaligned = {"start": 5, "end": 7, "text": "ಹೇಗಿದ್ದೀರಾ ನೀವು"}
    out = clean_segments([noise, real, unaligned])
    assert [s["text"] for s in out] == ["Thank you.", "ಹೇಗಿದ್ದೀರಾ ನೀವು"]
    assert len(out[1]["words"]) == 2 and out[1]["words"][0]["score"] is None


def test_encrypted_storage_ranges(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "BLOCK", 1000)
    data = bytes(range(256)) * 20  # 5120 bytes → 6 blocks
    path = tmp_path / "x.wav.enc"
    with storage.AudioWriter(path) as w:
        for i in range(0, len(data), 333):
            w.write(data[i : i + 333])
    assert storage.read_bytes(path) == data
    assert storage.plain_size(path) == len(data)
    assert b"".join(storage.read_range(path, 995, 3004)) == data[995:3005]
    assert b"".join(storage.read_range(path, 5119, 5119)) == data[5119:]


class Thing(BaseModel):
    name: str


def test_extract_json_tolerates_fences_and_chatter():
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Here you go: {"a": {"b": 2}} hope it helps') == {"a": {"b": 2}}
    with pytest.raises(ValueError):
        extract_json("no json")


def test_chat_json_retries_once(monkeypatch):
    from app.ai import llm

    replies = iter(["oops", '{"name": "ok"}'])
    monkeypatch.setattr(llm, "complete", lambda m: next(replies))
    assert chat_json("s", "u", Thing).name == "ok"
    replies2 = iter(["oops", "still bad"])
    monkeypatch.setattr(llm, "complete", lambda m: next(replies2))
    with pytest.raises(LLMError):
        chat_json("s", "u", Thing)


def test_fallback_speaker_guess_keeps_reflection_with_question():
    from app.pipeline.roles import guess_speakers_without_diarization

    segments = [
        {"start": 0.0, "end": 2.0, "text": "Hello, thanks for coming in today."},
        {"start": 2.3, "end": 4.0, "text": "How have you been feeling this week?"},
        {"start": 5.0, "end": 8.0, "text": "Honestly, it has been hard."},
        {"start": 11.0, "end": 12.0, "text": "That sounds really tiring."},
        {"start": 12.2, "end": 14.0, "text": "What goes through your mind at night?"},
        {"start": 15.0, "end": 17.0, "text": "Mostly that I will fail."},
    ]
    assert guess_speakers_without_diarization(segments) == [
        "SPEAKER_00", "SPEAKER_00", "SPEAKER_01", "SPEAKER_00", "SPEAKER_00", "SPEAKER_01",
    ]


def test_filler_prompt_matches_language():
    # An English prompt on Kannada audio made Whisper return only "Hmm." (found with real audio).
    from app.pipeline.transcribe import prompt_for

    assert prompt_for("en").startswith("Umm")
    assert prompt_for("kn") and not any("a" <= c.lower() <= "z" for c in prompt_for("kn"))
    assert prompt_for("hi") and not any("a" <= c.lower() <= "z" for c in prompt_for("hi"))
    assert prompt_for("ta") is None and prompt_for(None) is None


def test_summary_drops_non_risks():
    from app.ai.insights import SessionSummary

    s = SessionSummary(overview="x", risk_flags=[
        "No immediate risk, but ongoing stress could be concerning", "None", "",
        "Client mentioned thoughts of self-harm last week",
    ])
    assert s.risk_flags == ["Client mentioned thoughts of self-harm last week"]
