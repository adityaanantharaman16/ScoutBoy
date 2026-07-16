"""Milestone 3 real-pilot coverage report and executable acceptance gate."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from app.core.db import SessionLocal
from app.models.orm import (
    Appearance,
    MarketValue,
    Player,
    PlayerMetricRaw,
    PlayerSourceId,
    PlayerUniverseMembership,
    RoleRating,
    Season,
    SourceSnapshot,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..normalize.mvp_universe import UNIVERSE_KEY


def build_cohort_report(session: Session, season_label: str = "2023/2024") -> dict:
    season = session.scalar(select(Season).where(Season.label == season_label))
    if season is None:
        return {"season": season_label, "status": "missing", "checks": {}}

    snapshots = list(
        session.scalars(
            select(SourceSnapshot)
            .where(SourceSnapshot.target_season == season_label)
            .order_by(SourceSnapshot.provider)
        )
    )
    season_player_ids = set(
        session.scalars(select(Appearance.player_id).where(Appearance.season_id == season.id))
    )
    source_counts = dict(
        session.execute(
            select(PlayerSourceId.source_name, func.count(PlayerSourceId.id))
            .where(PlayerSourceId.player_id.in_(season_player_ids or {-1}))
            .group_by(PlayerSourceId.source_name)
        ).all()
    )
    source_sets: dict[int, set[str]] = {}
    for pid, source in session.execute(
        select(PlayerSourceId.player_id, PlayerSourceId.source_name).where(
            PlayerSourceId.player_id.in_(season_player_ids or {-1})
        )
    ):
        source_sets.setdefault(pid, set()).add(source)
    dual_ids = {
        pid for pid, sources in source_sets.items() if {"transfermarkt", "statsbomb"} <= sources
    }

    covered_rows = list(
        session.execute(
            select(PlayerMetricRaw.player_id, PlayerMetricRaw.metric_value).where(
                PlayerMetricRaw.season_id == season.id,
                PlayerMetricRaw.metric_name == "performance_covered_minutes",
            )
        )
    )
    covered_450 = {pid for pid, value in covered_rows if (value or 0) >= 450}
    eligible_rows = list(
        session.scalars(
            select(PlayerUniverseMembership).where(
                PlayerUniverseMembership.season_id == season.id,
                PlayerUniverseMembership.universe_key == UNIVERSE_KEY,
                PlayerUniverseMembership.eligible.is_(True),
            )
        )
    )
    eligible_ids = {row.player_id for row in eligible_rows}
    players = {
        p.id: p for p in session.scalars(select(Player).where(Player.id.in_(eligible_ids or {-1})))
    }
    ratings = list(
        session.scalars(
            select(RoleRating).where(
                RoleRating.season_id == season.id,
                RoleRating.player_id.in_(eligible_ids or {-1}),
            )
        )
    )
    role_counts = Counter(r.role_key for r in ratings)
    rated_ids = {r.player_id for r in ratings}
    ratings_by_player: dict[int, list[RoleRating]] = {}
    for rating in ratings:
        ratings_by_player.setdefault(rating.player_id, []).append(rating)
    markets = {
        m.player_id: m
        for m in session.scalars(
            select(MarketValue).where(
                MarketValue.season_id == season.id,
                MarketValue.player_id.in_(eligible_ids or {-1}),
            )
        )
    }
    metric_counts = dict(
        session.execute(
            select(PlayerMetricRaw.player_id, func.count(PlayerMetricRaw.id))
            .where(
                PlayerMetricRaw.season_id == season.id,
                PlayerMetricRaw.metric_provider == "statsbomb",
                PlayerMetricRaw.player_id.in_(eligible_ids or {-1}),
            )
            .group_by(PlayerMetricRaw.player_id)
        ).all()
    )

    checks = {
        "two_source_snapshots": len({s.provider for s in snapshots}) >= 2,
        "identity_bridge_operational": len(dual_ids) >= 300,
        "covered_players_present": len(covered_450) >= 18,
        "u23_att_mid_vertical_slice": len(eligible_ids) >= 3,
        "all_eligible_players_rated": eligible_ids <= rated_ids,
        "eligible_birth_dates_known": all(p.birth_date is not None for p in players.values()),
        "eligible_public_values_present": all(
            markets.get(pid) and markets[pid].public_value_eur is not None for pid in eligible_ids
        ),
    }
    return {
        "season": season_label,
        "status": "pass" if all(checks.values()) else "fail",
        "scope": {
            "label": "Bayer Leverkusen-centered Bundesliga 2023/24 vertical-slice pilot",
            "statsbomb_matches": 34,
            "claim": "pilot only; not full Bundesliga or European coverage",
        },
        "snapshots": [
            {
                "key": s.snapshot_key,
                "provider": s.provider,
                "version": s.dataset_version,
                "checksum": s.checksum,
                "license_url": s.license_url,
            }
            for s in snapshots
        ],
        "identity": {"source_ids": source_counts, "dual_source_players": len(dual_ids)},
        "coverage": {
            "players_with_event_metrics": len(covered_rows),
            "players_with_450_covered_minutes": len(covered_450),
            "eligible_u23_att_mid": len(eligible_ids),
        },
        "eligible_players": [
            {
                "id": pid,
                "name": players[pid].canonical_name,
                "position": players[pid].primary_position,
                "statsbomb_metric_rows": metric_counts.get(pid, 0),
                "rating_count": sum(r.player_id == pid for r in ratings),
                "ratings": [
                    {
                        "role": rating.role_key,
                        "score": rating.final_score,
                        "confidence": rating.confidence,
                    }
                    for rating in sorted(
                        ratings_by_player.get(pid, []), key=lambda item: -item.final_score
                    )
                ],
                "public_value_eur": markets.get(pid).public_value_eur if markets.get(pid) else None,
            }
            for pid in sorted(eligible_ids, key=lambda x: players[x].canonical_name)
        ],
        "role_rating_counts": dict(sorted(role_counts.items())),
        "checks": checks,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Milestone 3 real-cohort report")
    parser.add_argument("--season", default="2023/2024")
    parser.add_argument("--output")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args(argv)
    with SessionLocal() as session:
        report = build_cohort_report(session, args.season)
    rendered = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered + "\n")
    print(rendered)
    return 1 if args.verify and report.get("status") != "pass" else 0


if __name__ == "__main__":
    sys.exit(main())
