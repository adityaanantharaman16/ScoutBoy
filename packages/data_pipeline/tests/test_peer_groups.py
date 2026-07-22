from __future__ import annotations

from data_pipeline.normalize.peer_groups import group_by_peer, peer_group_for_position


def test_peer_group_assignment_uses_canonical_position_mapping():
    assert peer_group_for_position("LW") == "ATT"
    assert peer_group_for_position("CM") == "MID"
    assert peer_group_for_position("CB") is None
    assert peer_group_for_position(None) is None


def test_group_by_peer_groups_players_and_ignores_unknown_groups():
    groups = group_by_peer(
        {
            "attacker-1": "ATT",
            "midfielder-1": "MID",
            "attacker-2": "ATT",
            "unknown": "",
        }
    )

    assert groups == {
        "ATT": ["attacker-1", "attacker-2"],
        "MID": ["midfielder-1"],
    }
