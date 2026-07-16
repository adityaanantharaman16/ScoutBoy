"""End-to-end pipeline checks against the seeded test DB (root conftest fixtures)."""

from __future__ import annotations

from app.models.orm import (
    MarketValue,
    Player,
    PlayerMetricNormalized,
    PlayerPlaystyle,
    RatingAudit,
    RatingRun,
    RoleRating,
)
from rolefit import load_role_configs
from sqlalchemy import func, select


def test_ingest_and_recompute_populate_core_tables(db_session):
    assert db_session.scalar(select(func.count()).select_from(RoleRating)) > 0
    assert db_session.scalar(select(func.count()).select_from(MarketValue)) == 24
    assert db_session.scalar(select(func.count()).select_from(PlayerPlaystyle)) > 0


def test_every_rating_has_an_audit(db_session):
    ratings = db_session.scalar(select(func.count()).select_from(RoleRating))
    audits = db_session.scalar(select(func.count()).select_from(RatingAudit))
    assert ratings == audits and ratings > 0


def test_runs_recorded_and_completed(db_session):
    runs = list(db_session.scalars(select(RatingRun)))
    types = {r.run_type for r in runs}
    assert {"ingest", "recompute"}.issubset(types)
    assert all(r.status == "completed" for r in runs)
    recompute = next(r for r in runs if r.run_type == "recompute")
    assert recompute.config_hashes_json and recompute.affected_players_count
    assert recompute.source_snapshot_ids_json


def test_normalized_missing_metrics_are_absent_not_zero(db_session):
    # normalized rows only exist for metrics that were actually present
    rows = list(db_session.scalars(select(PlayerMetricNormalized).limit(50)))
    assert rows
    assert all(r.per90_value is not None for r in rows)


def test_ranks_are_dense_and_deterministic(db_session):
    ratings = list(
        db_session.scalars(select(RoleRating).where(RoleRating.role_key == "advanced_8"))
    )
    ranks = sorted(r.rank_in_peer_group for r in ratings)
    assert ranks == list(range(1, len(ranks) + 1))


def test_every_rating_respects_explicit_role_position_eligibility(db_session):
    roles = load_role_configs()
    ratings = list(db_session.scalars(select(RoleRating)))
    for rating in ratings:
        player = db_session.get(Player, rating.player_id)
        assert player.primary_position in roles[rating.role_key].eligible_positions
