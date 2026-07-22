"""Canonical identity resolution.

Keeps a single canonical Player per real person while mapping many source ids into
player_source_ids (US-1.6, US-7.3). Matches first on (source_name, source_player_id);
falls back to canonical_name + birth_date for cross-source de-duplication. This is
intentionally conservative for the MVP and documented as such.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

from app.models.orm import Player, PlayerSourceId
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..adapters.base import CanonicalPlayer


@dataclass(frozen=True)
class IdentityAmbiguity:
    source_name: str
    source_player_id: str
    canonical_name: str
    birth_date: Optional[date]
    candidate_count: int


@dataclass
class IdentityResolutionResult:
    players_by_source_key: dict[tuple[str, str], Player]
    ambiguities: list[IdentityAmbiguity]


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def resolve_player(session: Session, cp: CanonicalPlayer) -> Player:
    result = resolve_players(session, [cp])
    if result.ambiguities:
        raise ValueError(f"Ambiguous canonical identity for {cp.source_name}:{cp.source_player_id}")
    return result.players_by_source_key[(cp.source_name, cp.source_player_id)]


def resolve_players(
    session: Session, canonical_players: list[CanonicalPlayer]
) -> IdentityResolutionResult:
    """Batch identity resolution while preserving the conservative exact matching policy."""
    if not canonical_players:
        return IdentityResolutionResult(players_by_source_key={}, ambiguities=[])
    source_names = sorted({player.source_name for player in canonical_players})
    source_ids = [player.source_player_id for player in canonical_players]
    links: list[PlayerSourceId] = []
    for start in range(0, len(source_ids), 500):
        links.extend(
            session.scalars(
                select(PlayerSourceId).where(
                    PlayerSourceId.source_name.in_(source_names),
                    PlayerSourceId.source_player_id.in_(source_ids[start : start + 500]),
                )
            )
        )
    link_by_key = {(link.source_name, link.source_player_id): link for link in links}
    player_ids = sorted({link.player_id for link in links})
    players_by_id: dict[int, Player] = {}
    for start in range(0, len(player_ids), 500):
        players_by_id.update(
            {
                player.id: player
                for player in session.scalars(
                    select(Player).where(Player.id.in_(player_ids[start : start + 500]))
                )
            }
        )

    unresolved = [
        player
        for player in canonical_players
        if (player.source_name, player.source_player_id) not in link_by_key
    ]
    names = sorted({player.canonical_name for player in unresolved if player.birth_date})
    identity_candidates: list[Player] = []
    for start in range(0, len(names), 500):
        identity_candidates.extend(
            session.scalars(
                select(Player).where(Player.canonical_name.in_(names[start : start + 500]))
            )
        )
    identity_by_key: dict[tuple[str, Optional[date]], list[Player]] = {}
    for player in identity_candidates:
        identity_by_key.setdefault((player.canonical_name, player.birth_date), []).append(player)

    result: dict[tuple[str, str], Player] = {}
    ambiguities: list[IdentityAmbiguity] = []
    pending_links: list[tuple[CanonicalPlayer, Player]] = []
    for cp in canonical_players:
        key = (cp.source_name, cp.source_player_id)
        link = link_by_key.get(key)
        if link is not None:
            player = players_by_id[link.player_id]
            _apply_fields(player, cp)
            result[key] = player
            continue
        birth = _parse_date(cp.birth_date)
        candidates = identity_by_key.get((cp.canonical_name, birth), []) if birth else []
        if len(candidates) > 1:
            ambiguities.append(
                IdentityAmbiguity(
                    source_name=cp.source_name,
                    source_player_id=cp.source_player_id,
                    canonical_name=cp.canonical_name,
                    birth_date=birth,
                    candidate_count=len(candidates),
                )
            )
            continue
        player = candidates[0] if candidates else None
        if player is None:
            player = Player(canonical_name=cp.canonical_name, birth_date=birth)
            session.add(player)
            _apply_fields(player, cp)
            identity_by_key.setdefault((cp.canonical_name, birth), []).append(player)
        pending_links.append((cp, player))
        result[key] = player
    session.flush()
    session.add_all(
        [
            PlayerSourceId(
                player_id=player.id,
                source_name=cp.source_name,
                source_player_id=cp.source_player_id,
                source_url=cp.source_url,
                raw_name=cp.raw_name,
            )
            for cp, player in pending_links
        ]
    )
    return IdentityResolutionResult(
        players_by_source_key=result,
        ambiguities=ambiguities,
    )


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
