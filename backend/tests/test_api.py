"""Phase 1 checks: the API starts, lists sessions and returns a session with its turns."""

import os
import tempfile

# Use a throwaway data folder and local engines so tests never touch real sessions.
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="verbatim-test-")
os.environ["TRANSCRIBE_ENGINE"] = "local"
os.environ["LLM_ENGINE"] = "ollama"

from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session as DBSession  # noqa: E402

from app.main import app  # noqa: E402
from app.models import Exchange, Role, Session, Turn, engine  # noqa: E402


def test_health_reports_local_mode():
    with TestClient(app) as client:
        body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["cloud_mode"] is False


def test_unknown_session_is_404():
    with TestClient(app) as client:
        assert client.get("/api/sessions/9999").status_code == 404


def test_session_with_turns_and_exchanges():
    with TestClient(app) as client:
        with DBSession(engine) as db:
            session = Session(title="Test", client_code="C-001", audio_path="secret.wav")
            db.add(session)
            db.commit()
            db.refresh(session)
            t1 = Turn(session_id=session.id, index=0, speaker_raw="SPEAKER_00",
                      role=Role.counsellor, start=0, end=2, text="How are you?")
            t2 = Turn(session_id=session.id, index=1, speaker_raw="SPEAKER_01", role=Role.client,
                      start=2, end=5, text="Um, okay.",
                      words_json=[{"word": "Um,", "start": 2, "end": 2.3, "score": 0.3}])
            db.add_all([t1, t2])
            db.commit()
            db.add(Exchange(session_id=session.id, index=0,
                            counsellor_turn_ids=[t1.id], client_turn_ids=[t2.id]))
            db.commit()
            session_id = session.id

        listed = client.get("/api/sessions").json()
        assert any(s["id"] == session_id for s in listed)

        detail = client.get(f"/api/sessions/{session_id}").json()
        assert [t["role"] for t in detail["turns"]] == ["counsellor", "client"]
        assert detail["turns"][1]["words_json"][0]["score"] == 0.3
        assert detail["exchanges"][0]["client_turn_ids"] == [detail["turns"][1]["id"]]
        assert "audio_path" not in detail
        assert detail["created_at"].endswith("+00:00")
