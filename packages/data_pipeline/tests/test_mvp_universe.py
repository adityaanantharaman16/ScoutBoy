from __future__ import annotations

from data_pipeline.normalize.mvp_universe import evaluate_membership


def test_valid_u23_attacker_is_eligible():
    v = evaluate_membership(age=21, position_group="ATT", minutes=1800, is_european=True)
    assert v.eligible


def test_overage_excluded():
    v = evaluate_membership(age=25, position_group="MID", minutes=1800, is_european=True)
    assert not v.eligible and v.reasons["u23"] is False


def test_unsupported_position_excluded():
    v = evaluate_membership(age=20, position_group="DEF", minutes=2000, is_european=True)
    assert not v.eligible and v.reasons["attacker_or_midfielder"] is False


def test_low_minutes_excluded_by_default():
    v = evaluate_membership(age=20, position_group="ATT", minutes=300, is_european=True)
    assert not v.eligible and v.reasons["min_minutes"] is False


def test_configurable_threshold():
    assert evaluate_membership(
        age=20, position_group="ATT", minutes=300, is_european=True, min_minutes=200
    ).eligible


def test_non_european_excluded():
    v = evaluate_membership(age=20, position_group="ATT", minutes=1800, is_european=False)
    assert not v.eligible and v.reasons["european"] is False


def test_unknown_age_excluded():
    v = evaluate_membership(age=None, position_group="ATT", minutes=1800, is_european=True)
    assert not v.eligible
