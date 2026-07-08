from __future__ import annotations

from market_model import MARKET_VERSION, MarketInputs, estimate_market


def base_inputs(**over):
    kw = dict(
        age=20.0,
        position="LW",
        position_group="ATT",
        minutes=1800,
        best_rolefit=82.0,
        avg_top3_rolefit=78.0,
        league_multiplier=1.03,
        team_tier="strong",
        public_value_eur=40_000_000.0,
        recent_form_index=0.7,
        international_caps=4,
        contract_years_remaining=3.0,
        hype_index=0.8,
    )
    kw.update(over)
    return MarketInputs(**kw)


def test_three_values_are_separate_and_ordered():
    e = estimate_market(base_inputs())
    assert e.public_value_eur == 40_000_000.0
    assert e.model_value_low_eur < e.model_value_high_eur
    assert e.expected_asking_low_eur < e.expected_asking_high_eur
    # asking generally sits at/above model mid due to negotiation premium
    model_mid = (e.model_value_low_eur + e.model_value_high_eur) / 2
    asking_mid = (e.expected_asking_low_eur + e.expected_asking_high_eur) / 2
    assert asking_mid >= model_mid


def test_no_negative_or_below_floor_values():
    e = estimate_market(
        base_inputs(best_rolefit=20.0, avg_top3_rolefit=20.0, public_value_eur=None, minutes=200)
    )
    for v in [
        e.model_value_low_eur,
        e.model_value_high_eur,
        e.expected_asking_low_eur,
        e.expected_asking_high_eur,
    ]:
        assert v is None or v >= 250_000.0


def test_missing_public_value_lowers_confidence():
    with_pv = estimate_market(base_inputs())
    without_pv = estimate_market(base_inputs(public_value_eur=None))
    order = {"unknown": 0, "low": 1, "medium": 2, "high": 3}
    assert order[without_pv.confidence] < order[with_pv.confidence]


def test_missing_contract_widens_asking_range_and_flags_note():
    known = estimate_market(base_inputs(contract_years_remaining=3.0))
    unknown = estimate_market(base_inputs(contract_years_remaining=None))

    def width(e):
        mid = (e.expected_asking_low_eur + e.expected_asking_high_eur) / 2
        return (e.expected_asking_high_eur - e.expected_asking_low_eur) / mid

    assert width(unknown) > width(known)
    assert "unknown" in unknown.explanation["asking_factors"]["contract"].lower()


def test_labels_are_valid():
    e = estimate_market(base_inputs())
    assert e.label in {"undervalued", "fair", "inflated", "high-risk", "unknown"}


def test_unknown_label_when_confidence_unknown():
    e = estimate_market(
        base_inputs(
            public_value_eur=None,
            contract_years_remaining=None,
            best_rolefit=None,
            avg_top3_rolefit=None,
            minutes=100,
        )
    )
    assert e.confidence in {"unknown", "low"}


def test_outlier_triggers_manual_review():
    # Huge public value + short contract inflates asking well past model value.
    e = estimate_market(
        base_inputs(
            public_value_eur=250_000_000.0,
            team_tier="elite",
            hype_index=1.0,
            best_rolefit=55.0,
            avg_top3_rolefit=50.0,
        )
    )
    assert e.manual_review_required
    assert e.explanation["manual_review_reasons"]


def test_stronger_league_increases_model_value():
    strong = estimate_market(base_inputs(league_multiplier=1.05, public_value_eur=None))
    weak = estimate_market(base_inputs(league_multiplier=0.90, public_value_eur=None))
    assert strong.model_value_high_eur > weak.model_value_high_eur


def test_version_is_stamped():
    assert estimate_market(base_inputs()).version == MARKET_VERSION
