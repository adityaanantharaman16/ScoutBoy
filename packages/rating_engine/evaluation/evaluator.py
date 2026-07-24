"""Deterministic fixture + scenario evaluation.

For every benchmark and guardrail scenario this produces a structured, JSON-serializable
verdict distinguishing the four honest outcomes:

    pass          expectation satisfied
    warn          borderline / partially supported
    fail          sufficient evidence contradicts the expectation
    inconclusive  evidence is unavailable or insufficient

The evaluator reuses the production RoleFit engine through ``fixtures.score_benchmark`` —
it never re-implements scoring. Output ordering and rounding are fixed so two runs are
byte-identical.
"""

from __future__ import annotations

from typing import Optional

from rolefit import (
    RATING_VERSION,
    ContextConfig,
    PlaystyleConfig,
    compute_playstyles,
    load_role_configs,
)
from scoutboy_shared import DEFAULT_MIN_MINUTES

from . import CALIBRATION_VERSION
from .contract import (
    TIER_RANK,
    Benchmark,
    CalibrationContract,
    Scenario,
    confidence_rank,
)
from .fixtures import FixtureSuite, ScoredBenchmark, score_benchmark

PASS, WARN, FAIL, INCONCLUSIVE = "pass", "warn", "fail", "inconclusive"
_SEVERITY = {PASS: 0, INCONCLUSIVE: 1, WARN: 2, FAIL: 3}


def _aggregate(statuses: list) -> str:
    if not statuses:
        return INCONCLUSIVE
    return max(statuses, key=lambda s: _SEVERITY[s])


def _check(name: str, status: str, detail: str) -> dict:
    return {"name": name, "status": status, "detail": detail}


# --------------------------------------------------------------------------- config hashes
def config_hashes(
    roles: dict,
    ctx: ContextConfig,
    ps: PlaystyleConfig,
    fixtures: FixtureSuite,
    contract: CalibrationContract,
) -> dict:
    return {
        "roles": {k: r.config_hash for k, r in sorted(roles.items())},
        "context": ctx.config_hash,
        "playstyles": ps.config_hash,
        "fixtures": fixtures.config_hash,
        "contract": contract.config_hash,
    }


# --------------------------------------------------------------------------- benchmark checks
def _check_primary_role(bench: Benchmark, scored: ScoredBenchmark) -> Optional[dict]:
    acceptable = bench.acceptable_primary_roles
    if not acceptable:
        return None
    actual = scored.primary_role
    if actual is None:
        return _check("primary_role", INCONCLUSIVE, "No eligible role was scored.")
    if actual in acceptable:
        return _check("primary_role", PASS, f"Primary role '{actual}' as expected.")
    return _check(
        "primary_role",
        FAIL,
        f"Primary role '{actual}' not in expected {list(acceptable)}.",
    )


def _check_role_ordering(bench: Benchmark, scored: ScoredBenchmark) -> list:
    out = []
    for ordering in bench.role_ordering:
        hi = scored.role_score(ordering.higher)
        lo = scored.role_score(ordering.lower)
        name = f"order:{ordering.higher}>{ordering.lower}"
        if hi is None or lo is None:
            out.append(_check(name, INCONCLUSIVE, "One of the roles was not scored."))
            continue
        diff = round(hi.final_score - lo.final_score, 3)
        if diff > 0:
            out.append(_check(name, PASS, f"{hi.final_score} > {lo.final_score} (+{diff})."))
        elif diff == 0:
            out.append(_check(name, WARN, f"Tie at {hi.final_score}."))
        else:
            out.append(_check(name, FAIL, f"{hi.final_score} < {lo.final_score} ({diff})."))
    return out


