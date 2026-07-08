from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, compare, methodology, players, roles
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title="ScoutBoy API",
    version="0.1.0",
    description=(
        "ScoutBoy — FUT.gg-style real-life player discovery. MVP scope: U23 attackers "
        "and midfielders in Europe. Every score/badge/value is explainable."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api"
for r in (players.router, roles.router, compare.router, methodology.router, admin.router):
    app.include_router(r, prefix=API_PREFIX)


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok", "scope": "U23 attackers & midfielders in Europe"}
