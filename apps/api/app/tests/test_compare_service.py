"""Unit coverage for the automatic shared-role selector.

The selector is a pure presentation choice over *stored* RoleFit ratings: it may
only pick a role both players are already rated in, it must be symmetric in the
two players, and it must never alter a stored score.
"""

from __future__ import annotations

from app.models.schemas import RoleRatingSummary
from app.services.compare_service import _select_automatic_shared_role


def rating(role_key: str, score: float, confidence: str = "high") -> RoleRatingSummary:
    return RoleRatingSummary(
        role_key=role_key,
        display_name=role_key.replace("_", " ").title(),
        final_score=score,
        raw_score=score,
        context_adjusted_score=score,
        confidence=confidence,
    )


def test_only_considers_roles_both_players_are_rated_in():
    a = [rating("solo_a", 99.0), rating("shared_role", 55.0)]
    b = [rating("solo_b", 98.0), rating("shared_role", 51.0)]
    assert _select_automatic_shared_role(a, b) == "shared_role"


def test_maximises_the_weaker_players_score_not_the_joint_total():
    # inside_forward has the higher A score *and* the higher combined score, but
    # the weaker side fits touchline_winger far better.
    a = [rating("inside_forward", 95.0), rating("touchline_winger", 70.0)]
    b = [rating("inside_forward", 50.0), rating("touchline_winger", 68.0)]
    assert _select_automatic_shared_role(a, b) == "touchline_winger"


def test_does_not_pick_the_smallest_score_difference():
    # deep_lying_playmaker is the closest match (1.0 apart) but both players fit
    # it poorly; the policy must prefer the genuinely stronger shared role.
    a = [rating("ball_playing_cb", 80.0), rating("deep_lying_playmaker", 40.0)]
    b = [rating("ball_playing_cb", 76.0), rating("deep_lying_playmaker", 41.0)]
    assert _select_automatic_shared_role(a, b) == "ball_playing_cb"


def test_uses_combined_score_when_the_floor_ties():
    a = [rating("a_role", 60.0), rating("z_role", 60.0)]
    b = [rating("a_role", 80.0), rating("z_role", 90.0)]
    assert _select_automatic_shared_role(a, b) == "z_role"


def test_uses_stored_confidence_only_as_a_tie_break():
    # identical floors and totals; z_role's weaker side is the more confident one
    # (and it loses the alphabetical tie-break), so only confidence can pick it.
    a = [rating("a_role", 70.0, "high"), rating("z_role", 70.0, "medium")]
    b = [rating("a_role", 70.0, "low"), rating("z_role", 70.0, "high")]
    assert _select_automatic_shared_role(a, b) == "z_role"


def test_uses_ascending_role_key_as_the_final_tie_break():
    a = [rating("z_role", 70.0, "high"), rating("a_role", 70.0, "high")]
    b = [rating("z_role", 70.0, "high"), rating("a_role", 70.0, "high")]
    assert _select_automatic_shared_role(a, b) == "a_role"


def test_selection_is_symmetric_when_the_players_are_swapped():
    a = [
        rating("solo_a", 99.0, "high"),
        rating("inside_forward", 88.0, "high"),
        rating("touchline_winger", 71.0, "medium"),
    ]
    b = [
        rating("solo_b", 97.0, "high"),
        rating("inside_forward", 42.0, "low"),
        rating("touchline_winger", 69.0, "high"),
    ]
    forward = _select_automatic_shared_role(a, b)
    reversed_ = _select_automatic_shared_role(b, a)
    assert forward == reversed_ == "touchline_winger"
    # and it is neither player's own best role
    assert forward not in {"solo_a", "solo_b"}


def test_returns_none_when_there_is_no_shared_rated_role():
    a = [rating("inside_forward", 88.0)]
    b = [rating("ball_playing_cb", 84.0)]
    assert _select_automatic_shared_role(a, b) is None


def test_returns_none_when_a_rating_list_is_missing_or_empty():
    a = [rating("inside_forward", 88.0)]
    assert _select_automatic_shared_role(None, None) is None
    assert _select_automatic_shared_role(a, None) is None
    assert _select_automatic_shared_role(None, a) is None
    assert _select_automatic_shared_role(a, []) is None
    assert _select_automatic_shared_role([], []) is None


def test_does_not_modify_any_stored_score_or_confidence():
    a = [rating("inside_forward", 88.0, "high"), rating("touchline_winger", 71.0, "medium")]
    b = [rating("inside_forward", 42.0, "low"), rating("touchline_winger", 69.0, "high")]
    before = [(r.role_key, r.final_score, r.confidence) for r in a + b]
    assert _select_automatic_shared_role(a, b) == "touchline_winger"
    assert [(r.role_key, r.final_score, r.confidence) for r in a + b] == before