def _check_playstyles(bench: Benchmark, scored: ScoredBenchmark) -> list:
    by_key = {b.playstyle_key: b for b in scored.playstyles if not b.is_concern}
    out = []
    for exp in bench.expected_playstyles:
        name = f"playstyle:{exp.key}"
        badge = by_key.get(exp.key)
        if exp.present:
            if badge is None:
                out.append(_check(name, FAIL, "Expected playstyle not applied."))
            elif exp.min_tier and TIER_RANK.get(badge.tier, 0) < TIER_RANK.get(exp.min_tier, 0):
                out.append(_check(name, WARN, f"Applied at '{badge.tier}' < '{exp.min_tier}'."))
            else:
                out.append(_check(name, PASS, f"Applied at '{badge.tier}'."))
        else:
            if badge is None:
                out.append(_check(name, PASS, "Correctly absent."))
            else:
                out.append(_check(name, FAIL, f"Unexpectedly applied at '{badge.tier}'."))
    return out


def _check_concerns(bench: Benchmark, scored: ScoredBenchmark) -> list:
    keys = {b.playstyle_key for b in scored.playstyles if b.is_concern}
    out = []
    for exp in bench.expected_concerns:
        name = f"concern:{exp.key}"
        present = exp.key in keys
        if exp.present and present:
            out.append(_check(name, PASS, "Concern present as expected."))
        elif exp.present and not present:
            out.append(_check(name, FAIL, "Expected concern not triggered."))
        elif not exp.present and not present:
            out.append(_check(name, PASS, "Correctly not triggered."))
        else:
            out.append(_check(name, FAIL, "Concern unexpectedly triggered."))
    return out


def _check_confidence(bench: Benchmark, scored: ScoredBenchmark) -> Optional[dict]:
    exp = bench.confidence
    if exp is None:
        return None
    role_key = exp.role or scored.primary_role
    rs = scored.role_score(role_key) if role_key else None
    if rs is None:
        return _check("confidence", INCONCLUSIVE, f"Role '{role_key}' was not scored.")
    level = rs.confidence_level
    problems = []
    if exp.min_level and confidence_rank(level) < confidence_rank(exp.min_level):
        problems.append(f"level '{level}' below min '{exp.min_level}'")
    if exp.max_level and confidence_rank(level) > confidence_rank(exp.max_level):
        problems.append(f"level '{level}' above max '{exp.max_level}'")
    if exp.expect_missing_required is not None:
        missing = rs.result.confidence.missing_required
        if exp.expect_missing_required and not missing:
            problems.append("expected missing required metrics, found none")
        if not exp.expect_missing_required and missing:
            problems.append(f"unexpected missing required: {list(missing)}")
    detail = f"{role_key}: {level} confidence"
    if problems:
        return _check("confidence", FAIL, detail + " — " + "; ".join(problems) + ".")
    return _check("confidence", PASS, detail + " within expectation.")


def _check_translation(bench: Benchmark, scored: ScoredBenchmark) -> Optional[dict]:
    if bench.expected_translation_risk is None:
        return None
    actual = scored.translation_risk
    if actual == bench.expected_translation_risk:
        return _check("translation_risk", PASS, f"Translation risk '{actual}' as expected.")
    return _check(
        "translation_risk",
        FAIL,
        f"Translation risk '{actual}' != expected '{bench.expected_translation_risk}'.",
    )


def _context_results(scored: ScoredBenchmark) -> dict:
    rs = scored.role_score(scored.primary_role) if scored.primary_role else None
    if rs is None:
        return {}
    ctx = rs.result.context
    return {
        "role": scored.primary_role,
        "combined_multiplier": ctx.combined_multiplier,
        "multipliers": ctx.multipliers,
        "translation_risk": ctx.translation_risk,
        "form_bonus": ctx.form_bonus,
    }


