"""Milestone 8.5 - the backend half of the cross-surface terminology contract.

Most of ScoutBoy's user-visible words live in the frontend, but three things are
authored here and rendered verbatim by a surface a scout reads:

* the Discovery ranking explanation (``discovery_sort`` + ``discovery_explanation``),
* the comparison's confidence warnings (``compare_service``), and
* the Methodology scope and limitations (``methodology_service``).

The canonical lexicon is ``docs/milestone_8_5_terminology_audit.md``. These tests
hold the backend to it so a rename on one side cannot make the two disagree - the
frontend renders these strings without editing them, so a lower-case "best role"
here would appear inside a surface whose every other label says Best Role.

Nothing here asserts an ordering, a score, a filter or a rule: those contracts are
owned by ``test_discovery_ranking.py`` and are untouched by this milestone.
"""

from __future__ import annotations

import pytest

from app.repositories import discovery_sort
from app.services import discovery_explanation
from app.services.compare_service import _CONF_WORD
from app.services.methodology_service import get_methodology

ROLE_DISPLAY = {"touchline_winger": "Touchline Winger"}


# ---------------------------------------------------------------------------
# Best Role versus Selected Role
# ---------------------------------------------------------------------------
def test_the_selected_role_context_is_labelled_Selected_Role():
    spec = discovery_sort.spec_for("rolefit_desc")
    context = discovery_explanation.role_context("touchline_winger", ROLE_DISPLAY, spec)

    assert context.label == "Selected Role: Touchline Winger"
    assert context.source == "selected_role"
    # and a selected role never mentions a best role at all
    assert "best role" not in context.detail.lower()


def test_the_best_role_context_is_labelled_Best_Role():
    spec = discovery_sort.spec_for("rolefit_desc")
    context = discovery_explanation.role_context(None, ROLE_DISPLAY, spec)

    assert context.label == "Best Role for each player"
    assert context.source == "best_role"
    # Title Case in the detail too: it names the stored context, not a description.
    assert "stored Best Role" in context.detail
    assert "stored best role" not in context.detail


@pytest.mark.parametrize("sort", sorted(discovery_sort.SORT_SPECS))
def test_neither_role_context_is_ever_described_as_a_recommendation(sort):
    spec = discovery_sort.spec_for(sort)
    for role_key in (None, "touchline_winger"):
        context = discovery_explanation.role_context(role_key, ROLE_DISPLAY, spec)
        for text in (context.label, context.detail):
            lowered = text.lower()
            for word in ("recommend", "suggest", "suitab", "best signing", "priority"):
                assert word not in lowered, f"{sort}: {text!r} contains {word!r}"


# ---------------------------------------------------------------------------
# the ordering key lexicon
# ---------------------------------------------------------------------------
def _every_key():
    for spec in discovery_sort.SORT_SPECS.values():
        for key in spec.keys:
            yield spec.sort, key


def test_every_key_label_uses_the_canonical_spelling_of_every_term():
    """A label a scout reads may only use the lexicon's words.

    ``RoleFit`` has one capitalization; the market concept is ``Expected Asking``
    and never ``Asking Price``; the rating-status placement key names Rated and
    Unrated rather than borrowing an Evidence Coverage word.
    """
    labels = {label for _, key in _every_key() for label in [key.label]}
    joined = " | ".join(sorted(labels))

    for wrong in ("Rolefit", "roleFit", "Role Fit", "ROLEFIT"):
        assert wrong not in joined, joined
    for wrong in ("Asking Price", "Data Coverage", "Profile Only"):
        assert wrong not in joined, joined

    # The two labels this milestone depends on, spelled out.
    assert "RoleFit Score" in labels
    assert "RoleFit Confidence" in labels
    assert "Rated Before Unrated" in labels
    assert "Expected Asking Known First" in labels
    assert "Expected Asking (Lower Endpoint)" in labels


def test_the_sort_mode_labels_name_expected_asking_not_asking_price():
    labels = {spec.label for spec in discovery_sort.SORT_SPECS.values()}
    assert "Expected Asking" in labels
    assert "Asking Price" not in labels
    assert "RoleFit" in labels


def test_every_rule_sentence_keeps_RoleFit_capitalized():
    for sort, key in _every_key():
        for wrong in ("Rolefit", "roleFit", "Role Fit", "rolefit "):
            assert wrong not in key.rule, f"{sort}/{key.key}: {key.rule!r}"


def test_the_missing_value_sentences_never_read_a_gap_as_zero():
    for spec in discovery_sort.SORT_SPECS.values():
        lowered = spec.missing_values.lower()
        if "rolefit" in spec.sort:
            assert "never receives a placeholder score" in lowered
        if spec.sort.startswith("value_"):
            assert "never read as €0" in lowered


