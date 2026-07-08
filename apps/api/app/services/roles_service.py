from __future__ import annotations

from typing import Optional

from rolefit import RATING_VERSION, load_role_configs
from sqlalchemy.orm import Session

from app.models.schemas import RoleLeaderboard, RoleRankingRow
from app.repositories import players_repo as repo

from .players_service import _load_rows

_CONF_ORDER = {"unknown": 0, "low": 1, "medium": 2, "high": 3}


def role_leaderboard(
    session: Session,
    role_key: str,
    *,
    age_min=None,
    age_max=None,
    league=None,
    min_minutes=None,
    min_confidence=None,
    limit=50,
) -> Optional[RoleLeaderboard]:
    roles = load_role_configs()
    role = roles.get(role_key)
    if role is None:
        return None
    season = repo.get_current_season(session)
    if season is None:
        return None

    rows = _load_rows(session, season)
    ranked = []
    for row in rows:
        rr = next((r for r in row.ratings if r.role_key == role_key), None)
        if rr is None:
            continue
        if age_min is not None and (row.age is None or row.age < age_min):
            continue
        if age_max is not None and (row.age is None or row.age > age_max):
            continue
        if (
            league
            and league.lower()
            not in " ".join(filter(None, [row.league_slug, row.league_name])).lower()
        ):
            continue
        if min_minutes is not None and row.minutes < min_minutes:
            continue
        if min_confidence and _CONF_ORDER.get(rr.confidence, 0) < _CONF_ORDER.get(
            min_confidence, 0
        ):
            continue
        ranked.append((rr, row))

    # deterministic: score desc, confidence desc, name asc, id asc
    ranked.sort(
        key=lambda t: (
            -t[0].final_score,
            -_CONF_ORDER.get(t[0].confidence, 0),
            t[1].player.canonical_name.lower(),
            t[1].player.id,
        )
    )

    rows_out = []
    for i, (rr, row) in enumerate(ranked[:limit], start=1):
        m = row.market
        rows_out.append(
            RoleRankingRow(
                rank=i,
                player_id=row.player.id,
                canonical_name=row.player.canonical_name,
                age=row.age,
                club=row.club,
                league=row.league_name,
                final_score=rr.final_score,
                confidence=rr.confidence,
                top_playstyles=row.top_playstyles,
                expected_asking_low_eur=getattr(m, "expected_asking_low_eur", None),
                expected_asking_high_eur=getattr(m, "expected_asking_high_eur", None),
            )
        )

    return RoleLeaderboard(
        role_key=role.role_key,
        display_name=role.display_name,
        position_group=role.position_group,
        description=role.description,
        season=season.label,
        rating_version=RATING_VERSION,
        total=len(ranked),
        rows=rows_out,
    )