def evaluate_fixture_benchmark(
    bench: Benchmark,
    suite: FixtureSuite,
    roles: dict,
    ctx: ContextConfig,
    ps: PlaystyleConfig,
    *,
    min_minutes: int,
) -> dict:
    if bench.id not in suite.players:
        return _benchmark_result(
            bench,
            INCONCLUSIVE,
            actual_primary=None,
            checks=[_check("fixture", INCONCLUSIVE, "No fixture data.")],
            scored=None,
        )
    scored = score_benchmark(suite, bench.id, roles, ctx, ps, min_minutes=min_minutes)
    checks: list = []
    for maybe in (
        _check_primary_role(bench, scored),
        *_check_role_ordering(bench, scored),
        *_check_playstyles(bench, scored),
        *_check_concerns(bench, scored),
        _check_confidence(bench, scored),
        _check_translation(bench, scored),
    ):
        if maybe:
            checks.append(maybe)
    status = _aggregate([c["status"] for c in checks])
    # An inconclusive-only outcome on a benchmark that allows it stays inconclusive (not fail).
    return _benchmark_result(bench, status, scored.primary_role, checks, scored)


def _benchmark_result(
    bench: Benchmark, status: str, actual_primary, checks: list, scored: Optional[ScoredBenchmark]
) -> dict:
    role_scores = (
        [
            {
                "role_key": rs.role_key,
                "final_score": rs.final_score,
                "confidence": rs.confidence_level,
                # Deterministic audit trail from the production build_audit() (US-3.8/3.9 parity).
                "audit": rs.audit,
            }
            for rs in scored.role_scores
        ]
        if scored
        else []
    )
    return {
        "benchmark_id": bench.id,
        "kind": bench.kind,
        "status": status,
        "evidence_level": bench.evidence_level,
        "expected_primary_role": list(bench.acceptable_primary_roles) or None,
        "actual_primary_role": actual_primary,
        "role_scores": role_scores,
        "role_ordering_results": [c for c in checks if c["name"].startswith("order:")],
        "playstyle_results": [c for c in checks if c["name"].startswith("playstyle:")],
        "concern_results": [c for c in checks if c["name"].startswith("concern:")],
        "confidence_result": next((c for c in checks if c["name"] == "confidence"), None),
        "context_results": _context_results(scored) if scored else {},
        "inconclusive_allowed": bench.inconclusive_allowed,
        "checks": checks,
        "explanation": _explain(bench, status, checks),
        "limitations": bench.limitations,
    }


def _explain(bench: Benchmark, status: str, checks: list) -> str:
    bad = [c for c in checks if c["status"] in (FAIL, WARN)]
    if status == PASS:
        return f"All {len(checks)} checks satisfied for '{bench.id}'."
    if status == INCONCLUSIVE:
        return f"'{bench.id}' inconclusive: insufficient evidence for a verdict."
    lead = "FAILED" if status == FAIL else "borderline"
    return f"'{bench.id}' {lead}: " + " ".join(f"[{c['name']}] {c['detail']}" for c in bad)


# --------------------------------------------------------------------------- scenarios
def evaluate_scenario(
    scen: Scenario,
    suite: FixtureSuite,
    roles: dict,
    ctx: ContextConfig,
    ps: PlaystyleConfig,
    *,
    min_minutes: int,
) -> dict:
    handler = _SCENARIO_HANDLERS.get(scen.type)
    if handler is None:
        status, detail = INCONCLUSIVE, f"No handler for scenario type '{scen.type}'."
    else:
        status, detail = handler(scen.params, suite, roles, ctx, ps, min_minutes)
    return {
        "scenario_id": scen.id,
        "type": scen.type,
        "status": status,
        "description": scen.description,
        "detail": detail,
    }


_DIMENSION_MULTIPLIER = {
    "league": "league_strength",
    "team": "team_strength",
    "stakes": "competition_stakes",
}


def _combined_multiplier_bounds(ctx: ContextConfig) -> tuple:
    """Mathematically achievable [min, max] combined context multiplier from the config bands
    (role_usage is nominal 1.0 in calibration). Used to prove context impact stays bounded."""
    lb, tb, sb = ctx.league["band"], ctx.team["band"], ctx.stakes["band"]
    ob = ctx.sample["opposition_proxy"]["band"]
    mb = ctx.sample["band"]
    gmax = (
        float(lb["max"]) * float(tb["max"]) * float(ob["max"]) * float(sb["max"]) * float(mb["max"])
    )
    gmin = (
        float(lb["min"]) * float(tb["min"]) * float(ob["min"]) * float(sb["min"]) * float(mb["min"])
    )
    return gmin, gmax


