"""Optional, READ-ONLY real-pilot evaluation.

This module never writes to the database and never requires network access, credentials, or a
pre-populated pilot. Real players are resolved through stable source-id provenance
(``PlayerSourceId``), never fuzzy name matching.

Before issuing a pilot ``pass`` or ``fail`` it verifies the evidence is *complete enough* for the
declared expectation:

* the player and season resolve deterministically;
* the player's eligible roles are derived from the production role configs + primary position;
* every eligible role has a current-version ``RoleRating``;
* each of those ratings retains its production ``RatingAudit`` evidence.

Any missing identity, season, eligible-role coverage, current-version rating, or audit yields
``inconclusive`` with a bounded, non-sensitive reason. Missing ratings are never inferred as zero,
and nothing is ever written. CI must never fail because pilot data is unavailable.

The pilot is a Bayer Leverkusen-centered StatsBomb Open Data slice. Every pilot report says so;
it is never described as full Bundesliga, European, or global validation.
"""

from __future__ import annotations

from typing import Callable, Optional

from rolefit import RATING_VERSION, ContextConfig, PlaystyleConfig, load_role_configs

from . import CALIBRATION_VERSION
from .contract import Benchmark, CalibrationContract
from .fixtures import FixtureSuite

PASS, WARN, FAIL, INCONCLUSIVE = "pass", "warn", "fail", "inconclusive"

PILOT_COVERAGE_NOTE = (
    "Real-pilot evaluation is limited to a Bayer Leverkusen-centered StatsBomb Open Data slice "
    "(34 matches, 2023/24). It cannot validate full Bundesliga, European, or global coverage."
)


def _result(bench: Benchmark, status: str, explanation: str, **extra) -> dict:
    base = {
        "benchmark_id": bench.id,
        "kind": "pilot",
        "status": status,
        "evidence_level": bench.evidence_level,
        "expected_primary_role": list(bench.acceptable_primary_roles) or None,
        "actual_primary_role": None,
        "resolved_player_id": None,
        "explanation": explanation,
        "limitations": bench.limitations,
    }
    base.update(extra)
    return base


def _inconclusive(bench: Benchmark, reason: str, **extra) -> dict:
    return _result(bench, INCONCLUSIVE, f"inconclusive — {reason}", **extra)


def _evaluate_one(session, bench: Benchmark, roles: dict) -> dict:
    from app.models.orm import Player, PlayerSourceId, RatingAudit, RoleRating, Season
    from sqlalchemy import select

    if not bench.source_ids:
        return _inconclusive(bench, "no source ids declared for resolution")

    # 1) resolve player by stable source-id provenance (never fuzzy names)
    player_id = None
    for source_name, source_player_id in bench.source_ids:
        row = session.scalar(
            select(PlayerSourceId).where(
                PlayerSourceId.source_name == source_name,
                PlayerSourceId.source_player_id == source_player_id,
            )
        )
        if row is not None:
            player_id = row.player_id
            break
    if player_id is None:
        return _inconclusive(bench, "player identity not found via source-id provenance")

    player = session.get(Player, player_id)
    if player is None:
        return _inconclusive(bench, "resolved player row is absent")

    # 2) resolve season deterministically
    if not bench.season_label:
        return _inconclusive(bench, "no season declared", resolved_player_id=player_id)
    season = session.scalar(select(Season).where(Season.label == bench.season_label))
    if season is None:
        return _inconclusive(
            bench, f"season '{bench.season_label}' not present", resolved_player_id=player_id
        )

    # 3) eligible roles from production role configs + the player's primary position
    position = player.primary_position
    eligible = {r.role_key for r in roles.values() if position and position in r.eligible_positions}
    if not eligible:
        return _inconclusive(
            bench,
            "player has no eligible roles for its primary position",
            resolved_player_id=player_id,
        )

    # 4) require complete current-version eligible RoleRating coverage (read-only)
    ratings = list(
        session.scalars(
            select(RoleRating).where(
                RoleRating.player_id == player_id,
                RoleRating.season_id == season.id,
                RoleRating.version == RATING_VERSION,
            )
        )
    )
    by_role = {r.role_key: r for r in ratings if r.role_key in eligible}
    missing_roles = sorted(eligible - set(by_role))
    if missing_roles:
        return _inconclusive(
            bench,
            f"partial eligible-role coverage ({len(by_role)}/{len(eligible)} current-version "
            f"ratings)",
            resolved_player_id=player_id,
        )

    # 5) require the corresponding production RatingAudit evidence for those ratings
    rating_ids = [r.id for r in by_role.values()]
    audited = set(
        session.scalars(
            select(RatingAudit.role_rating_id).where(RatingAudit.role_rating_id.in_(rating_ids))
        )
    )
    if len(audited) < len(rating_ids):
        return _inconclusive(
            bench,
            f"missing rating-audit evidence ({len(audited)}/{len(rating_ids)} ratings audited)",
            resolved_player_id=player_id,
        )

    # 6) honest pass/fail on complete evidence
    ordered = sorted(by_role.values(), key=lambda r: (-r.final_score, r.role_key))
    top = ordered[0]
    role_scores = [
        {"role_key": r.role_key, "final_score": r.final_score, "confidence": r.confidence}
        for r in ordered
    ]
    acceptable = bench.acceptable_primary_roles
    if not acceptable:
        status, expl = INCONCLUSIVE, "inconclusive — no expected role declared to check"
    elif top.role_key in acceptable:
        status = PASS
        expl = f"top role '{top.role_key}' ({top.final_score}) within expected {list(acceptable)}"
    else:
        status = FAIL
        expl = f"top role '{top.role_key}' ({top.final_score}) not in expected {list(acceptable)}"

    return _result(
        bench,
        status,
        expl,
        resolved_player_id=player_id,
        actual_primary_role=top.role_key,
        role_scores=role_scores,
        eligible_roles=sorted(eligible),
    )


