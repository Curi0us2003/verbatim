"""Merge same-speaker segments into Turns, add [pause Ns] markers, group Turns into Exchanges."""

from __future__ import annotations

import re
from collections.abc import Sequence

from sqlmodel import Session as DBSession
from sqlmodel import delete, select

from ..models import Exchange, Role, Turn

PAUSE_MIN_SEC = 2.0  # F1: pauses longer than this are marked inline
PAUSE_RE = re.compile(r"\[pause \d+s\]")


def build_turns(segments: list[dict], split_every_segment: bool = False) -> list[dict]:
    """Segments (with speaker labels) → turns: {speaker_raw, start, end, text, words}.

    Consecutive words from the same speaker are merged into one turn. A gap of more than
    2 seconds between words becomes an inline "[pause Ns]" marker; a long silence before a
    reply is placed at the start of that reply. With `split_every_segment` (used when speaker
    separation was unavailable) every segment becomes its own turn.
    """
    turns: list[dict] = []
    prev_end: float | None = None
    for seg_no, seg in enumerate(segments):
        seg_speaker = seg.get("speaker") or "SPEAKER_00"
        for word_no, w in enumerate(seg.get("words") or []):
            speaker = w.get("speaker") or seg_speaker
            start = w.get("start")
            new_segment = split_every_segment and word_no == 0
            if turns and turns[-1]["speaker_raw"] == speaker and not new_segment:
                turn = turns[-1]
            else:
                begin = start if start is not None else (prev_end if prev_end is not None else seg["start"])
                turn = {"speaker_raw": speaker, "start": begin, "end": begin, "tokens": [], "words": [],
                        "segment": seg_no, "confs": []}
                turns.append(turn)
            if start is not None and prev_end is not None and start - prev_end > PAUSE_MIN_SEC:
                turn["tokens"].append(f"[pause {round(start - prev_end)}s]")
            turn["tokens"].append(w["word"])
            turn["words"].append({k: w.get(k) for k in ("word", "start", "end", "score")})
            if w.get("spk_conf") is not None:
                turn["confs"].append(w["spk_conf"])
            end = w.get("end") if w.get("end") is not None else start
            if end is not None:
                prev_end = end
                turn["end"] = max(turn["end"], end)
    return [
        {
            "speaker_raw": t["speaker_raw"],
            "start": round(float(t["start"]), 3),
            "end": round(float(max(t["end"], t["start"])), 3),
            "text": " ".join(t["tokens"]),
            "words": t["words"],
            # the least certain stretch decides: one doubtful part is enough to ask the counsellor
            "speaker_confidence": min(t["confs"]) if t["confs"] else None,
        }
        for t in turns
        if t["words"]
    ]


def group_exchanges(turns: Sequence[Turn]) -> list[tuple[list[int], list[int]]]:
    """One counsellor turn (or several in a row) followed by the client's reply."""
    groups: list[tuple[list[int], list[int]]] = []
    current: tuple[list[int], list[int]] | None = None
    for t in turns:
        if t.role == Role.counsellor:
            if current is None or current[1]:
                current = ([], [])
                groups.append(current)
            current[0].append(t.id)
        else:
            if current is None:
                current = ([], [])
                groups.append(current)
            current[1].append(t.id)
    return groups


def session_turns(db: DBSession, session_id: int) -> list[Turn]:
    return list(db.exec(select(Turn).where(Turn.session_id == session_id).order_by(Turn.index)).all())


def rebuild_exchanges(db: DBSession, session_id: int) -> None:
    """Regroup exchanges after turns or roles change, keeping insights for unchanged exchanges."""
    old = db.exec(select(Exchange).where(Exchange.session_id == session_id)).all()
    keep = {(tuple(e.counsellor_turn_ids), tuple(e.client_turn_ids)): e for e in old}
    groups = group_exchanges(session_turns(db, session_id))
    db.exec(delete(Exchange).where(Exchange.session_id == session_id))
    for index, (c_ids, k_ids) in enumerate(groups):
        prev = keep.get((tuple(c_ids), tuple(k_ids)))
        db.add(Exchange(
            session_id=session_id,
            index=index,
            counsellor_turn_ids=c_ids,
            client_turn_ids=k_ids,
            insight_json=prev.insight_json if prev else None,
            counsellor_feedback=prev.counsellor_feedback if prev else None,
            counsellor_note=prev.counsellor_note if prev else None,
        ))
    db.commit()


def reindex(db: DBSession, session_id: int) -> None:
    for i, t in enumerate(session_turns(db, session_id)):
        t.index = i
        db.add(t)
    db.commit()


def plain_text(text: str) -> str:
    """Turn text without pause markers (for prompts, search and role heuristics)."""
    return re.sub(r"\s+", " ", PAUSE_RE.sub(" ", text)).strip()
