"""Counsellor vs client detection: question heuristic first, LLM fallback when the score is close."""

from __future__ import annotations

import logging
import re

from .turns import plain_text

log = logging.getLogger("verbatim.roles")

QUESTION_START = re.compile(
    r"^(what|how|why|can you|could you|would you|tell me|do you|did you|are you|have you|"
    r"is there|is it|when|where|who|which)\b",
    re.IGNORECASE,
)
CLOSE_MARGIN = 0.25  # below this relative difference, ask the LLM


def is_question(text: str) -> bool:
    t = plain_text(text)
    return t.endswith("?") or bool(QUESTION_START.match(t))


def heuristic(turns: list[dict]) -> tuple[str, float]:
    """Returns (likely counsellor speaker, margin 0–1). turns: [{speaker_raw, text}] in order."""
    speakers: list[str] = []
    for t in turns:
        if t["speaker_raw"] not in speakers:
            speakers.append(t["speaker_raw"])
    if len(speakers) < 2:
        return (speakers[0] if speakers else "SPEAKER_00"), 1.0
    scores = {s: 0.0 for s in speakers}
    for t in turns:
        if is_question(t["text"]):
            scores[t["speaker_raw"]] += 1
    scores[speakers[0]] += 1  # whoever speaks first is usually the counsellor
    a, b = speakers[0], speakers[1]
    best = a if scores[a] >= scores[b] else b
    margin = abs(scores[a] - scores[b]) / max(1.0, scores[a] + scores[b])
    return best, margin


def detect_counsellor(turns: list[dict]) -> tuple[str, str]:
    """Returns (counsellor speaker label, how it was decided)."""
    guess, margin = heuristic(turns)
    if margin >= CLOSE_MARGIN:
        return guess, "question heuristic"
    try:
        from ..ai.insights import label_speakers

        speaker = label_speakers(turns[:20])
        if speaker in {t["speaker_raw"] for t in turns}:
            return speaker, "AI"
    except Exception as exc:  # LLM not running etc. — the heuristic is still a fair guess
        log.warning("Role detection LLM fallback failed: %s", exc)
    return guess, "question heuristic (close call)"
