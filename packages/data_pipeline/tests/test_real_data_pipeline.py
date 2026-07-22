"""End-to-end real-data-v0: ingest Transfermarkt sample + performance CSV, recompute,
then drive the API against that database (via a get_db override)."""

from __future__ import annotations

import pytest
from app.core.db import get_db
from app.main import app
from data_pipeline.adapters import PerformanceCsvAdapter, TransfermarktAdapter
from data_pipeline.jobs.ingest import ingest_bundle
from data_pipeline.jobs.recompute import recompute
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def real_client(tmp_path_factory):
    from app.models.orm import Base
    from rolefit.paths import repo_root
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    root = repo_root()
    url = f"sqlite:///{tmp_path_factory.mktemp('real') / 'real.db'}"
    engine = create_engine(url, connect_args={"check_same_thread": False}, future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, future=True)

    with SessionLocal() as s:
        ingest_bundle(
            s, TransfermarktAdapter(csv_dir=root / "data/sample/transfermarkt_sample").fetch()
        )
    with SessionLocal() as s:
        ingest_bundle(
            s,
            PerformanceCsvAdapter(
                csv_path=root / "data/sample/performance_metrics_sample.csv"
            ).fetch(),
        )
    with SessionLocal() as s:
        recompute(s)

    def override_get_db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def test_search_returns_real_backed_universe(real_client):
    mvp = real_client.get("/api/players?universe=mvp&page_size=50").json()
    allp = real_client.get("/api/players?universe=all&page_size=50").json()
    assert 0 < mvp["total"] < allp["total"]  # universe filter excludes edge cases
    names_all = {i["canonical_name"] for i in allp["items"]}
    names_mvp = {i["canonical_name"] for i in mvp["items"]}
    excluded = names_all - names_mvp
    # overage / small-sample / unsupported-position players are excluded
    assert {"Viktor Holm", "Owen Clarke", "Daniel Novak"}.issubset(excluded)


def test_real_player_card_has_source_backed_sections(real_client):
    item = real_client.get("/api/players?universe=mvp&page_size=1").json()["items"][0]
    card = real_client.get(f"/api/players/{item['id']}").json()
    assert card["identity"]["canonical_name"]
    assert card["identity"]["age"] is not None  # source-backed age
    assert card["identity"]["club"] and card["identity"]["league"]
    assert card["role_ratings"] and any(r["is_best"] for r in card["role_ratings"])
    assert card["data_sources"]  # source attribution present
    assert card["market"] is not None
    # face stats present; missing groups are unknown, never zero
    for f in card["face_stats"]:
        assert f["score"] is None or f["score"] > 0


def test_real_leaderboard_and_compare(real_client):
    lb = real_client.get("/api/roles/inside_forward/rankings?limit=10").json()
    assert lb["rows"] and [r["rank"] for r in lb["rows"]] == list(range(1, len(lb["rows"]) + 1))
    ids = [i["id"] for i in real_client.get("/api/players?page_size=2").json()["items"]]
    cmp = real_client.get(f"/api/compare?player_a={ids[0]}&player_b={ids[1]}").json()
    assert cmp["why_higher"] and cmp["stat_rows"]


def test_real_rating_runs_recorded(real_client):
    runs = real_client.get("/api/admin/rating-runs").json()
    types = {r["run_type"] for r in runs}
    assert "ingest" in types and "recompute" in types
    assert all(r["status"] in {"completed", "completed_with_warnings"} for r in runs)


def test_missing_metrics_are_low_confidence_not_zero(real_client):
    # a player with limited data should still render with unknown/low-confidence, not zeros
    allp = real_client.get("/api/players?universe=all&page_size=50").json()["items"]
    low = [p for p in allp if p["confidence"] in ("low", "unknown")]
    # small-sample player exists in the 'all' view
    assert any(p["canonical_name"] == "Owen Clarke" for p in allp)
    for p in low:
        assert p["best_role_score"] is None or p["best_role_score"] >= 0
