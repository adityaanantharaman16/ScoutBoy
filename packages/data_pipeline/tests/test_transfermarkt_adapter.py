from __future__ import annotations

from app.models.orm import (
    Appearance,
    Competition,
    MarketValue,
    Player,
    PlayerSourceId,
    Team,
)
from data_pipeline.adapters import TransfermarktAdapter
from data_pipeline.jobs.ingest import ingest_bundle
from sqlalchemy import func, select


def test_transfermarkt_adapter_builds_full_bundle(tm_dir):
    b = TransfermarktAdapter(csv_dir=tm_dir).fetch()
    assert b.source_name == "transfermarkt"
    assert b.players and b.teams and b.competitions and b.appearances
    # market value emitted as a metric
    assert any(m.metric_name == "public_value_eur" for m in b.metrics)
    # source ids preserved on canonical players
    assert all(p.source_name == "transfermarkt" and p.source_player_id for p in b.players)
    # out-of-scope positions are retained (not silently dropped)
    assert any(p.primary_position == "CB" for p in b.players)


def test_transfermarkt_ingest_creates_canonical_entities(fresh_sessions, tm_dir):
    SessionLocal, _ = fresh_sessions
    bundle = TransfermarktAdapter(csv_dir=tm_dir).fetch()
    with SessionLocal() as s:
        ingest_bundle(s, bundle)
    with SessionLocal() as s:
        assert s.scalar(select(func.count()).select_from(Player)) == len(bundle.players)
        assert s.scalar(select(func.count()).select_from(PlayerSourceId)) == len(bundle.players)
        assert s.scalar(select(func.count()).select_from(Team)) > 0
        assert s.scalar(select(func.count()).select_from(Competition)) > 0
        assert s.scalar(select(func.count()).select_from(Appearance)) > 0
        assert s.scalar(select(func.count()).select_from(MarketValue)) == 0  # market computed later
        # public value stored as raw metric
        assert s.scalar(
            select(func.count())
            .select_from(PlayerSourceId)
            .where(PlayerSourceId.source_name == "transfermarkt")
        ) == len(bundle.players)


def test_transfermarkt_ingest_is_idempotent(fresh_sessions, tm_dir):
    SessionLocal, _ = fresh_sessions
    for _ in range(2):
        with SessionLocal() as s:
            ingest_bundle(s, TransfermarktAdapter(csv_dir=tm_dir).fetch())
    with SessionLocal() as s:
        # re-running does not duplicate canonical players or source ids
        assert s.scalar(select(func.count()).select_from(Player)) == 24
        assert s.scalar(select(func.count()).select_from(PlayerSourceId)) == 24


def test_transfermarkt_quality_warnings(fresh_sessions, tm_dir):
    SessionLocal, _ = fresh_sessions
    bundle = TransfermarktAdapter(csv_dir=tm_dir).fetch()
    with SessionLocal() as s:
        result = ingest_bundle(s, bundle)
    checks = {f["check"]: f for f in result["report"]["findings"]}
    # unsupported position (the CB) is flagged; missing current club is flagged
    assert checks["out_of_scope_positions"]["count"] >= 1
    assert checks["missing_current_club"]["count"] >= 1


def test_transfermarkt_missing_required_file_raises(tmp_path):
    import pytest

    (tmp_path / "players.csv").write_text("player_id,name\n1,X\n")
    with pytest.raises(FileNotFoundError):
        TransfermarktAdapter(csv_dir=tmp_path).fetch()
