"""Shared assembly helpers used across services. Pure translation from ORM rows to
API schemas — no scoring logic lives here (that is in the domain packages)."""

from __future__ import annotations

from datetime import date
from functools import lru_cache
from typing import Optional

from rolefit import PlaystyleConfig, load_role_configs
from scoutboy_shared import FACE_STAT_GROUPS, metric_meta

from app.models.orm import (
    ContextAdjustment,
    MarketValue,
    PlayerEvidenceConfidence,
    PlayerMetricNormalized,
    Provider,
    RoleRating,
    SourceSnapshot,
)
from app.models.schemas import (
    ContextPanel,
    FaceStat,
    MarketPanel,
    PlaystyleBadge,
    RoleRatingSummary,
    SubStat,
)

_CONF_ORDER = {"unknown": 0, "low": 1, "medium": 2, "high": 3}
_TIER_ORDER = {"elite": 3, "plus": 2, "base": 1, None: 0}


@lru_cache
def role_display_map() -> dict[str, str]:
    return {k: v.display_name for k, v in load_role_configs().items()}


@lru_cache
def playstyle_meta_map() -> dict[str, dict]:
    cfg = PlaystyleConfig.load()
    out: dict[str, dict] = {}
    for p in cfg.positives:
        out[p["key"]] = {
            "display_name": p["display_name"],
            "category": p.get("category", "general"),
        }
    for c in cfg.concerns:
        out[c["key"]] = {"display_name": c["display_name"], "category": c.get("category", "risk")}
    return out


def age_for(birth: Optional[date], season_end: Optional[date]) -> Optional[float]:
    if not birth or not season_end:
        return None
    return round((season_end - birth).days / 365.25, 1)


def substats_from_normalized(rows: list[PlayerMetricNormalized]) -> list[SubStat]:
    out: list[SubStat] = []
    for r in rows:
        meta = metric_meta(r.metric_name)
        if meta is None:
            continue
        out.append(
            SubStat(
                name=r.metric_name,
                display=meta.display,
                unit=meta.unit,
                per90_value=r.per90_value,
                percentile=r.percentile,
                score=round(r.percentile * 100, 1) if r.percentile is not None else None,
                present=r.per90_value is not None,
            )
        )
    out.sort(key=lambda s: s.name)
    return out


def face_stats_from_substats(substats: list[SubStat], sample_confidence: str) -> list[FaceStat]:
    by_group: dict[str, list[SubStat]] = {}
    for s in substats:
        meta = metric_meta(s.name)
        if meta:
            by_group.setdefault(meta.face_group, []).append(s)
    faces: list[FaceStat] = []
    for group_key, label in FACE_STAT_GROUPS.items():
        metrics = by_group.get(group_key, [])
        scores = [m.score for m in metrics if m.score is not None]
        faces.append(
            FaceStat(
                group_key=group_key,
                group_label=label,
                score=round(sum(scores) / len(scores), 1) if scores else None,
                confidence=sample_confidence if scores else "unknown",
                metrics=metrics,
            )
        )
    return faces


def role_summaries(ratings: list[RoleRating]) -> list[RoleRatingSummary]:
    names = role_display_map()
    ranked = sorted(ratings, key=lambda r: (-r.final_score, r.role_key))
    best_key = ranked[0].role_key if ranked else None
    out = []
    for r in ranked:
        out.append(
            RoleRatingSummary(
                role_key=r.role_key,
                display_name=names.get(r.role_key, r.role_key),
                final_score=r.final_score,
                raw_score=r.raw_score,
                context_adjusted_score=r.context_adjusted_score,
                confidence=r.confidence,
                rank_in_peer_group=r.rank_in_peer_group,
                is_best=(r.role_key == best_key),
            )
        )
    return out


def best_rating(ratings: list[RoleRating]) -> Optional[RoleRating]:
    if not ratings:
        return None
    return sorted(ratings, key=lambda r: (-r.final_score, r.role_key))[0]


