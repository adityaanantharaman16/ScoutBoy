from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# `text_search` is imported for its side effect as much as its contents: it registers a
# global SQLAlchemy `connect` listener that gives every SQLite connection the
# deterministic Unicode `lower()` Discovery's text matching and name ordering are
# defined in terms of. It has to be imported before the engine below opens a
# connection, or a pooled connection could be handed out without the function.
from . import text_search  # noqa: F401
from .config import get_settings


def _make_engine():
    url = get_settings().database_url
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, future=True, connect_args=connect_args)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