def _sc_context_ordering(params, suite, roles, ctx, ps, min_minutes):
    fid, role = params["fixture_id"], params["role"]
    dimension, max_ratio = params["dimension"], float(params["max_ratio"])
    hi = score_benchmark(
        suite, fid, roles, ctx, ps, min_minutes=min_minutes, context_override=params["high"]
    ).role_score(role)
    lo = score_benchmark(
        suite, fid, roles, ctx, ps, min_minutes=min_minutes, context_override=params["low"]
    ).role_score(role)
    if hi is None or lo is None:
        return INCONCLUSIVE, f"Role '{role}' not scored under one environment."

    eps = 1e-6
    gmin, gmax = _combined_multiplier_bounds(ctx)
    hc = hi.result.context.combined_multiplier
    lc = lo.result.context.combined_multiplier
    if not (gmin - eps <= lc <= gmax + eps and gmin - eps <= hc <= gmax + eps):
        return FAIL, (
            f"{role}: combined multiplier outside configured band "
            f"[{gmin:.3f}, {gmax:.3f}] (hi={hc}, lo={lc})."
        )
    # The declared dimension's multiplier must be STRICTLY greater under `high` than `low`, so a
    # pass can only come from the declared dimension moving — never from an unrelated override
    # nudging the final score while the dimension itself was unchanged.
    mkey = _DIMENSION_MULTIPLIER[dimension]
    hi_mult = hi.result.context.multipliers[mkey]
    lo_mult = lo.result.context.multipliers[mkey]
    if hi_mult <= lo_mult:
        return FAIL, (
            f"{role}: {dimension} multiplier not strictly greater under 'high' "
            f"(hi {hi_mult} <= lo {lo_mult})."
        )
    if hi.final_score <= lo.final_score:
        return (
            FAIL,
            f"{role}: stronger {hi.final_score} !> weaker {lo.final_score} (no/rev effect).",
        )
    if lo.final_score <= 0:
        return FAIL, f"{role}: weaker environment scored 0 (production erased)."
    ratio = hc / lc if lc else float("inf")
    if ratio > max_ratio + eps:
        return FAIL, (
            f"{role}: combined-multiplier ratio {ratio:.3f} exceeds configured max {max_ratio}."
        )
    return PASS, (
        f"{role}: {hi.final_score} > {lo.final_score}, production not erased, "
        f"ratio {ratio:.3f} ≤ {max_ratio} within band [{gmin:.3f}, {gmax:.3f}]."
    )


def _sc_minutes_monotonicity(params, suite, roles, ctx, ps, min_minutes):
    fid, role = params["fixture_id"], params["role"]
    scores = []
    for m in params["minutes_ladder"]:
        rs = score_benchmark(
            suite, fid, roles, ctx, ps, min_minutes=min_minutes, minutes_override=m
        ).role_score(role)
        if rs is None:
            return INCONCLUSIVE, f"Role '{role}' not scored at {m} minutes."
        scores.append((m, rs.confidence_score))
    ok = all(b[1] >= a[1] - 1e-9 for a, b in zip(scores, scores[1:]))
    seq = ", ".join(f"{m}→{c:.3f}" for m, c in scores)
    return (PASS if ok else FAIL), f"Confidence vs minutes: {seq}."


