"""API checks: app lock, health, validation and the session list."""

from conftest import PASSWORD, SAMPLE


def test_health_reports_local_mode(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["cloud_mode"] is False
    assert body["checks"]["ffmpeg"] is True
    assert body["checks"]["encryption"] is True


def test_routes_need_login():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as anon:
        assert anon.get("/api/sessions").status_code == 401
        assert anon.get("/api/health").status_code == 200
        assert anon.post("/api/auth/login", json={"password": "wrong-password"}).status_code in (401, 400)


def test_wrong_password_and_change_password(client):
    assert client.post("/api/auth/password", json={"current": "nope-nope", "new": "another-pass-1"}).status_code == 401
    assert client.post("/api/auth/password", json={"current": PASSWORD, "new": "short"}).status_code == 400
    # change and change back
    assert client.post("/api/auth/password", json={"current": PASSWORD, "new": "another-pass-1"}).status_code == 200
    assert client.post("/api/auth/password", json={"current": "another-pass-1", "new": PASSWORD}).status_code == 200


def test_unknown_session_is_404(client):
    assert client.get("/api/sessions/9999").status_code == 404


def test_consent_and_client_code_are_required(client):
    base = {"title": "x", "client_code": "C-001", "language": "auto"}
    assert client.post("/api/sessions", json={**base, "consent": False}).status_code == 400
    assert client.post("/api/sessions", json={**base, "consent": True, "client_code": "Priya Sharma"}).status_code == 400
    with open(SAMPLE, "rb") as f:
        resp = client.post(
            "/api/sessions/upload",
            data={"title": "x", "client_code": "C-001", "consent": "false"},
            files={"file": ("a.wav", f, "audio/wav")},
        )
    assert resp.status_code == 400


def test_rejects_non_audio_upload(client):
    resp = client.post(
        "/api/sessions/upload",
        data={"title": "x", "client_code": "C-001", "consent": "true"},
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 400


def test_settings_roundtrip(client):
    assert client.patch("/api/settings", json={"auto_insights": False, "noise_reduction": "strong"}).status_code == 200
    body = client.get("/api/settings").json()
    assert body["noise_reduction"] == "strong"
    assert client.patch("/api/settings", json={"noise_reduction": "light"}).json()["noise_reduction"] == "light"
    assert client.patch("/api/settings", json={"retention_days": -1}).status_code == 422
