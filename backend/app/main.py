"""FastAPI app and routes. All routes live under /api (see SPEC.md, REST API table)."""

from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from sqlmodel import Session as DBSession
from sqlmodel import select

from .config import settings
from .models import (
    Exchange,
    Session,
    SessionDetail,
    SessionRead,
    Summary,
    Turn,
    get_db,
    init_db,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Verbatim", lifespan=lifespan)
api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict:
    """Lets the frontend check the backend is running and which engines are active."""
    return {
        "status": "ok",
        "transcribe_engine": settings.transcribe_engine,
        "llm_engine": settings.llm_engine,
        "cloud_mode": settings.cloud_mode,
    }


@api.get("/sessions", response_model=list[SessionRead])
def list_sessions(db: DBSession = Depends(get_db)):
    return db.exec(select(Session).order_by(Session.created_at.desc())).all()


@api.get("/sessions/{session_id}", response_model=SessionDetail)
def get_session(session_id: int, db: DBSession = Depends(get_db)):
    session = db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    turns = db.exec(select(Turn).where(Turn.session_id == session_id).order_by(Turn.index)).all()
    exchanges = db.exec(
        select(Exchange).where(Exchange.session_id == session_id).order_by(Exchange.index)
    ).all()
    return SessionDetail(
        **session.model_dump(exclude={"audio_path"}),
        turns=turns,
        exchanges=exchanges,
        summary=db.get(Summary, session_id),
    )


app.include_router(api)
