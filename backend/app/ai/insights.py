"""Generate per-exchange insights, the session summary, and the LLM fallback for role detection."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, field_validator
from sqlmodel import Session as DBSession
from sqlmodel import select

from ..config import settings
from ..models import Exchange, Role, Summary, Turn, engine, utcnow
from ..pipeline.turns import plain_text
from . import prompts
from .llm import LLMError, chat_json

log = logging.getLogger("verbatim.insights")

UNAVAILABLE = "Insight unavailable"


class RoleLabel(BaseModel):
    counsellor: str
    confidence: float = 0.5
    reason: str = ""


class Insight(BaseModel):
    client_meaning: str
    evidence: list[str] = []
    emotions: list[str] = []
    underlying_need: str = ""
    confidence: Literal["low", "medium", "high"] = "low"
    suggested_follow_up: str = ""
    risk_flag: bool = False
    risk_note: str = ""

    @field_validator("confidence", mode="before")
    @classmethod
    def _lower(cls, v):
        return str(v).strip().lower() if v is not None else "low"


class SessionSummary(BaseModel):
    overview: str
    main_themes: list[str] = []
    client_goals: list[str] = []
    key_concerns: list[str] = []
    emotional_shifts: list[str] = []
    strengths_noticed: list[str] = []
    topics_for_next_session: list[str] = []
    risk_flags: list[str] = []


def label_speakers(turns: list[dict]) -> str:
    return chat_json(prompts.ROLE_SYSTEM, prompts.role_user(turns), RoleLabel).counsellor.strip().upper()


def _is_setup_problem(exc: Exception) -> bool:
    text = str(exc)
    return any(s in text for s in ("not running", "not downloaded", "API_KEY", "Could not reach"))


def _max_input_chars() -> int:
    # Rough budget: ~3 characters per token, leaving room for the prompt and the answer.
    if settings.llm_engine == "groq":
        return 24000
    return max(4000, settings.ollama_num_ctx * 2)


def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


def generate_for_session(session_id: int, progress: Callable[[float], None], only_missing: bool = False) -> str | None:
    """Fill insight_json on every exchange, then write the Summary. Returns a warning, if any."""
    with DBSession(engine) as db:
        turns = {t.id: t for t in db.exec(select(Turn).where(Turn.session_id == session_id)).all()}
        exchanges = list(db.exec(select(Exchange).where(Exchange.session_id == session_id).order_by(Exchange.index)).all())

        def texts(ids: list[int]) -> str:
            return " ".join(plain_text(turns[i].text) for i in ids if i in turns)

        pairs = [(texts(e.counsellor_turn_ids), texts(e.client_turn_ids)) for e in exchanges]
        failures = 0
        todo = [e for e in exchanges if e.client_turn_ids and not (only_missing and e.insight_json and "client_meaning" in e.insight_json)]
        for n, ex in enumerate(todo):
            i = exchanges.index(ex)
            question, answer = pairs[i]
            context = [(_clip(q, 500), _clip(a, 700)) for q, a in pairs[max(0, i - 2) : i]]
            user = prompts.insight_user(
                context, question or "(no question: the client spoke first)", _clip(answer, 4000)
            )
            try:
                ex.insight_json = chat_json(prompts.INSIGHT_SYSTEM, user, Insight).model_dump()
            except LLMError as exc:
                if n == 0 and _is_setup_problem(exc):
                    raise  # e.g. Ollama not installed: stop now with one clear message
                failures += 1
                ex.insight_json = {"unavailable": True, "error": UNAVAILABLE, "detail": str(exc)[:300]}
            db.add(ex)
            db.commit()
            progress((n + 1) / max(1, len(todo) + 1) * 100)

        # Session summary: whole transcript if it fits, otherwise the (much shorter) insights.
        ordered = sorted(turns.values(), key=lambda t: t.index)
        lines = [
            f'{"Counsellor" if t.role == Role.counsellor else "Client"}: {plain_text(t.text)}' for t in ordered
        ]
        user = prompts.summary_user_transcript(lines)
        if len(user) > _max_input_chars():
            items = []
            for i, ex in enumerate(exchanges):
                ins = ex.insight_json or {}
                if "client_meaning" in ins:
                    items.append(
                        f'{i + 1}. Counsellor asked: "{_clip(pairs[i][0], 160)}" | Client seems to mean: '
                        f'{ins["client_meaning"]} | Emotions: {", ".join(ins.get("emotions", []))}'
                        + (f' | RISK: {ins.get("risk_note")}' if ins.get("risk_flag") else "")
                    )
            user = _clip(prompts.summary_user_insights(items), _max_input_chars())
        warning = None
        try:
            summary = chat_json(prompts.SUMMARY_SYSTEM, user, SessionSummary)
            existing = db.get(Summary, session_id)
            row = existing or Summary(session_id=session_id, model_used="")
            row.summary_json = summary.model_dump()
            row.model_used = f"{settings.llm_engine}:{settings.llm_model_name}"
            row.created_at = utcnow()
            db.add(row)
            db.commit()
        except LLMError as exc:
            warning = f"The session summary could not be generated: {exc}"
        if failures:
            warning = (warning + " " if warning else "") + f"{failures} insight(s) were unavailable."
        progress(100)
        return warning
