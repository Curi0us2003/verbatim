"""TXT / DOCX / PDF export of the verbatim transcript with insights.

Layout follows the privacy rules: AI text is always labelled as an interpretation, and the
counsellor's own notes and agree/disagree feedback are kept in a separate section.
PDF is produced by the browser's print dialog ("Save as PDF") from a print-ready page, which
renders Hindi and Kannada text correctly without extra font or GTK installs.
"""

from __future__ import annotations

import html
import io
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlmodel import Session as DBSession
from sqlmodel import select

from .models import Exchange, Role, Session, Summary, Turn

AI_LABEL = "AI interpretation — not a clinical judgement"
LANG = {"auto": "Auto-detect", "en": "English", "hi": "Hindi", "kn": "Kannada"}
SUMMARY_FIELDS = [
    ("main_themes", "Main themes"),
    ("client_goals", "Client's stated goals"),
    ("key_concerns", "Key concerns"),
    ("emotional_shifts", "Emotional shifts"),
    ("strengths_noticed", "Strengths noticed"),
    ("topics_for_next_session", "Topics for next session"),
    ("risk_flags", "Possible risk mentioned"),
]


@dataclass
class Record:
    session: Session
    turns: list[Turn]
    exchanges: list[Exchange]
    summary: Summary | None

    @property
    def turn_by_id(self) -> dict[int, Turn]:
        return {t.id: t for t in self.turns}


def load(db: DBSession, session: Session) -> Record:
    turns = list(db.exec(select(Turn).where(Turn.session_id == session.id).order_by(Turn.index)).all())
    exchanges = list(db.exec(select(Exchange).where(Exchange.session_id == session.id).order_by(Exchange.index)).all())
    return Record(session, turns, exchanges, db.get(Summary, session.id))


