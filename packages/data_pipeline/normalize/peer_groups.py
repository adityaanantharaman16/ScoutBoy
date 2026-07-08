"""Peer-group assignment.

RoleFit metrics are percentiled within a peer group. For the MVP the peer group is
the position group (ATT / MID), which is what makes a metric mean different things
for an attacker vs a midfielder."""

from __future__ import annotations

from scoutboy_shared import position_group_for


def peer_group_for_position(position: str | None) -> str | None:
    return position_group_for(position or "")


def group_by_peer(player_positions: dict[str, str]) -> dict[str, list[str]]:
    """player_id -> position_group  ==>  position_group -> [player_id]."""
    groups: dict[str, list[str]] = {}
    for pid, pg in player_positions.items():
        if pg:
            groups.setdefault(pg, []).append(pid)
    return groups