def playstyle_badges(playstyles) -> tuple[list[PlaystyleBadge], list[PlaystyleBadge]]:
    positives, concerns = [], []
    meta = playstyle_meta_map()
    for p in playstyles:
        m = meta.get(p.playstyle_key, {})
        badge = PlaystyleBadge(
            playstyle_key=p.playstyle_key,
            display_name=m.get("display_name", p.playstyle_key.replace("_", " ").title()),
            category=m.get("category", "risk" if p.is_concern else "general"),
            tier=p.tier,
            confidence=p.confidence,
            is_concern=p.is_concern,
            why_applied=p.why_applied_json or {},
            supporting_metrics=(p.why_applied_json or {}).get("supporting_metrics", []),
        )
        (concerns if p.is_concern else positives).append(badge)
    positives.sort(key=lambda b: (-_TIER_ORDER.get(b.tier, 0), b.display_name))
    return positives, concerns


def top_playstyle_names(playstyles, limit: int = 3) -> list[str]:
    positives, _ = playstyle_badges(playstyles)
    return [b.display_name for b in positives[:limit]]


def context_panel(
    ctx: Optional[ContextAdjustment],
    minutes: Optional[int],
    appearances: Optional[int] = None,
    starts: Optional[int] = None,
    evidence: Optional[PlayerEvidenceConfidence] = None,
    provider: Optional[Provider] = None,
    snapshot: Optional[SourceSnapshot] = None,
    *,
    uses_modeled_values: bool = False,
) -> Optional[ContextPanel]:
    if ctx is None and evidence is None and minutes is None:
        return None
    explanation = ctx.explanation_json if ctx else {}
    limitations = []
    if evidence and evidence.explanation_json:
        limitations = [
            str(v)
            for k, v in evidence.explanation_json.items()
            if k in {"coverage", "league_adjustment", "sample"}
        ]
    return ContextPanel(
        league_strength=ctx.league_strength if ctx else None,
        team_strength=ctx.team_strength if ctx else None,
        opposition_quality=ctx.opposition_quality if ctx else None,
        competition_stakes=ctx.competition_stakes if ctx else None,
        role_usage=ctx.role_usage if ctx else None,
        sample_reliability=ctx.sample_reliability if ctx else None,
        translation_risk=(explanation or {}).get("league_strength", ""),
        sample_confidence=ctx.context_confidence if ctx else None,
        minutes=evidence.minutes if evidence else minutes,
        appearances=evidence.appearances if evidence else appearances,
        starts=evidence.starts if evidence else starts,
        data_source=provider.name if provider else None,
        data_type=provider.provider_type if provider else None,
        data_last_updated=(
            snapshot.as_of_date.isoformat() if snapshot and snapshot.as_of_date else None
        ),
        matches_covered=evidence.matches_covered if evidence else None,
        known_total_matches=evidence.known_total_matches if evidence else None,
        competition_coverage_pct=evidence.competition_coverage_pct if evidence else None,
        data_recency_days=evidence.data_recency_days if evidence else None,
        sample_size_confidence=evidence.sample_size_confidence if evidence else None,
        coverage_confidence=evidence.coverage_confidence if evidence else None,
        league_adjustment_confidence=evidence.league_adjustment_confidence if evidence else None,
        role_similarity_confidence=evidence.role_similarity_confidence if evidence else None,
        overall_rating_confidence=evidence.overall_rating_confidence if evidence else None,
        uses_event_data=provider.provider_type == "event" if provider else False,
        uses_basic_statistics=provider.provider_type == "current" if provider else False,
        uses_modeled_values=uses_modeled_values,
        uses_demo_data=provider.slug == "sample" if provider else False,
        limitations=limitations,
        attribution=provider.attribution if provider else None,
        explanation={**(explanation or {}), **(evidence.explanation_json if evidence else {})},
    )


def market_panel(m: Optional[MarketValue]) -> Optional[MarketPanel]:
    if m is None:
        return None
    return MarketPanel(
        public_value_eur=m.public_value_eur,
        model_value_low_eur=m.model_value_low_eur,
        model_value_high_eur=m.model_value_high_eur,
        expected_asking_low_eur=m.expected_asking_low_eur,
        expected_asking_high_eur=m.expected_asking_high_eur,
        confidence=m.confidence,
        label=m.label,
        manual_review_required=m.manual_review_required,
        version=m.version,
        explanation=m.explanation_json or {},
    )


def worse_confidence(a: str, b: str) -> str:
    return a if _CONF_ORDER.get(a, 0) <= _CONF_ORDER.get(b, 0) else b