def ts(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"


def _date(value: datetime | None) -> str:
    if value is None:
        return "—"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone().strftime("%d %b %Y, %H:%M")


def _meta(r: Record) -> list[tuple[str, str]]:
    s = r.session
    duration = f"{round((s.duration_sec or 0) / 60)} min" if s.duration_sec else "—"
    return [
        ("Title", s.title),
        ("Client code", s.client_code),
        ("Date", _date(s.created_at)),
        ("Duration", duration),
        ("Language", LANG.get(s.detected_language or s.language, s.detected_language or s.language)),
        ("Consent recorded", _date(s.consent_at)),
    ]


def _role(t: Turn) -> str:
    return "Counsellor" if t.role == Role.counsellor else "Client"


def _exchange_start(r: Record, ex: Exchange) -> float:
    ids = ex.counsellor_turn_ids + ex.client_turn_ids
    starts = [r.turn_by_id[i].start for i in ids if i in r.turn_by_id]
    return min(starts) if starts else 0.0


def _insight_lines(ins: dict) -> list[tuple[str, str]]:
    if "client_meaning" not in ins:
        return [("", "Insight unavailable")]
    rows = [("What the client seems to mean", ins["client_meaning"])]
    if ins.get("evidence"):
        rows.append(("Evidence", "; ".join(f"“{q}”" for q in ins["evidence"])))
    if ins.get("emotions"):
        rows.append(("Emotions", ", ".join(ins["emotions"])))
    if ins.get("underlying_need"):
        rows.append(("Possible underlying need", ins["underlying_need"]))
    rows.append(("Confidence", ins.get("confidence", "—")))
    if ins.get("suggested_follow_up"):
        rows.append(("Suggested follow-up", ins["suggested_follow_up"]))
    if ins.get("risk_flag"):
        rows.append(("RISK FLAG", ins.get("risk_note") or "Possible risk mentioned — please review."))
    return rows


def _notes(r: Record) -> list[tuple[str, str, str]]:
    out = []
    for i, ex in enumerate(r.exchanges):
        if ex.counsellor_feedback or ex.counsellor_note:
            fb = {"agree": "Agrees with AI reading", "disagree": "Disagrees with AI reading"}.get(
                ex.counsellor_feedback.value if ex.counsellor_feedback else "", "—"
            )
            out.append((f"Exchange {i + 1} ({ts(_exchange_start(r, ex))})", fb, ex.counsellor_note or ""))
    return out


# ---------------------------------------------------------------------------
# TXT
# ---------------------------------------------------------------------------


def to_txt(r: Record) -> str:
    lines = ["VERBATIM SESSION RECORD — CONFIDENTIAL", ""]
    lines += [f"{k}: {v}" for k, v in _meta(r)]
    lines += ["", "=" * 60, "VERBATIM TRANSCRIPT", "=" * 60, ""]
    for t in r.turns:
        lines.append(f"[{ts(t.start)}] {_role(t)}: “{t.text}”")
        lines.append("")
    if any(ex.insight_json for ex in r.exchanges) or r.summary:
        lines += ["=" * 60, f"AI INTERPRETATIONS ({AI_LABEL})", "=" * 60, ""]
        for i, ex in enumerate(r.exchanges):
            if not ex.insight_json:
                continue
            lines.append(f"Exchange {i + 1} ({ts(_exchange_start(r, ex))})")
            lines += [f"  {k}: {v}" if k else f"  {v}" for k, v in _insight_lines(ex.insight_json)]
            lines.append("")
        if r.summary:
            sj = r.summary.summary_json
            lines += ["SESSION SUMMARY (AI interpretation)", f"  {sj.get('overview', '')}", ""]
            for key, label in SUMMARY_FIELDS:
                if sj.get(key):
                    lines.append(f"  {label}:")
                    lines += [f"    - {item}" for item in sj[key]]
            lines.append("")
    notes = _notes(r)
    if notes:
        lines += ["=" * 60, "COUNSELLOR'S OWN NOTES AND FEEDBACK", "=" * 60, ""]
        for where, fb, note in notes:
            lines.append(f"{where}: {fb}")
            if note:
                lines.append(f"  Note: {note}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# DOCX
# ---------------------------------------------------------------------------


def to_docx(r: Record) -> bytes:
    from docx import Document
    from docx.shared import Pt, RGBColor

    blue, amber, grey, red = RGBColor(0x2C, 0x5A, 0x8C), RGBColor(0x8A, 0x5A, 0x17), RGBColor(0x56, 0x61, 0x6C), RGBColor(0xC2, 0x50, 0x4A)
    doc = Document()
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = Pt(11)
    doc.add_heading(r.session.title, level=0)
    p = doc.add_paragraph()
    run = p.add_run("Confidential counselling record")
    run.italic = True
    run.font.color.rgb = grey
    table = doc.add_table(rows=0, cols=2)
    for k, v in _meta(r):
        row = table.add_row().cells
        row[0].text, row[1].text = k, v

    doc.add_heading("Verbatim transcript", level=1)
    for t in r.turns:
        para = doc.add_paragraph()
        label = para.add_run(f"{_role(t)}  {ts(t.start)}\n")
        label.bold = True
        label.font.size = Pt(9)
        label.font.color.rgb = blue if t.role == Role.counsellor else amber
        para.add_run(f"“{t.text}”")

    if any(ex.insight_json for ex in r.exchanges) or r.summary:
        doc.add_heading("AI interpretations", level=1)
        note = doc.add_paragraph().add_run(AI_LABEL)
        note.italic = True
        note.font.color.rgb = grey
        for i, ex in enumerate(r.exchanges):
            if not ex.insight_json:
                continue
            doc.add_heading(f"Exchange {i + 1} ({ts(_exchange_start(r, ex))})", level=3)
            for k, v in _insight_lines(ex.insight_json):
                para = doc.add_paragraph(style="List Bullet")
                if k:
                    head = para.add_run(f"{k}: ")
                    head.bold = True
                    if k == "RISK FLAG":
                        head.font.color.rgb = red
                para.add_run(v)
        if r.summary:
            sj = r.summary.summary_json
            doc.add_heading("Session summary (AI interpretation)", level=2)
            doc.add_paragraph(sj.get("overview", ""))
            for key, label in SUMMARY_FIELDS:
                if sj.get(key):
                    doc.add_paragraph().add_run(label).bold = True
                    for item in sj[key]:
                        doc.add_paragraph(item, style="List Bullet")

    notes = _notes(r)
    if notes:
        doc.add_heading("Counsellor's own notes and feedback", level=1)
        for where, fb, text in notes:
            para = doc.add_paragraph()
            para.add_run(f"{where}: ").bold = True
            para.add_run(fb)
            if text:
                para.add_run(f"\n{text}")

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Print page (→ PDF via the browser)
# ---------------------------------------------------------------------------


def to_print_html(r: Record) -> str:
    e = html.escape
    meta = "".join(f"<tr><th>{e(k)}</th><td>{e(v)}</td></tr>" for k, v in _meta(r))
    turns = "".join(
        f'<div class="turn {t.role.value}"><div class="label">{_role(t)} · {ts(t.start)}</div>'
        f"<div>“{e(t.text)}”</div></div>"
        for t in r.turns
    )
    insights = ""
    if any(ex.insight_json for ex in r.exchanges):
        blocks = []
        for i, ex in enumerate(r.exchanges):
            if not ex.insight_json:
                continue
            rows = "".join(
                f'<li class="{"risk" if k == "RISK FLAG" else ""}">' + (f"<b>{e(k)}:</b> " if k else "") + f"{e(v)}</li>"
                for k, v in _insight_lines(ex.insight_json)
            )
            blocks.append(f"<h3>Exchange {i + 1} ({ts(_exchange_start(r, ex))})</h3><ul>{rows}</ul>")
        insights = f'<h2>AI interpretations</h2><p class="ai">{AI_LABEL}</p>' + "".join(blocks)
    summary = ""
    if r.summary:
        sj = r.summary.summary_json
        parts = [f"<p>{e(sj.get('overview', ''))}</p>"]
        for key, label in SUMMARY_FIELDS:
            if sj.get(key):
                parts.append(f"<h4>{e(label)}</h4><ul>" + "".join(f"<li>{e(x)}</li>" for x in sj[key]) + "</ul>")
        summary = f'<h2>Session summary</h2><p class="ai">{AI_LABEL}</p>' + "".join(parts)
    notes = _notes(r)
    notes_html = ""
    if notes:
        notes_html = "<h2>Counsellor's own notes and feedback</h2>" + "".join(
            f"<p><b>{e(w)}:</b> {e(fb)}" + (f"<br>{e(n)}" if n else "") + "</p>" for w, fb, n in notes
        )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{e(r.session.title)} — {e(r.session.client_code)}</title>
<style>
  body {{ font-family: "Inter", "Nirmala UI", "Noto Sans", system-ui, sans-serif; color: #1F2933; max-width: 760px; margin: 32px auto; padding: 0 16px; line-height: 1.55; }}
  h1 {{ margin-bottom: 0; }} .conf {{ color: #56616C; font-style: italic; margin-top: 4px; }}
  table {{ border-collapse: collapse; margin: 16px 0 24px; }} th {{ text-align: left; padding: 2px 16px 2px 0; color: #56616C; font-weight: 500; }}
  .turn {{ border: 1px solid; border-radius: 12px; padding: 8px 14px; margin: 8px 0; break-inside: avoid; }}
  .turn.counsellor {{ background: #E8F0FB; border-color: #6B9BD2; margin-right: 12%; }}
  .turn.client {{ background: #FDF3E3; border-color: #D9A55B; margin-left: 12%; }}
  .label {{ font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #56616C; }}
  .ai {{ color: #56616C; font-style: italic; }} .risk {{ color: #C2504A; font-weight: 600; }}
  h2 {{ margin-top: 32px; border-bottom: 1px solid #E5E0D8; padding-bottom: 4px; }} h3 {{ margin-bottom: 4px; }}
  .bar {{ background: #FAF8F5; border: 1px solid #E5E0D8; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; }}
  @media print {{ .bar {{ display: none; }} body {{ margin: 0; }} .turn {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }} }}
</style></head><body>
<div class="bar">Choose <b>Save as PDF</b> in the print dialog to create a PDF. <button onclick="print()">Print / Save as PDF</button></div>
<h1>{e(r.session.title)}</h1><p class="conf">Confidential counselling record</p>
<table>{meta}</table>
<h2>Verbatim transcript</h2>{turns}{insights}{summary}{notes_html}
<script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body></html>"""