def test_the_limitation_denies_recommendation_in_so_many_words():
    assert "ordering, not recruitment suitability" in discovery_sort.ORDERING_LIMITATION
    assert "does not rate, rank or recommend" in discovery_sort.ORDERING_LIMITATION


# ---------------------------------------------------------------------------
# the comparison's confidence warnings
# ---------------------------------------------------------------------------
def test_the_compare_warning_names_RoleFit_Confidence(client, db_session):
    """The warning reports the card's stored RoleFit Confidence.

    Before 8.5 it said only "confidence", on a page that also shows the market
    model's separate Valuation Confidence. The words now say which one it is, and
    the level reads as a display word rather than a raw enum value.
    """
    from .test_api import _first_att_id, _insert_profile_only_player

    unrated = _insert_profile_only_player(db_session, name="Terminology Warning Copy")
    rated = _first_att_id(client)
    warnings = client.get(f"/api/compare?player_a={rated}&player_b={unrated}").json()[
        "confidence_warnings"
    ]

    assert warnings
    for warning in warnings:
        assert "RoleFit Confidence" in warning, warning
        # a raw enum value never reaches the surface
        assert " low confidence" not in warning
        assert " unknown confidence" not in warning
        assert any(word in warning for word in _CONF_WORD.values()), warning


def test_an_unrated_side_is_explained_as_unrated_not_as_missing_data(client, db_session):
    """The conclusion may not contradict the balance columns beside it.

    Both columns render "Unrated in this role"; the sentence under them used to
    say "Not enough data to compare in a shared role", which is a volume claim
    about the same cause. One screen, one explanation.
    """
    from .test_api import _first_att_id, _insert_profile_only_player

    unrated = _insert_profile_only_player(db_session, name="Terminology Unrated Side")
    rated = _first_att_id(client)
    body = client.get(
        f"/api/compare?player_a={rated}&player_b={unrated}&role_key=touchline_winger"
    ).json()

    assert body["why_higher"].startswith("At least one player is unrated in this role")
    assert "Not enough data" not in body["why_higher"]
    # and no score is invented for either side
    assert body["role_comparison"] == {}


def test_the_confidence_display_words_cover_every_stored_level():
    assert set(_CONF_WORD) == {"unknown", "low", "medium", "high"}
    assert set(_CONF_WORD.values()) == {"Unknown", "Low", "Medium", "High"}


# ---------------------------------------------------------------------------
# market copy the dossier renders verbatim
# ---------------------------------------------------------------------------
def test_the_market_label_basis_names_the_three_reads_canonically():
    """`explanation.label_basis` is rendered under "Why This Valuation".

    The FIGURES are the model's own - the label really is decided by comparing the
    Expected Asking midpoint with the Model Value Range - so the sentence keeps
    saying so. Only the names changed.
    """
    from market_model import MarketInputs, estimate_market

    estimate = estimate_market(
        MarketInputs(
            age=21,
            position="CF",
            position_group="ATT",
            minutes=1800,
            best_rolefit=90.0,
            avg_top3_rolefit=85.0,
            public_value_eur=20_000_000,
        )
    )
    basis = estimate.explanation["label_basis"]
    assert basis.startswith("Expected Asking midpoint ")
    assert "Model Value Range" in basis
    for wrong in ("expected asking mid", "model range", "asking price"):
        assert wrong not in basis, basis

    disclaimer = estimate.explanation["disclaimer"]
    assert "Public Market Value" in disclaimer
    assert "Model Value Range" in disclaimer
    assert "Expected Asking Range" in disclaimer


def test_the_comparable_player_groups_use_the_canonical_market_and_rolefit_names(client):
    from .test_api import _first_att_id

    groups = client.get(f"/api/players/{_first_att_id(client)}/similar").json()["groups"]
    prose = " ".join(
        [g["label"] + " " + g["description"] for g in groups]
        + [p["reason"] for g in groups for p in g["players"]]
    )
    assert "expected asking price" not in prose
    assert "asking price" not in prose
    if "Expected Asking" in prose:
        assert "Expected Asking Range" in prose or "lower Expected Asking" in prose
    for wrong in ("Rolefit", "roleFit", "Role Fit"):
        assert wrong not in prose, prose


# ---------------------------------------------------------------------------
# methodology
# ---------------------------------------------------------------------------
def test_the_methodology_copy_carries_no_retired_coverage_spelling():
    methodology = get_methodology()
    prose = " ".join(
        [methodology.scope, methodology.formula, *methodology.limitations]
        + [dimension.explanation for dimension in methodology.context_dimensions]
    )
    assert "Data Coverage" not in prose
    assert "data coverage" not in prose
    # RoleFit keeps its one capitalization in generated prose too
    for wrong in ("Rolefit", "roleFit", "Role Fit"):
        assert wrong not in prose, prose
