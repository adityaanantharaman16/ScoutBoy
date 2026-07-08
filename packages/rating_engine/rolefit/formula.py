"""The RoleFit v1 formula.

    final = role_weighted_performance_score
            × league × team × opposition × stakes × role_usage × sample
            + recent_form_bonus
            − risk_penalties

Everything is computed from stored, direction-adjusted *goodness* percentiles (0..1)
and the role config weights. The output is clamped to the 0..99.9 display scale.
Missing metrics are dropped and their weight is renormalized among present peers;
they lower confidence rather than zeroing the score. The result carries a full audit.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from scoutboy_shared import DEFAULT_MIN_MINUTES, DISPLAY_SCALE_MAX

from .confidence import ConfidenceResult, compute_confidence
from .context_adjustments import ContextResult
from .normalize import percentile_to_score
from .role_weights import RoleConfig

MAX_TOTAL_PENALTY = 8.0


@dataclass(frozen=True)
class MetricContribution:
    name: str
    percentile: Optional[float]
    score: Optional[float]
    weight: float
    present: bool


@dataclass(frozen=True)
class GroupContribution:
    key: str
    weight: float
    normalized_weight: float
    group_score: Optional[float]
    metrics: tuple[MetricContribution, ...]


@dataclass(frozen=True)
class PenaltyContribution:
    key: str
    metric: str
    points: float
    explanation: str


@dataclass(frozen=True)
class RoleRatingResult:
    role_key: str
    raw_score: float
    context_adjusted_score: float
    final_score: float
    confidence: ConfidenceResult
    form_bonus: float
    penalties_total: float
    groups: tuple[GroupContribution, ...]
    penalties: tuple[PenaltyContribution, ...]
    context: ContextResult
    present_metrics: tuple[str, ...]


def _group_score(
    group_metrics, percentiles: dict[str, Optional[float]]
) -> tuple[Optional[float], list[MetricContribution]]:
    present = [(m, percentiles.get(m.name)) for m in group_metrics]
    usable = [(m, p) for m, p in present if p is not None]
    total_w = sum(m.weight for m, _ in usable)
    contributions: list[MetricContribution] = []
    score: Optional[float] = None
    if usable and total_w > 0:
        acc = 0.0
        for m, p in usable:
            norm_w = m.weight / total_w
            acc += norm_w * p
        score = round(acc * 100.0, 2)
    for m, p in present:
        contributions.append(
            MetricContribution(
                name=m.name,
                percentile=None if p is None else round(p, 4),
                score=percentile_to_score(p),
                weight=m.weight,
                present=p is not None,
            )
        )
    return score, contributions


def _penalties(
    role: RoleConfig, percentiles: dict[str, Optional[float]]
) -> list[PenaltyContribution]:
    out: list[PenaltyContribution] = []
    for rule in role.concern_rules:
        goodness = percentiles.get(rule.metric)
        if goodness is None:
            continue
        trigger_level = (
            rule.percentile_threshold
            if rule.direction == "lower_worse"
            else 1.0 - rule.percentile_threshold
        )
        if trigger_level <= 0:
            continue
        if goodness <= trigger_level:
            severity = (trigger_level - goodness) / trigger_level
            points = round(rule.penalty * severity, 3)
            if points > 0:
                out.append(
                    PenaltyContribution(
                        key=rule.key,
                        metric=rule.metric,
                        points=points,
                        explanation=(
                            f"{rule.key}: {rule.metric} in the concern tail "
                            f"(goodness {goodness:.2f} ≤ {trigger_level:.2f}) → −{points:.2f}"
                        ),
                    )
                )
    return out


def compute_role_rating(
    role: RoleConfig,
    percentiles: dict[str, Optional[float]],
    context: ContextResult,
    *,
    minutes: int,
    min_minutes: int = DEFAULT_MIN_MINUTES,
) -> RoleRatingResult:
    """Compute a single role rating from direction-adjusted goodness percentiles."""
    present_metrics = {k for k, v in percentiles.items() if v is not None}

    # 1) role-weighted performance score, renormalizing over present groups
    raw_groups: list[GroupContribution] = []
    scored: list[tuple[float, float]] = []  # (group_weight, group_score)
    for g in role.groups:
        gscore, contribs = _group_score(g.metrics, percentiles)
        raw_groups.append(
            GroupContribution(
                key=g.key,
                weight=g.weight,
                normalized_weight=0.0,  # filled below
                group_score=gscore,
                metrics=tuple(contribs),
            )
        )
        if gscore is not None:
            scored.append((g.weight, gscore))

    present_weight = sum(w for w, _ in scored)
    if present_weight > 0:
        raw_score = sum((w / present_weight) * s for w, s in scored)
    else:
        raw_score = 0.0

    groups = tuple(
        GroupContribution(
            key=g.key,
            weight=g.weight,
            normalized_weight=(
                round(g.weight / present_weight, 4)
                if (present_weight > 0 and g.group_score is not None)
                else 0.0
            ),
            group_score=g.group_score,
            metrics=g.metrics,
        )
        for g in raw_groups
    )

    # 2) context multipliers
    context_adjusted = raw_score * context.combined_multiplier

    # 3) additive form bonus, subtractive risk penalties
    penalties = _penalties(role, percentiles)
    penalties_total = min(MAX_TOTAL_PENALTY, round(sum(p.points for p in penalties), 3))

    final = context_adjusted + context.form_bonus - penalties_total
    final_score = round(max(0.0, min(DISPLAY_SCALE_MAX, final)), 1)

    # 4) confidence
    conf_rules = role.confidence_rules or {}
    confidence = compute_confidence(
        minutes=minutes,
        min_minutes=int(conf_rules.get("min_minutes", min_minutes)),
        full_confidence_minutes=int(conf_rules.get("full_confidence_minutes", 1800)),
        required_metrics=list(role.required_metrics),
        present_metrics=present_metrics,
        context_penalty=context.confidence_penalty,
    )

    return RoleRatingResult(
        role_key=role.role_key,
        raw_score=round(raw_score, 2),
        context_adjusted_score=round(context_adjusted, 2),
        final_score=final_score,
        confidence=confidence,
        form_bonus=context.form_bonus,
        penalties_total=penalties_total,
        groups=groups,
        penalties=tuple(penalties),
        context=context,
        present_metrics=tuple(sorted(present_metrics)),
    )
