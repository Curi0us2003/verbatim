"""End-to-end pipeline with fake speech engines: upload/record → turns → roles → exchanges → edits."""

from datetime import datetime
from pathlib import Path

from conftest import SAMPLE, upload, wait_ready

from app.config import settings


def test_upload_runs_full_pipeline(client, fake_engines):
    created = upload(client, noise_reduction="strong")
    assert created["status"] == "converting"
    assert created["noise_reduction"] == "strong"
    detail = wait_ready(client, created["id"])
    assert detail["status"] == "ready", detail["error"]
    assert detail["counsellor_speaker"] == "SPEAKER_00"
    assert detail["duration_sec"] > 20
    roles = [t["role"] for t in detail["turns"]]
    assert roles == ["counsellor", "client", "counsellor", "client"]
    # 3.2 s of silence before the counsellor's second question → inline pause marker
    assert detail["turns"][2]["text"].startswith("[pause 3s] ")
    assert detail["turns"][1]["words_json"][9]["score"] == 0.3
    assert len(detail["exchanges"]) == 2
    assert detail["exchanges"][0]["client_turn_ids"] == [detail["turns"][1]["id"]]


def test_audio_is_encrypted_and_streams_with_ranges(client, fake_engines):
    sid = upload(client)["id"]
    wait_ready(client, sid)
    folder = settings.audio_dir / str(sid)
    names = sorted(p.name for p in folder.iterdir())
    assert names == ["audio.wav.enc", "original.wav.enc"]
    assert not (folder / "audio.wav.enc").read_bytes().startswith(b"RIFF")

    full = client.get(f"/api/sessions/{sid}/audio")
    assert full.status_code == 200 and full.content[:4] == b"RIFF"
    part = client.get(f"/api/sessions/{sid}/audio", headers={"Range": "bytes=100-500099"})
    assert part.status_code == 206
    assert part.content == full.content[100:500100]
    assert part.headers["content-range"] == f"bytes 100-500099/{len(full.content)}"


def test_live_recording_chunks_join_and_process(client, fake_engines):
    s = client.post("/api/sessions", json={
        "title": "Recorded", "client_code": "C-002", "language": "en", "consent": True, "date": "2026-10-01",
    }).json()
    assert s["status"] == "uploading"
    assert datetime.fromisoformat(s["created_at"]).astimezone().date().isoformat() == "2026-10-01"
    data = SAMPLE.read_bytes()
    pieces = [data[:300_000], data[300_000:600_000], data[600_000:]]
    for i, piece in enumerate(pieces):
        r = client.post(f"/api/sessions/{s['id']}/chunks", data={"index": i},
                        files={"file": (f"chunk{i}.wav", piece, "audio/wav")})
        assert r.status_code == 200
    # a retried chunk replaces the earlier copy instead of duplicating it
    client.post(f"/api/sessions/{s['id']}/chunks", data={"index": 2}, files={"file": ("c.wav", pieces[2], "audio/wav")})
    assert client.post(f"/api/sessions/{s['id']}/finish").json()["status"] == "converting"
    detail = wait_ready(client, s["id"])
    assert detail["status"] == "ready", detail["error"]
    assert 25 < detail["duration_sec"] < 40
    assert not (settings.audio_dir / str(s["id"]) / "chunks").exists()
    assert client.post(f"/api/sessions/{s['id']}/chunks", data={"index": 9},
                       files={"file": ("c.wav", b"x", "audio/wav")}).status_code == 409


def test_without_speaker_separation_transcript_is_still_usable(client, fake_engines, monkeypatch):
    from app import jobs
    from app.pipeline.diarize import diarize

    monkeypatch.setattr(jobs, "diarize", diarize)  # the real one: no HF_TOKEN in tests
    detail = wait_ready(client, upload(client)["id"])
    assert detail["status"] == "ready"
    assert "Hugging Face" in detail["warning"]
    assert [t["role"] for t in detail["turns"]] == ["counsellor", "client", "counsellor", "client"]


