"""Read queries for players and their per-season derived data. Repositories own DB
access; services turn these into API schemas."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orm import (
    Appearance,
    Competition,
    ContextAdjustment,
    MarketValue,
    Player,
    PlayerMetricNormalized,
    PlayerMetricRaw,
    PlayerPlaystyle,
    PlayerSourceId,
    RatingAudit,
    RoleRating,
    Season,
    Team,
)


def get_current_season(session: Session) -> Optional[Season]:
    season = session.scalar(select(Season).where(Season.is_current.is_(True)))
    if season is None:
        season = session.scalar(select(Season).order_by(Season.id.desc()))
    return season


def get_player(session: Session, player_id: int) -> Optional[Player]:
    return session.get(Player, player_id)


def teams_by_id(session: Session) -> dict[int, Team]:
    return {t.id: t for t in session.scalars(select(Team))}


def competitions_by_id(session: Session) -> dict[int, Competition]:
    return {c.id: c for c in session.scalars(select(Competition))}


def primary_appearances(session: Session, season_id: int) -> dict[int, Appearance]:
    """One appearance per player (max minutes) for the season."""
    out: dict[int, Appearance] = {}
    for a in session.scalars(select(Appearance).where(Appearance.season_id == season_id)):
        cur = out.get(a.player_id)
        if cur is None or (a.minutes or 0) > (cur.minutes or 0):
            out[a.player_id] = a
    return out


def ratings_for_season(session: Session, season_id: int) -> dict[int, list[RoleRating]]:
    out: dict[int, list[RoleRating]] = {}
    for r in session.scalars(select(RoleRating).where(RoleRating.season_id == season_id)):
        out.setdefault(r.player_id, []).append(r)
    return out


def ratings_for_player(session: Session, player_id: int, season_id: int) -> list[RoleRating]:
    return list(
        session.scalars(
            select(RoleRating).where(
                RoleRating.player_id == player_id, RoleRating.season_id == season_id
            )
        )
    )


def audits_for_ratings(session: Session, rating_ids: list[int]) -> dict[int, RatingAudit]:
    if not rating_ids:
        return {}
    rows = session.scalars(select(RatingAudit).where(RatingAudit.role_rating_id.in_(rating_ids)))
    return {a.role_rating_id: a for a in rows}


def playstyles_for_season(session: Session, season_id: int) -> dict[int, list[PlayerPlaystyle]]:
    out: dict[int, list[PlayerPlaystyle]] = {}
    for p in session.scalars(select(PlayerPlaystyle).where(PlayerPlaystyle.season_id == season_id)):
        out.setdefault(p.player_id, []).append(p)
    return out


def playstyles_for_player(
    session: Session, player_id: int, season_id: int
) -> list[PlayerPlaystyle]:
    return list(
        session.scalars(
            select(PlayerPlaystyle).where(
                PlayerPlaystyle.player_id == player_id, PlayerPlaystyle.season_id == season_id
            )
        )
    )


def markets_for_season(session: Session, season_id: int) -> dict[int, MarketValue]:
    return {
        m.player_id: m
        for m in session.scalars(select(MarketValue).where(MarketValue.season_id == season_id))
    }


def market_for_player(session: Session, player_id: int, season_id: int) -> Optional[MarketValue]:
    return session.scalar(
        select(MarketValue).where(
            MarketValue.player_id == player_id, MarketValue.season_id == season_id
        )
    )


def contexts_for_season(session: Session, season_id: int) -> dict[int, ContextAdjustment]:
    return {
        c.player_id: c
        for c in session.scalars(
            select(ContextAdjustment).where(ContextAdjustment.season_id == season_id)
        )
    }


def normalized_for_player(
    session: Session, player_id: int, season_id: int
) -> list[PlayerMetricNormalized]:
    return list(
        session.scalars(
            select(PlayerMetricNormalized).where(
                PlayerMetricNormalized.player_id == player_id,
                PlayerMetricNormalized.season_id == season_id,
            )
        )
    )


def raw_for_player(session: Session, player_id: int, season_id: int) -> dict[str, float]:
    out: dict[str, float] = {}
    for r in session.scalars(
        select(PlayerMetricRaw).where(
            PlayerMetricRaw.player_id == player_id, PlayerMetricRaw.season_id == season_id
        )
    ):
        if r.metric_value is not None:
            out[r.metric_name] = r.metric_value
    return out


def source_ids_for_player(session: Session, player_id: int) -> list[PlayerSourceId]:
    return list(
        session.scalars(select(PlayerSourceId).where(PlayerSourceId.player_id == player_id))
    )


def eligible_universe_ids(session: Session, season_id: int, universe_key: str) -> set[int]:
    """Player ids marked eligible for the given MVP universe/season. Returns an empty set
    if the universe has not been materialized (callers may then choose not to filter)."""
    from app.models.orm import PlayerUniverseMembership

    return set(
        session.scalars(
            select(PlayerUniverseMembership.player_id).where(
                PlayerUniverseMembership.season_id == season_id,
                PlayerUniverseMembership.universe_key == universe_key,
                PlayerUniverseMembership.eligible.is_(True),
            )
        )
    )


def universe_materialized(session: Session, season_id: int, universe_key: str) -> bool:
    from app.models.orm import PlayerUniverseMembership

    return (
        session.scalar(
            select(PlayerUniverseMembership.id).where(
                PlayerUniverseMembership.season_id == season_id,
                PlayerUniverseMembership.universe_key == universe_key,
            )
        )
        is not None
    )