def evaluate_pilot(
    *,
    contract: Optional[CalibrationContract] = None,
    session_factory: Optional[Callable] = None,
) -> dict:
    """Read-only evaluation of pilot benchmarks.

    Cross-validates the contract against the live engine + fixtures first (raises on a malformed
    contract), then reads stored ratings. Returns inconclusive results — never raises — when
    pilot *evidence* is unavailable. ``session_factory`` allows CI tests to inject an isolated
    fixture-backed database instead of the developer's local one.
    """
    contract = contract or CalibrationContract.load()
    roles = load_role_configs()
    # Automatic cross-validation before any evaluation (not test-only).
    contract.validate(
        roles=roles,
        ps_config=PlaystyleConfig.load(),
        fixtures=FixtureSuite.load(),
        ctx_config=ContextConfig.load(),
    )
    pilot_benchmarks = contract.pilot_benchmarks

    results: list = []
    coverage = PILOT_COVERAGE_NOTE
    try:
        from sqlalchemy.exc import SQLAlchemyError

        if session_factory is None:
            from app.core.db import SessionLocal

            session_factory = SessionLocal

        try:
            with session_factory() as session:
                for bench in pilot_benchmarks:
                    try:
                        results.append(_evaluate_one(session, bench, roles))
                    except SQLAlchemyError as exc:
                        results.append(
                            _inconclusive(bench, f"database read failed ({type(exc).__name__})")
                        )
        except SQLAlchemyError as exc:
            coverage = PILOT_COVERAGE_NOTE + f" Local database unavailable ({type(exc).__name__})."
            results = [_inconclusive(b, "database unavailable") for b in pilot_benchmarks]
    except Exception as exc:  # noqa: BLE001 — pilot must never crash the evaluator
        coverage = PILOT_COVERAGE_NOTE + f" Backend unavailable ({type(exc).__name__})."
        results = [_inconclusive(b, "backend unavailable") for b in pilot_benchmarks]

    results.sort(key=lambda r: r["benchmark_id"])
    totals = {PASS: 0, WARN: 0, FAIL: 0, INCONCLUSIVE: 0}
    for r in results:
        totals[r["status"]] += 1
    resolved = sum(1 for r in results if r.get("resolved_player_id"))

    return {
        "suite": "pilot",
        "calibration_version": CALIBRATION_VERSION,
        "suite_id": contract.suite_id,
        "contract_version": contract.version,
        "rating_version": RATING_VERSION,
        "read_only": True,
        "coverage_note": coverage,
        "resolved_players": resolved,
        "overall_status": (
            FAIL
            if totals[FAIL]
            else (PASS if totals[PASS] and not totals[INCONCLUSIVE] else INCONCLUSIVE)
        ),
        "totals": totals,
        "benchmarks": results,
        "limitations": list(contract.limitations) + [PILOT_COVERAGE_NOTE],
    }