def test_editing_roles_split_swap_and_redact(client, fake_engines):
    detail = wait_ready(client, upload(client)["id"])
    sid, turns = detail["id"], detail["turns"]

    edited = client.patch(f"/api/turns/{turns[1]['id']}", json={"text": "Um, honestly, it has been hard for Priya."}).json()
    assert edited["turns"][1]["edited"] is True

    split = client.post(f"/api/turns/{turns[3]['id']}/split", json={"at": len("Mostly that I will fail")}).json()
    assert len(split["turns"]) == 5
    assert split["turns"][4]["role"] == "counsellor"
    assert split["turns"][4]["text"].startswith("and let my parents down")
    assert split["turns"][3]["end"] <= split["turns"][4]["start"]
    assert len(split["exchanges"]) == 3

    reassigned = client.patch(f"/api/turns/{split['turns'][4]['id']}", json={"role": "client"}).json()
    assert len(reassigned["exchanges"]) == 2

    swapped = client.post(f"/api/sessions/{sid}/swap-roles").json()
    assert swapped["counsellor_speaker"] == "SPEAKER_01"
    assert swapped["turns"][0]["role"] == "client"

    redacted = client.post(f"/api/sessions/{sid}/redact", json={"names": ["priya"]}).json()
    assert redacted["replaced"] == 1
    assert "[NAME]" in redacted["session"]["turns"][1]["text"]


def test_insights_summary_feedback_and_export(client, fake_engines):
    sid = wait_ready(client, upload(client)["id"])["id"]
    assert client.post(f"/api/sessions/{sid}/insights").json()["status"] == "insights"
    detail = wait_ready(client, sid)
    assert detail["status"] == "ready", detail["warning"]
    insight = detail["exchanges"][0]["insight_json"]
    assert insight["confidence"] == "high"  # normalised from "High"
    assert detail["summary"]["summary_json"]["main_themes"] == ["Exam stress"]
    assert detail["summary"]["model_used"].startswith("ollama:")

    ex_id = detail["exchanges"][0]["id"]
    saved = client.patch(f"/api/exchanges/{ex_id}", json={"counsellor_feedback": "disagree", "counsellor_note": "More about family."}).json()
    assert saved["counsellor_feedback"] == "disagree"

    txt = client.get(f"/api/sessions/{sid}/export?format=txt")
    assert txt.status_code == 200
    body = txt.text
    assert "“Hello, thanks for coming in today." in body
    assert "AI interpretation — not a clinical judgement" in body
    notes_at = body.index("COUNSELLOR'S OWN NOTES")
    assert body.index("More about family.") > notes_at > body.index("AI INTERPRETATIONS")

    docx = client.get(f"/api/sessions/{sid}/export?format=docx")
    assert docx.status_code == 200 and docx.content[:2] == b"PK"
    pdf = client.get(f"/api/sessions/{sid}/export?format=pdf")
    assert pdf.status_code == 200 and "window.print" in pdf.text


def test_insight_retry_then_unavailable(client, fake_engines, monkeypatch):
    from app.ai import llm

    sid = wait_ready(client, upload(client)["id"])["id"]
    monkeypatch.setattr(llm, "complete", lambda messages: "not json at all")
    client.post(f"/api/sessions/{sid}/insights")
    detail = wait_ready(client, sid)
    assert detail["exchanges"][0]["insight_json"]["error"] == "Insight unavailable"
    assert "unavailable" in detail["warning"]


def test_delete_removes_everything(client, fake_engines):
    sid = wait_ready(client, upload(client)["id"])["id"]
    folder = settings.audio_dir / str(sid)
    assert folder.exists()
    assert client.delete(f"/api/sessions/{sid}").status_code == 200
    assert client.get(f"/api/sessions/{sid}").status_code == 404
    assert not folder.exists()


def test_retention_removes_old_audio_keeps_transcript(client, fake_engines):
    from sqlmodel import Session as DBSession

    from app.models import Session, engine, utcnow
    from datetime import timedelta

    sid = wait_ready(client, upload(client)["id"])["id"]
    with DBSession(engine) as db:
        s = db.get(Session, sid)
        s.created_at = utcnow() - timedelta(days=40)
        db.add(s)
        db.commit()
    client.patch("/api/settings", json={"retention_days": 30})
    detail = client.get(f"/api/sessions/{sid}").json()
    client.patch("/api/settings", json={"retention_days": 0})
    assert detail["has_audio"] is False and detail["audio_deleted_at"]
    assert len(detail["turns"]) == 4
    assert not Path(settings.audio_dir / str(sid) / "audio.wav.enc").exists()
    assert client.get(f"/api/sessions/{sid}/audio").status_code == 404
