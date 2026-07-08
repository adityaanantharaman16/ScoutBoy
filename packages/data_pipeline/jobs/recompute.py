"""Recompute job — RoleFit ratings, playstyles, market values, similarity.

    python -m data_pipeline.jobs.recompute --ratings --playstyles --market

The three models are interdependent (market needs RoleFit; the inflated-market concern
needs the market label), so the full chain always runs; the flags select which outputs
to persist. Every run is versioned and every score gets an audit row (US-3.8/3.9).
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from typing import Optional

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.orm import (
    Appearance,
    Competition,
    ContextAdjustment,
    MarketValue,
    Player,
    PlayerMetricNormalized,
    PlayerMetricRaw,
    PlayerPlaystyle,
    PlayerUniverseMembership,
    RatingAudit,
    RoleRating,
    Season,
    SimilarityVector,
    Team,
)
from market_model import MarketInputs, estimate_market
from rolefit import (
    PLAYSTYLE_VERSION,
    RATING_VERSION,
    ContextConfig,
    PlaystyleConfig,
    build_audit,
    compute_playstyles,
    compute_role_rating,
    load_role_configs,
)
from scoutboy_shared import is_performance_metric, resolve_metric
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..normalize.context_builder import build_player_context
from ..normalize.metrics_normalizer import normalize_metrics
from ..normalize.mvp_universe import UNIVERSE_KEY, evaluate_membership
from ..quality.checks import run_rating_outlier_check
from ._common import (
    config_hashes,
    finish_run,
    seed_playstyle_definitions,
    seed_role_definitions,
    start_run,
)

MARKET_INPUT_KEYS = {
    "public_value_eur",
    "contract_until",
    "international_caps",
    "hype_index",
    "recent_form_index",
}


def _age(birth: Optional[date], ref: Optional[date]) -> float:
    if not birth or not ref:
        return 21.0
    return round((ref - birth).days / 365.25, 1)


def _clear_season(session: Session, season_id: int) -> None:
    ids = list(session.scalars(select(RoleRating.id).where(RoleRating.season_id == season_id)))
    if ids:
        session.query(RatingAudit).filter(RatingAudit.role_rating_id.in_(ids)).delete(
            synchronize_session=False
        )
    for model in (
        RoleRating,
        PlayerMetricNormalized,
        ContextAdjustment,
        PlayerPlaystyle,
        MarketValue,
        SimilarityVector,
        PlayerUniverseMembership,
    ):
        session.query(model).filter(model.season_id == season_id).delete(synchronize_session=False)


def recompute(session: Session, *, do_ratings=True, do_playstyles=True, do_market=True) -> dict:
    settings = get_settings()
    roles = load_role_configs()
    ctx_config = ContextConfig.load()
    ps_config = PlaystyleConfig.load()

    run = start_run(
        session, "recompute", RATING_VERSION, [], config_hashes(roles, ctx_config, ps_config)
    )
    seed_role_definitions(session, roles)
    seed_playstyle_definitions(session, ps_config)

    seasons = list(session.scalars(select(Season)))
    all_final_scores: list[float] = []
    affected = 0

    for season in seasons:
        appearances = list(
            session.scalars(select(Appearance).where(Appearance.season_id == season.id))
        )
        if not appearances:
            continue
        _clear_season(session, season.id)

        # aggregate one primary context + total minutes per player
        primary: dict[int, Appearance] = {}
        minutes: dict[int, int] = {}
        for a in appearances:
            minutes[a.player_id] = minutes.get(a.player_id, 0) + (a.minutes or 0)
            if a.player_id not in primary or (a.minutes or 0) > (primary[a.player_id].minutes or 0):
                primary[a.player_id] = a

        players = {
            p.id: p for p in session.scalars(select(Player).where(Player.id.in_(list(primary))))
        }
        pg_by_player = {pid: (primary[pid].position_group or "") for pid in primary}

        # raw metrics per player for this season
        raw_rows = session.scalars(
            select(PlayerMetricRaw).where(PlayerMetricRaw.season_id == season.id)
        )
        raw: dict[int, dict[str, float]] = {}
        for r in raw_rows:
            if r.metric_value is not None:
                raw.setdefault(r.player_id, {})[r.metric_name] = r.metric_value

        # Resolve raw metric names (canonical or legacy alias) to canonical performance
        # metrics; market inputs / unknown names resolve to None and are excluded here.
        registry_raw: dict[int, dict[str, float]] = {}
        for pid in primary:
            resolved: dict[str, float] = {}
            for name, val in raw.get(pid, {}).items():
                canonical = resolve_metric(name)
                if canonical and is_performance_metric(canonical):
                    resolved[canonical] = val
            registry_raw[pid] = resolved

        # normalize within peer groups
        normalized = normalize_metrics(registry_raw, pg_by_player, minutes)
        perc: dict[int, dict[str, float]] = {pid: {} for pid in primary}
        for nm in normalized:
            session.add(
                PlayerMetricNormalized(
                    player_id=nm.player_key,
                    season_id=season.id,
                    peer_group=nm.peer_group,
                    metric_name=nm.metric_name,
                    per90_value=nm.per90_value,
                    percentile=nm.percentile,
                    z_score=nm.z_score,
                    confidence=nm.confidence,
                )
            )
            if nm.percentile is not None:
                perc[nm.player_key][nm.metric_name] = nm.percentile

        comp_by_id = {c.id: c for c in session.scalars(select(Competition))}
        team_by_id = {t.id: t for t in session.scalars(select(Team))}

        role_scores_by_player: dict[int, list[tuple[str, float]]] = {}
        market_label_by_player: dict[int, Optional[str]] = {}
        translation_by_player: dict[int, str] = {}

        for pid in primary:
            player = players[pid]
            appr = primary[pid]
            comp = comp_by_id.get(appr.competition_id)
            team = team_by_id.get(appr.team_id)
            pg = pg_by_player[pid]
            mins = minutes[pid]
            form = raw.get(pid, {}).get("recent_form_index")

            context = build_player_context(
                ctx_config,
                competition_slug=comp.slug if comp else None,
                competition_type=comp.competition_type if comp else None,
                team_slug=team.slug if team else None,
                minutes=mins,
                recent_form_index=form,
            )
            translation_by_player[pid] = context.translation_risk
            session.add(
                ContextAdjustment(
                    player_id=pid,
                    season_id=season.id,
                    league_strength=context.multipliers["league_strength"],
                    team_strength=context.multipliers["team_strength"],
                    opposition_quality=context.multipliers["opposition_quality"],
                    competition_stakes=context.multipliers["competition_stakes"],
                    role_usage=context.multipliers["role_usage"],
                    sample_reliability=context.multipliers["sample_reliability"],
                    context_confidence=context.sample_confidence,
                    explanation_json=context.explanation,
                )
            )

            # ratings for every role in the player's position group
            scores: list[tuple[str, float]] = []
            for role in roles.values():
                if role.position_group != pg:
                    continue
                result = compute_role_rating(
                    role, perc[pid], context, minutes=mins, min_minutes=settings.min_minutes
                )
                audit = build_audit(result)
                rr = RoleRating(
                    player_id=pid,
                    role_key=role.role_key,
                    season_id=season.id,
                    version=RATING_VERSION,
                    raw_score=result.raw_score,
                    context_adjusted_score=result.context_adjusted_score,
                    final_score=result.final_score,
                    confidence=result.confidence.level.value,
                )
                session.add(rr)
                session.flush()
                session.add(RatingAudit(role_rating_id=rr.id, **audit))
                scores.append((role.role_key, result.final_score))
                all_final_scores.append(result.final_score)
            scores.sort(key=lambda x: x[1], reverse=True)
            role_scores_by_player[pid] = scores

            # market
            best = scores[0][1] if scores else None
            top3 = [s for _, s in scores[:3]]
            avg_top3 = round(sum(top3) / len(top3), 2) if top3 else None
            contract_until = raw.get(pid, {}).get("contract_until")
            years_left = None
            if contract_until is not None:
                end_year = season.end_date.year if season.end_date else 2024
                years_left = max(0.0, float(contract_until) - end_year)
            caps = raw.get(pid, {}).get("international_caps")
            estimate = estimate_market(
                MarketInputs(
                    age=_age(player.birth_date, season.end_date),
                    position=player.primary_position or "CM",
                    position_group=pg or "MID",
                    minutes=mins,
                    best_rolefit=best,
                    avg_top3_rolefit=avg_top3,
                    league_multiplier=context.multipliers["league_strength"],
                    team_tier=context.team_tier,
                    public_value_eur=raw.get(pid, {}).get("public_value_eur"),
                    recent_form_index=form,
                    international_caps=int(caps) if caps is not None else None,
                    contract_years_remaining=years_left,
                    hype_index=raw.get(pid, {}).get("hype_index"),
                )
            )
            market_label_by_player[pid] = estimate.label
            session.add(MarketValue(player_id=pid, season_id=season.id, **estimate.to_dict()))

            # MVP-universe membership (non-destructive filter)
            verdict = evaluate_membership(
                age=_age(player.birth_date, season.end_date),
                position_group=pg,
                minutes=mins,
                is_european=comp.is_european if comp else None,
                min_minutes=settings.min_minutes,
            )
            session.add(
                PlayerUniverseMembership(
                    player_id=pid,
                    season_id=season.id,
                    universe_key=UNIVERSE_KEY,
                    eligible=verdict.eligible,
                    reasons_json=verdict.reasons,
                )
            )
            affected += 1

        # playstyles (need market label + translation risk)
        for pid in primary:
            badges = compute_playstyles(
                perc[pid],
                position_group=pg_by_player[pid],
                minutes=minutes[pid],
                config=ps_config,
                translation_risk=translation_by_player.get(pid),
                market_label=market_label_by_player.get(pid),
            )
            for b in badges:
                d = b.to_dict()
                session.add(
                    PlayerPlaystyle(
                        player_id=pid,
                        season_id=season.id,
                        playstyle_key=d["playstyle_key"],
                        tier=d["tier"],
                        confidence=d["confidence"],
                        is_concern=d["is_concern"],
                        why_applied_json=d["why_applied_json"],
                        version=PLAYSTYLE_VERSION,
                    )
                )
            # similarity vectors
            session.add(
                SimilarityVector(
                    player_id=pid,
                    season_id=season.id,
                    vector_type="style",
                    vector_json=perc[pid],
                    version=RATING_VERSION,
                )
            )
            session.add(
                SimilarityVector(
                    player_id=pid,
                    season_id=season.id,
                    vector_type="quality",
                    vector_json=dict(role_scores_by_player.get(pid, [])),
                    version=RATING_VERSION,
                )
            )

        # ranks within peer group per role
        _assign_ranks(session, season.id, roles, pg_by_player)

    finish_run(session, run, affected)
    session.commit()

    outlier = run_rating_outlier_check(all_final_scores)
    return {
        "run_id": run.id,
        "affected": affected,
        "seasons": len(seasons),
        "outlier_check": outlier,
    }


def _assign_ranks(session: Session, season_id: int, roles: dict, pg_by_player: dict) -> None:
    ratings = list(session.scalars(select(RoleRating).where(RoleRating.season_id == season_id)))
    by_role: dict[str, list[RoleRating]] = {}
    for r in ratings:
        by_role.setdefault(r.role_key, []).append(r)
    for rows in by_role.values():
        # deterministic: final desc, then player_id asc
        rows.sort(key=lambda r: (-r.final_score, r.player_id))
        for i, r in enumerate(rows, start=1):
            r.rank_in_peer_group = i


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ScoutBoy recompute")
    parser.add_argument("--ratings", action="store_true")
    parser.add_argument("--playstyles", action="store_true")
    parser.add_argument("--market", action="store_true")
    args = parser.parse_args(argv)
    # default: everything
    do_all = not (args.ratings or args.playstyles or args.market)
    with SessionLocal() as session:
        result = recompute(
            session,
            do_ratings=do_all or args.ratings,
            do_playstyles=do_all or args.playstyles,
            do_market=do_all or args.market,
        )
    print(
        f"Recompute complete (run {result['run_id']}): {result['affected']} players "
        f"across {result['seasons']} season(s). Outlier check: "
        f"{result['outlier_check']['severity']} ({result['outlier_check']['count']})."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