def _sc_form_gating(params, suite, roles, ctx, ps, min_minutes):
    fid, role = params["fixture_id"], params["role"]
    form = float(params["recent_form_index"])
    small = score_benchmark(
        suite,
        fid,
        roles,
        ctx,
        ps,
        min_minutes=min_minutes,
        minutes_override=200,
        context_override={"recent_form_index": form},
    ).role_score(role)
    reliable = score_benchmark(
        suite,
        fid,
        roles,
        ctx,
        ps,
        min_minutes=min_minutes,
        minutes_override=2000,
        context_override={"recent_form_index": form},
    ).role_score(role)
    if small is None or reliable is None:
        return INCONCLUSIVE, f"Role '{role}' not scored."
    sb, rb = small.result.form_bonus, reliable.result.form_bonus
    max_points = float(ctx.sample["form_bonus"]["max_points"])
    # Below the configured confidence floor (200 min -> low sample) the bonus must be exactly 0.
    if sb != 0.0:
        return FAIL, f"Below-threshold sample form bonus is {sb}, expected 0 (gating failed)."
    # At/above the floor (2000 min -> high sample) the bonus must be positive and within the cap.
    if not (0.0 < rb <= max_points + 1e-9):
        return FAIL, f"Reliable-sample form bonus {rb} not in (0, {max_points}]."
    return PASS, (
        f"Form gated by confidence floor: small-sample bonus {sb} (=0), "
        f"reliable-sample bonus {rb} within cap {max_points}."
    )


def _sc_confidence_bounds(params, suite, roles, ctx, ps, min_minutes):
    for fid in suite.benchmark_ids:
        scored = score_benchmark(suite, fid, roles, ctx, ps, min_minutes=min_minutes)
        for rs in scored.role_scores:
            if not (0.0 <= rs.confidence_score <= 1.0):
                return FAIL, f"{fid}/{rs.role_key} confidence {rs.confidence_score} out of [0,1]."
    return PASS, "All fixture confidence scores within [0, 1]."


def _sc_playstyle_tiers(params, suite, roles, ctx, ps, min_minutes):
    pg, key, metric = params["position_group"], params["playstyle_key"], params["metric"]
    tiers = {"base": 0.75, "plus": 0.90, "elite": 0.95}
    for p in ps.positives:
        if p["key"] == key:
            tiers = p.get("tiers", ps.positive_defaults.get("tiers", tiers))
    checks = []
    for expected_tier, pct in (
        ("base", tiers["base"]),
        ("plus", tiers["plus"]),
        ("elite", tiers["elite"]),
        (None, round(tiers["base"] - 0.01, 4)),
    ):
        badges = compute_playstyles({metric: pct}, position_group=pg, minutes=1800, config=ps)
        got = next((b.tier for b in badges if b.playstyle_key == key), None)
        checks.append((pct, expected_tier, got))
    ok = all(exp == got for _, exp, got in checks)
    seq = ", ".join(f"{pct}→{got}" for pct, _, got in checks)
    return (PASS if ok else FAIL), f"{key} tiers at thresholds: {seq}."


def _sc_concern_boundary(params, suite, roles, ctx, ps, min_minutes):
    pg, key, metric = params["position_group"], params["concern_key"], params["metric"]
    threshold = None
    for c in ps.concerns:
        if c["key"] == key:
            threshold = float(c["percentile_threshold"])
    if threshold is None:
        return INCONCLUSIVE, f"Concern '{key}' not found or not a low-percentile concern."
    inside = compute_playstyles({metric: threshold}, position_group=pg, minutes=1800, config=ps)
    outside = compute_playstyles(
        {metric: round(threshold + 0.05, 4)}, position_group=pg, minutes=1800, config=ps
    )
    trig_in = any(b.playstyle_key == key and b.is_concern for b in inside)
    trig_out = any(b.playstyle_key == key and b.is_concern for b in outside)
    if trig_in and not trig_out:
        return PASS, f"{key} triggers at {threshold}, not at {round(threshold + 0.05, 4)}."
    return FAIL, f"{key} boundary wrong: inside={trig_in}, outside={trig_out}."


