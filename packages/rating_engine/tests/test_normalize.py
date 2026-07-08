from __future__ import annotations

from rolefit import percentile_ranks, percentile_to_score, zscore_ranks


def test_percentile_direction_and_ties():
    values = {"a": 1.0, "b": 2.0, "c": 3.0}
    hi = percentile_ranks(values, higher_better=True)
    assert hi["c"] > hi["b"] > hi["a"]
    lo = percentile_ranks(values, higher_better=False)
    assert lo["a"] > lo["b"] > lo["c"]  # lower is better -> higher goodness


def test_percentile_missing_stays_none_not_zero():
    values = {"a": 1.0, "b": None, "c": 3.0}
    ranks = percentile_ranks(values)
    assert ranks["b"] is None
    assert ranks["a"] is not None and ranks["c"] is not None


def test_single_value_is_midpoint():
    assert percentile_ranks({"a": 5.0})["a"] == 0.5


def test_percentile_to_score_scales_and_preserves_none():
    assert percentile_to_score(0.9) == 90.0
    assert percentile_to_score(None) is None


def test_zscore_zero_variance_and_missing():
    z = zscore_ranks({"a": 2.0, "b": 2.0, "c": None})
    assert z["a"] == 0.0 and z["b"] == 0.0 and z["c"] is None
