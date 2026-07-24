"""Milestone 6 — RoleFit calibration & model-evaluation tests.

Covers: contract validation, deterministic fixture evaluation, role-ordering pass/fail,
inconclusive pilot behavior, context/confidence guardrails, playstyle/concern boundaries,
baseline-vs-current regression, and CLI JSON/report determinism. All CI-relevant cases run on
committed fixtures only — no DB, no network.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from evaluation import CalibrationContract, FixtureSuite, evaluate_fixtures
from evaluation.contract import ContractError, Scenario
from evaluation.database_evaluator import evaluate_pilot
from evaluation.evaluator import (
    _SCENARIO_HANDLERS,
    evaluate_fixture_benchmark,
    evaluate_scenario,
)
from evaluation.fixtures import score_benchmark
from evaluation.reporting import render_json, render_markdown
from rolefit import RATING_VERSION, ContextConfig, PlaystyleConfig, build_audit, load_role_configs

BASELINE = Path(__file__).with_name("calibration_baseline.json")
MIN_MINUTES = 450


@pytest.fixture(scope="module")
def engine():
    return load_role_configs(), ContextConfig.load(), PlaystyleConfig.load()


@pytest.fixture(scope="module")
def contract():
    return CalibrationContract.load()


@pytest.fixture(scope="module")
def suite():
    return FixtureSuite.load()


@pytest.fixture(scope="module")
def result():
    return evaluate_fixtures(min_minutes=MIN_MINUTES)


# --- 1. contract validation ---------------------------------------------------
def test_contract_loads_and_is_valid(contract, engine):
    roles, _ctx, ps = engine
    assert contract.suite_id == "rolefit_calibration"
    assert contract.version == "v1"
    assert contract.fixture_benchmarks and contract.pilot_benchmarks and contract.scenarios
    # every fixture benchmark has committed fixture data; every pilot benchmark has source ids
    suite = FixtureSuite.load()
    for b in contract.fixture_benchmarks:
        assert b.id in suite.players, f"{b.id} has no fixture data"
    for b in contract.pilot_benchmarks:
        assert b.source_ids, f"pilot {b.id} must resolve by source id"
    contract.validate_against_engine(roles, ps)  # must not raise


def test_contract_rejects_unknown_role(engine):
    roles, _ctx, ps = engine
    bad = {
        "suite": {"id": "x", "version": "v1", "rating_version": RATING_VERSION},
        "benchmarks": [{"id": "b", "expected_primary_role": "not_a_role", "description": "x"}],
    }
    contract = CalibrationContract.parse(bad)
    with pytest.raises(ContractError):
        contract.validate_against_engine(roles, ps)


def test_contract_rejects_bad_evidence_level():
    bad = {
        "suite": {"id": "x", "version": "v1", "rating_version": RATING_VERSION},
        "benchmarks": [{"id": "b", "evidence_level": "made_up", "description": "x"}],
    }
    with pytest.raises(ContractError):
        CalibrationContract.parse(bad)


# --- 2. deterministic fixture evaluation --------------------------------------
def test_fixture_suite_all_pass(result):
    assert result["overall_status"] == "pass"
    assert result["totals"]["benchmarks"]["fail"] == 0
    assert result["totals"]["scenarios"]["fail"] == 0
    assert result["failing"] == []


def test_fixture_evaluation_is_byte_stable():
    a = render_json(evaluate_fixtures(min_minutes=MIN_MINUTES))
    b = render_json(evaluate_fixtures(min_minutes=MIN_MINUTES))
    assert a == b


def test_expected_primary_roles(result):
    by_id = {b["benchmark_id"]: b for b in result["benchmarks"]}
    assert by_id["wide_carrier_touchline_winger"]["actual_primary_role"] == "touchline_winger"
    assert by_id["goal_first_inside_forward"]["actual_primary_role"] == "inside_forward"
    assert (
        by_id["progressive_deep_lying_playmaker"]["actual_primary_role"] == "deep_lying_playmaker"
    )
    assert by_id["two_way_advanced_8"]["actual_primary_role"] == "advanced_8"
    assert by_id["ball_winner_bwm"]["actual_primary_role"] == "ball_winning_midfielder"


# --- 3. role-ordering pass AND failure cases ----------------------------------
def test_role_ordering_pass_case(result):
    b = next(
        x for x in result["benchmarks"] if x["benchmark_id"] == "wide_carrier_touchline_winger"
    )
    orderings = b["role_ordering_results"]
    assert orderings and all(o["status"] == "pass" for o in orderings)


def test_role_ordering_failure_is_detected(suite, engine, contract):
    """Invert a known-true ordering; the evaluator must report FAIL, not silently pass."""
    roles, ctx, ps = engine
    bench = next(b for b in contract.fixture_benchmarks if b.id == "wide_carrier_touchline_winger")
    broken = copy.deepcopy(bench)
    # a wide carrier does NOT prefer inside_forward over touchline_winger
    from evaluation.contract import RoleOrdering

    object.__setattr__(
        broken, "role_ordering", (RoleOrdering(higher="inside_forward", lower="touchline_winger"),)
    )
    res = evaluate_fixture_benchmark(broken, suite, roles, ctx, ps, min_minutes=MIN_MINUTES)
    assert res["status"] == "fail"
    assert any(o["status"] == "fail" for o in res["role_ordering_results"])


# --- 4 & 10. pilot: inconclusive when absent, read-only ------------------------
def test_pilot_inconclusive_without_data():
    """With no seeded DB the pilot must be inconclusive — never fail — and never raise."""
    out = evaluate_pilot()
    assert out["suite"] == "pilot"
    assert out["read_only"] is True
    assert out["totals"]["fail"] == 0
    # every pilot benchmark resolved (local dev) or inconclusive (CI) — never a hard fail
    assert all(b["status"] in ("pass", "inconclusive") for b in out["benchmarks"])
    assert "Leverkusen" in out["coverage_note"]


# Read-only, pass/fail, and completeness (partial coverage, missing audit) pilot behavior against
# isolated fixture-backed databases is covered comprehensively in test_calibration_cli.py.


# --- 5. context & confidence guardrails ---------------------------------------
def test_context_and_confidence_scenarios_pass(result):
    by_id = {s["scenario_id"]: s for s in result["scenarios"]}
    for sid in (
        "league_strength_ordering",
        "team_strength_ordering",
        "competition_stakes_ordering",
        "minutes_sample_monotonicity",
        "recent_form_confidence_gating",
        "confidence_within_bounds",
    ):
        assert by_id[sid]["status"] == "pass", (sid, by_id[sid]["detail"])


def test_context_is_bounded_not_erasing(result):
    """Weaker environment lowers the score but never erases production."""
    detail = next(s for s in result["scenarios"] if s["scenario_id"] == "league_strength_ordering")[
        "detail"
    ]
    assert "not erased" in detail


# --- 6. playstyle & concern boundaries ----------------------------------------
def test_playstyle_and_concern_boundaries_pass(result):
    by_id = {s["scenario_id"]: s for s in result["scenarios"]}
    assert by_id["playstyle_tier_thresholds"]["status"] == "pass"
    assert by_id["concern_trigger_boundary"]["status"] == "pass"


def test_playstyle_tier_boundary_direct(engine, suite):
    roles, ctx, ps = engine
    from evaluation.contract import Scenario

    scen = Scenario(
        id="s",
        type="playstyle_tiers",
        description="",
        params={
            "position_group": "ATT",
            "playstyle_key": "volume_shooter",
            "metric": "shots_per90",
        },
    )
    res = evaluate_scenario(scen, suite, roles, ctx, ps, min_minutes=MIN_MINUTES)
    assert res["status"] == "pass"


# --- 7. baseline-vs-current regression ----------------------------------------
def test_matches_committed_baseline(result):
    baseline = json.loads(BASELINE.read_text())
    # config hashes must match: any config/formula change is intentional and updates the baseline
    assert result["config_hashes"] == baseline["config_hashes"], (
        "RoleFit config changed — regenerate calibration_baseline.json intentionally "
        "and document the change (docs/milestone_6_rating_calibration.md)."
    )
    cur = {b["benchmark_id"]: b for b in result["benchmarks"]}
    for bid, exp in baseline["benchmarks"].items():
        got = cur[bid]
        assert got["status"] == exp["status"], bid
        assert got["actual_primary_role"] == exp["primary_role"], bid
        got_scores = {rs["role_key"]: rs["final_score"] for rs in got["role_scores"]}
        for role, score in exp["role_scores"].items():
            assert abs(got_scores[role] - score) <= 0.2, (bid, role, got_scores.get(role), score)
    for sid, status in baseline["scenarios"].items():
        assert next(s for s in result["scenarios"] if s["scenario_id"] == sid)["status"] == status


# --- 8. CLI JSON / report determinism -----------------------------------------
def test_cli_json_and_markdown_deterministic():
    r1 = evaluate_fixtures(min_minutes=MIN_MINUTES)
    r2 = evaluate_fixtures(min_minutes=MIN_MINUTES)
    assert render_json(r1) == render_json(r2)
    assert render_markdown(r1) == render_markdown(r2)


def test_cli_main_fixtures(capsys):
    from evaluation.__main__ import main

    code = main(["fixtures", "--fail-on-fail"])
    out = capsys.readouterr().out
    assert code == 0
    parsed = json.loads(out)
    assert parsed["overall_status"] == "pass"


def test_all_scenario_types_have_handlers(contract):
    for scen in contract.scenarios:
        assert scen.type in _SCENARIO_HANDLERS, scen.type


# --- verdict-branch coverage (the pass/warn/fail/inconclusive logic) -----------
def _bench(**kw):
    from evaluation.contract import Benchmark

    base = dict(id="b", kind="fixture", evidence_level="fixture", description="x")
    base.update(kw)
    return Benchmark(**base)


def test_playstyle_present_false_fail(suite, engine):
    """Expecting a playstyle to be ABSENT while it is applied must FAIL."""
    roles, ctx, ps = engine
    from evaluation.contract import ExpectedPlaystyle

    b = _bench(
        expected_playstyles=(ExpectedPlaystyle(key="touchline_isolator", present=False),),
    )
    res = evaluate_fixture_benchmark(
        _rebind(b, "wide_carrier_touchline_winger"), suite, roles, ctx, ps, min_minutes=MIN_MINUTES
    )
    assert res["status"] == "fail"
    assert any(p["status"] == "fail" for p in res["playstyle_results"])


def test_concern_present_false_pass_and_confidence_fail(suite, engine):
    roles, ctx, ps = engine
    from evaluation.contract import ConfidenceExpectation, ExpectedConcern

    # concern correctly absent -> pass; but demand impossible HIGH confidence on a role -> fail
    # (low_minute_high_output is an elite finisher, so raw_finishing is correctly absent)
    b = _bench(
        expected_concerns=(ExpectedConcern(key="raw_finishing", present=False),),
        confidence=ConfidenceExpectation(role="inside_forward", min_level="high"),
    )
    res = evaluate_fixture_benchmark(
        _rebind(b, "low_minute_high_output"), suite, roles, ctx, ps, min_minutes=MIN_MINUTES
    )
    assert res["status"] == "fail"
    assert res["confidence_result"]["status"] == "fail"
    assert all(c["status"] == "pass" for c in res["concern_results"])


def test_translation_risk_fail(suite, engine):
    roles, ctx, ps = engine
    b = _bench(expected_translation_risk="high")  # lower_league fixture is medium
    res = evaluate_fixture_benchmark(
        _rebind(b, "lower_league_high_production"), suite, roles, ctx, ps, min_minutes=MIN_MINUTES
    )
    assert res["status"] == "fail"


def test_missing_fixture_data_is_inconclusive(suite, engine):
    roles, ctx, ps = engine
    b = _bench(id="not_in_fixtures", expected_primary_role="inside_forward")
    res = evaluate_fixture_benchmark(b, suite, roles, ctx, ps, min_minutes=MIN_MINUTES)
    assert res["status"] == "inconclusive"


def _rebind(bench, fixture_id):
    """Return a copy of ``bench`` whose id matches an existing fixture player."""
    object.__setattr__(bench, "id", fixture_id)
    return bench


def _mutate(mutator):
    d = _valid_contract_dict()
    mutator(d)
    return d


@pytest.mark.parametrize(
    "mutator",
    [
        lambda d: d["suite"].__setitem__("weird", 1),  # unknown suite key
        lambda d: d["benchmarks"][0].pop("description"),  # missing required description
        lambda d: d.__setitem__("benchmarks", {}),  # benchmarks not a list
        lambda d: d["benchmarks"][0].__setitem__("kind", "banana"),  # invalid kind
        lambda d: d["benchmarks"][0].__setitem__(
            "confidence", {"min_level": "amazing"}
        ),  # invalid confidence level
        lambda d: d["benchmarks"][0].__setitem__(
            "confidence", {"surprise": 1}
        ),  # unknown confidence key
        lambda d: d["benchmarks"][0].__setitem__(
            "source_ids", [{"source_name": "x"}]
        ),  # fixture with source_ids (invalid) + missing player id
        lambda d: d["benchmarks"][0].__setitem__("expected_primary_role", [1, 2]),  # bad type
        lambda d: d.__setitem__(
            "scenarios",
            [
                {
                    "id": "s",
                    "type": "minutes_monotonicity",
                    "params": {
                        "fixture_id": "wide_carrier_touchline_winger",
                        "role": "touchline_winger",
                        "minutes_ladder": [1000, 500],  # not non-decreasing
                    },
                }
            ],
        ),
        lambda d: d.__setitem__(
            "scenarios",
            [
                {"id": "s", "type": "confidence_bounds", "params": {}},
                {"id": "s", "type": "confidence_bounds", "params": {}},
            ],
        ),  # duplicate scenario id
    ],
)
def test_strict_schema_rejects_malformed(mutator):
    with pytest.raises(ContractError):
        CalibrationContract.parse(_mutate(mutator))


# --- strict contract schema validation (R1) -----------------------------------
def _valid_contract_dict():
    """A minimal, valid contract dict keyed to a committed fixture and the live engine."""
    return {
        "suite": {"id": "t", "version": "v1", "rating_version": RATING_VERSION},
        "benchmarks": [
            {
                "id": "wide_carrier_touchline_winger",
                "kind": "fixture",
                "evidence_level": "fixture",
                "description": "committed fixture",
                "expected_primary_role": "touchline_winger",
            }
        ],
    }


def test_reject_unknown_top_level_key():
    d = _valid_contract_dict()
    d["surprise"] = 1
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_unknown_benchmark_key():
    d = _valid_contract_dict()
    d["benchmarks"][0]["mystery"] = "x"
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_invalid_playstyle_tier():
    d = _valid_contract_dict()
    d["benchmarks"][0]["expected_playstyles"] = [{"key": "touchline_isolator", "min_tier": "epic"}]
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_invalid_kind_evidence_combination():
    d = _valid_contract_dict()
    # a fixture benchmark cannot carry pilot evidence
    d["benchmarks"][0]["evidence_level"] = "pilot"
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_duplicate_benchmark_ids():
    d = _valid_contract_dict()
    d["benchmarks"].append(dict(d["benchmarks"][0]))
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_invalid_role_ordering():
    d = _valid_contract_dict()
    d["benchmarks"][0]["role_ordering"] = [
        {"higher": "touchline_winger", "lower": "touchline_winger"}
    ]
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_unknown_scenario_type():
    d = _valid_contract_dict()
    d["scenarios"] = [{"id": "s", "type": "made_up_type", "params": {}}]
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_missing_scenario_param():
    d = _valid_contract_dict()
    d["scenarios"] = [
        {"id": "s", "type": "context_ordering", "params": {"fixture_id": "x", "role": "y"}}
    ]
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_bad_context_ordering_dimension():
    d = _valid_contract_dict()
    d["scenarios"] = [
        {
            "id": "s",
            "type": "context_ordering",
            "params": {
                "fixture_id": "wide_carrier_touchline_winger",
                "role": "touchline_winger",
                "dimension": "weather",
                "high": {},
                "low": {},
                "max_ratio": 1.2,
            },
        }
    ]
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_mismatched_rating_version():
    d = _valid_contract_dict()
    d["suite"]["rating_version"] = "rolefit-v0"
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_pilot_without_source_ids():
    d = _valid_contract_dict()
    d["benchmarks"] = [
        {
            "id": "p",
            "kind": "pilot",
            "evidence_level": "pilot",
            "description": "x",
            "season_label": "2023/2024",
            "inconclusive_allowed": True,
        }
    ]
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_pilot_without_inconclusive_allowed():
    d = _valid_contract_dict()
    d["benchmarks"] = [
        {
            "id": "p",
            "kind": "pilot",
            "evidence_level": "pilot",
            "description": "x",
            "season_label": "2023/2024",
            "source_ids": [{"source_name": "transfermarkt", "source_player_id": 1}],
        }
    ]
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_reject_missing_fixture_mapping(engine, suite):
    roles, ctx, ps = engine
    d = _valid_contract_dict()
    d["benchmarks"][0]["id"] = "ghost_fixture_not_committed"
    contract = CalibrationContract.parse(d)  # structurally valid
    with pytest.raises(ContractError):  # but cross-validation rejects the missing fixture
        contract.validate(roles=roles, ps_config=ps, fixtures=suite, ctx_config=ctx)


def test_real_contract_parses_and_full_validates(contract, engine, suite):
    roles, ctx, ps = engine
    contract.validate(roles=roles, ps_config=ps, fixtures=suite, ctx_config=ctx)  # must not raise


# --- audit reuse (R2) ----------------------------------------------------------
def test_evaluator_reuses_production_build_audit(suite, engine):
    roles, ctx, ps = engine
    scored = score_benchmark(
        suite, "wide_carrier_touchline_winger", roles, ctx, ps, min_minutes=MIN_MINUTES
    )
    rs = scored.role_scores[0]
    assert rs.audit == build_audit(rs.result)
    assert set(rs.audit) == {
        "metric_breakdown_json",
        "context_breakdown_json",
        "confidence_breakdown_json",
        "penalties_json",
        "explanation_text",
    }


def test_benchmark_result_carries_audit(result):
    b = next(
        x for x in result["benchmarks"] if x["benchmark_id"] == "wide_carrier_touchline_winger"
    )
    for rs in b["role_scores"]:
        assert "audit" in rs
        assert "metric_breakdown_json" in rs["audit"]
        assert "confidence_breakdown_json" in rs["audit"]


# --- numeric context bounds: passing AND failing boundary cases (R3a) ----------
def _ctx_scenario(**params):
    return Scenario(id="s", type="context_ordering", description="", params=params)


def test_context_ordering_passes_within_bound(suite, engine):
    roles, ctx, ps = engine
    res = evaluate_scenario(
        _ctx_scenario(
            fixture_id="wide_carrier_touchline_winger",
            role="touchline_winger",
            dimension="league",
            high={"competition_slug": "eng_premier_league"},
            low={"competition_slug": "eng_championship"},
            max_ratio=1.25,
        ),
        suite,
        roles,
        ctx,
        ps,
        min_minutes=MIN_MINUTES,
    )
    assert res["status"] == "pass"


def test_context_ordering_fails_when_ratio_exceeds_bound(suite, engine):
    roles, ctx, ps = engine
    res = evaluate_scenario(
        _ctx_scenario(
            fixture_id="wide_carrier_touchline_winger",
            role="touchline_winger",
            dimension="league",
            high={"competition_slug": "eng_premier_league"},
            low={"competition_slug": "eng_championship"},
            max_ratio=1.01,  # tighter than the real ~1.19 effect -> must FAIL
        ),
        suite,
        roles,
        ctx,
        ps,
        min_minutes=MIN_MINUTES,
    )
    assert res["status"] == "fail"
    assert "exceeds configured max" in res["detail"]


def test_context_ordering_fails_when_ordering_reversed(suite, engine):
    roles, ctx, ps = engine
    res = evaluate_scenario(
        _ctx_scenario(
            fixture_id="wide_carrier_touchline_winger",
            role="touchline_winger",
            dimension="league",
            high={"competition_slug": "eng_championship"},  # deliberately weaker as "high"
            low={"competition_slug": "eng_premier_league"},
            max_ratio=1.25,
        ),
        suite,
        roles,
        ctx,
        ps,
        min_minutes=MIN_MINUTES,
    )
    assert res["status"] == "fail"


# --- operational gate: unexpected inconclusive cannot be green (R1) ------------
def test_unexpected_inconclusive_blocks_gate_without_fail(suite):
    # confidence targets a role the LW fixture is NOT eligible for -> inconclusive check;
    # inconclusive_allowed defaults False -> the benchmark blocks the gate but is not a FAIL.
    d = _valid_contract_dict()
    d["benchmarks"][0]["confidence"] = {"role": "ball_winning_midfielder", "min_level": "high"}
    contract = CalibrationContract.parse(d)
    res = evaluate_fixtures(min_minutes=MIN_MINUTES, contract=contract, suite=suite)
    bench = res["benchmarks"][0]
    assert bench["status"] == "inconclusive"
    assert bench["benchmark_id"] in res["blocking"]
    assert res["gate_passed"] is False
    assert res["overall_status"] != "fail"  # not mislabeled as evidentiary fail


def test_allowed_inconclusive_does_not_block_gate(suite):
    d = _valid_contract_dict()
    d["benchmarks"][0]["confidence"] = {"role": "ball_winning_midfielder", "min_level": "high"}
    d["benchmarks"][0]["inconclusive_allowed"] = True
    contract = CalibrationContract.parse(d)
    res = evaluate_fixtures(min_minutes=MIN_MINUTES, contract=contract, suite=suite)
    assert res["benchmarks"][0]["status"] == "inconclusive"
    assert res["gate_passed"] is True  # allowed inconclusive is non-blocking


# --- strict nested context_ordering high/low validation (F1) ------------------
def _ctx_scenario_dict(dimension, high, low, *, max_ratio=1.25, description="d"):
    fixtures = {
        "league": ("wide_carrier_touchline_winger", "touchline_winger"),
        "team": ("two_way_advanced_8", "advanced_8"),
        "stakes": ("goal_first_inside_forward", "inside_forward"),
    }
    fid, role = fixtures[dimension]
    return {
        "id": "s",
        "type": "context_ordering",
        "description": description,
        "params": {
            "fixture_id": fid,
            "role": role,
            "dimension": dimension,
            "high": high,
            "low": low,
            "max_ratio": max_ratio,
        },
    }


def _contract_with_scenario(scenario: dict):
    d = _valid_contract_dict()
    d["scenarios"] = [scenario]
    return CalibrationContract.parse(d)


def test_valid_committed_dimension_scenarios_parse():
    # league / team / stakes with the correct single override field must parse cleanly
    _contract_with_scenario(
        _ctx_scenario_dict(
            "league",
            {"competition_slug": "eng_premier_league"},
            {"competition_slug": "eng_championship"},
        )
    )
    _contract_with_scenario(
        _ctx_scenario_dict("team", {"team_tier": "elite"}, {"team_tier": "weak"})
    )
    _contract_with_scenario(
        _ctx_scenario_dict(
            "stakes", {"competition_type": "uefa_elite_knockout"}, {"competition_type": "friendly"}
        )
    )


@pytest.mark.parametrize(
    "scenario",
    [
        # unknown field inside high / low
        _ctx_scenario_dict(
            "league",
            {"competition_slug": "eng_premier_league", "foo": 1},
            {"competition_slug": "eng_championship"},
        ),
        _ctx_scenario_dict(
            "league",
            {"competition_slug": "eng_premier_league"},
            {"competition_slug": "eng_championship", "bar": 2},
        ),
        # league scenario carrying team / stakes fields
        _ctx_scenario_dict("league", {"team_tier": "elite"}, {"team_tier": "weak"}),
        _ctx_scenario_dict(
            "league", {"competition_type": "friendly"}, {"competition_type": "uefa_elite_knockout"}
        ),
        # team scenario carrying a league field
        _ctx_scenario_dict(
            "team",
            {"competition_slug": "eng_premier_league"},
            {"competition_slug": "eng_championship"},
        ),
        # stakes scenario carrying league / team fields
        _ctx_scenario_dict(
            "stakes",
            {"competition_slug": "eng_premier_league"},
            {"competition_slug": "eng_championship"},
        ),
        _ctx_scenario_dict("stakes", {"team_tier": "elite"}, {"team_tier": "weak"}),
        # empty high / low value
        _ctx_scenario_dict(
            "league", {"competition_slug": ""}, {"competition_slug": "eng_championship"}
        ),
        _ctx_scenario_dict("league", {}, {"competition_slug": "eng_championship"}),
        # non-string value
        _ctx_scenario_dict("team", {"team_tier": 5}, {"team_tier": "weak"}),
        # NaN / infinite max_ratio
        _ctx_scenario_dict(
            "league",
            {"competition_slug": "eng_premier_league"},
            {"competition_slug": "eng_championship"},
            max_ratio=float("nan"),
        ),
        _ctx_scenario_dict(
            "league",
            {"competition_slug": "eng_premier_league"},
            {"competition_slug": "eng_championship"},
            max_ratio=float("inf"),
        ),
        # missing / empty description
        _ctx_scenario_dict(
            "league",
            {"competition_slug": "eng_premier_league"},
            {"competition_slug": "eng_championship"},
            description="   ",
        ),
    ],
)
def test_reject_malformed_context_ordering(scenario):
    with pytest.raises(ContractError):
        _contract_with_scenario(scenario)


@pytest.mark.parametrize("bad_form", [float("nan"), float("inf"), -0.1, 1.5, 2.0])
def test_reject_bad_recent_form_index(bad_form):
    d = _valid_contract_dict()
    d["scenarios"] = [
        {
            "id": "s",
            "type": "form_gating",
            "description": "d",
            "params": {
                "fixture_id": "goal_first_inside_forward",
                "role": "inside_forward",
                "recent_form_index": bad_form,
            },
        }
    ]
    with pytest.raises(ContractError):
        CalibrationContract.parse(d)


def test_context_ordering_fails_when_only_unrelated_override_moves(suite, engine):
    """Bypassing the parser, a scenario whose declared dimension does NOT move (only an unrelated
    override differs) must FAIL — the pass cannot come from an unrelated field."""
    roles, ctx, ps = engine
    scen = Scenario(
        id="s",
        type="context_ordering",
        description="league unchanged; only team_tier differs",
        params={
            "fixture_id": "two_way_advanced_8",
            "role": "advanced_8",
            "dimension": "league",  # declared dimension
            # league (competition_slug) identical in both -> league multiplier unchanged;
            # only the unrelated team_tier differs and would nudge the final score.
            "high": {"competition_slug": "eng_premier_league", "team_tier": "elite"},
            "low": {"competition_slug": "eng_premier_league", "team_tier": "weak"},
            "max_ratio": 1.5,
        },
    )
    res = evaluate_scenario(scen, suite, roles, ctx, ps, min_minutes=MIN_MINUTES)
    assert res["status"] == "fail"
    assert "not strictly greater" in res["detail"]