def _sc_deterministic_ordering(params, suite, roles, ctx, ps, min_minutes):
    for fid in suite.benchmark_ids:
        a = score_benchmark(suite, fid, roles, ctx, ps, min_minutes=min_minutes)
        b = score_benchmark(suite, fid, roles, ctx, ps, min_minutes=min_minutes)
        seq_a = [(rs.role_key, rs.final_score) for rs in a.role_scores]
        seq_b = [(rs.role_key, rs.final_score) for rs in b.role_scores]
        if seq_a != seq_b:
            return FAIL, f"{fid} ordering not deterministic."
    return PASS, "All fixtures re-score to identical ordering and scores."


_SCENARIO_HANDLERS = {
    "context_ordering": _sc_context_ordering,
    "minutes_monotonicity": _sc_minutes_monotonicity,
    "form_gating": _sc_form_gating,
    "confidence_bounds": _sc_confidence_bounds,
    "playstyle_tiers": _sc_playstyle_tiers,
    "concern_boundary": _sc_concern_boundary,
    "deterministic_ordering": _sc_deterministic_ordering,
}


# --------------------------------------------------------------------------- suite driver
def _totals(results: list) -> dict:
    totals = {PASS: 0, WARN: 0, FAIL: 0, INCONCLUSIVE: 0}
    for r in results:
        totals[r["status"]] += 1
    return totals


def evaluate_fixtures(
    *,
    min_minutes: Optional[int] = None,
    contract: Optional[CalibrationContract] = None,
    suite: Optional[FixtureSuite] = None,
) -> dict:
    """Evaluate every fixture benchmark + scenario. No DB, no network."""
    min_minutes = DEFAULT_MIN_MINUTES if min_minutes is None else min_minutes
    contract = contract or CalibrationContract.load()
    suite = suite or FixtureSuite.load()
    roles = load_role_configs()
    ctx = ContextConfig.load()
    ps = PlaystyleConfig.load()
    # Full cross-validation runs automatically before any evaluation (not test-only).
    contract.validate(roles=roles, ps_config=ps, fixtures=suite, ctx_config=ctx)

    bench_results = [
        evaluate_fixture_benchmark(b, suite, roles, ctx, ps, min_minutes=min_minutes)
        for b in contract.fixture_benchmarks
    ]
    scenario_results = [
        evaluate_scenario(s, suite, roles, ctx, ps, min_minutes=min_minutes)
        for s in contract.scenarios
    ]
    bench_results.sort(key=lambda r: r["benchmark_id"])
    scenario_results.sort(key=lambda r: r["scenario_id"])
    all_statuses = [r["status"] for r in bench_results] + [r["status"] for r in scenario_results]

    failing = [r["benchmark_id"] for r in bench_results if r["status"] == FAIL]
    failing += [r["scenario_id"] for r in scenario_results if r["status"] == FAIL]

    # A green gate requires no fail AND no *unexpected* inconclusive. An allowed inconclusive
    # (inconclusive_allowed benchmark) is non-blocking; every other inconclusive — including any
    # scenario inconclusive — blocks the gate without being mislabeled as an evidentiary fail.
    blocking = [r["benchmark_id"] for r in bench_results if r["status"] == FAIL]
    blocking += [
        r["benchmark_id"]
        for r in bench_results
        if r["status"] == INCONCLUSIVE and not r.get("inconclusive_allowed", False)
    ]
    blocking += [r["scenario_id"] for r in scenario_results if r["status"] in (FAIL, INCONCLUSIVE)]

    return {
        "suite": "fixtures",
        "calibration_version": CALIBRATION_VERSION,
        "suite_id": contract.suite_id,
        "contract_version": contract.version,
        "rating_version": RATING_VERSION,
        "min_minutes": min_minutes,
        "config_hashes": config_hashes(roles, ctx, ps, suite, contract),
        "overall_status": _aggregate(all_statuses) if all_statuses else INCONCLUSIVE,
        "gate_passed": not blocking,
        "totals": {
            "benchmarks": _totals(bench_results),
            "scenarios": _totals(scenario_results),
        },
        "failing": sorted(failing),
        "blocking": sorted(blocking),
        "benchmarks": bench_results,
        "scenarios": scenario_results,
        "limitations": list(contract.limitations),
    }
