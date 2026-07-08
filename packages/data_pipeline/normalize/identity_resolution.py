"""Canonical identity resolution.

Keeps a single canonical Player per real person while mapping many source ids into
player_source_ids (US-1.6, US-7.3). Matches first on (source_name, source_player_id);
falls back to canonical_name + birth_date for cross-source de-duplication. This is
intentionally conservative for the MVP and documented as such.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from app.models.orm import Player, PlayerSourceId
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..adapters.base import CanonicalPlayer


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def resolve_player(session: Session, cp: CanonicalPlayer) -> Player:
    # 1) exact source-id match (idempotent re-ingest)
    link = session.scalar(
        select(PlayerSourceId).where(
            PlayerSourceId.source_name == cp.source_name,
            PlayerSourceId.source_player_id == cp.source_player_id,
        )
    )
    if link is not None:
        player = session.get(Player, link.player_id)
        _apply_fields(player, cp)
        return player

    # 2) cross-source match on name + birth date
    birth = _parse_date(cp.birth_date)
    player = None
    if birth is not None:
        player = session.scalar(
            select(Player).where(
                Player.canonical_name == cp.canonical_name, Player.birth_date == birth
            )
        )

    if player is None:
        player = Player(canonical_name=cp.canonical_name, birth_date=birth)
        session.add(player)
        _apply_fields(player, cp)
        session.flush()  # assign id

    session.add(
        PlayerSourceId(
            player_id=player.id,
            source_name=cp.source_name,
            source_player_id=cp.source_player_id,
            source_url=cp.source_url,
            raw_name=cp.raw_name,
        )
    )
    return player


def _apply_fields(player: Player, cp: CanonicalPlayer) -> None:
    player.canonical_name = cp.canonical_name
    if cp.birth_date:
        player.birth_date = _parse_date(cp.birth_date)
    player.nationality = cp.nationality or player.nationality
    player.preferred_foot = cp.preferred_foot or player.preferred_foot
    player.height_cm = cp.height_cm or player.height_cm
    player.primary_position = cp.primary_position or player.primary_position
    if cp.secondary_positions:
        player.secondary_positions = cp.secondary_positions
