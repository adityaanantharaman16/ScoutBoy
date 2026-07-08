"""Audit + explanation builders.

Every RoleFit score gets a structured, storable audit (metric / context / confidence /
penalty breakdowns) plus a plain-English explanation. Strengths and concerns are
derived from the same breakdown so the card text is always grounded in the numbers.
"""

from __future__ import annotations

from scoutboy_shared import metric_meta

from .formula import RoleRatingResult


def build_audit(result: RoleRatingResult) -> dict:
    metric_breakdown = {
        "raw_score": result.raw_score,
        "groups": [
            {
                "key": g.key,
                "weight": g.weight,
                "normalized_weight": g.normalized_weight,
                "group_score": g.group_score,
                "metrics": [
                    {
                        "name": m.name,
                        "display": (metric_meta(m.name).display if metric_meta(m.name) else m.name),
                        "percentile": m.percentile,
                        "score": m.score,
                        "weight": m.weight,
                        "present": m.present,
                    }
                    for m in g.metrics
                ],
            }
            for g in result.groups
        ],
    }
    context_breakdown = {
        "multipliers": result.context.multipliers,
        "combined_multiplier": result.context.combined_multiplier,
        "translation_risk": result.context.translation_risk,
        "form_bonus": result.form_bonus,
        "explanation": result.context.explanation,
        "context_adjusted_score": result.context_adjusted_score,
    }
    penalties = {
        "total": result.penalties_total,
        "items": [
            {"key": p.key, "metric": p.metric, "points": p.points, "explanation": p.explanation}
            for p in result.penalties
        ],
    }
    return {
        "metric_breakdown_json": metric_breakdown,
        "context_breakdown_json": context_breakdown,
        "confidence_breakdown_json": result.confidence.to_breakdown(),
        "penalties_json": penalties,
        "explanation_text": build_explanation_text(result),
    }


def _top_groups(result: RoleRatingResult, n: int = 3, best: bool = True):
    scored = [g for g in result.groups if g.group_score is not None]
    scored.sort(key=lambda g: g.group_score, reverse=best)
    return scored[:n]


def build_explanation_text(result: RoleRatingResult) -> str:
    strong = _top_groups(result, 2, best=True)
    parts = [f"Rates {result.final_score:.1f} in this role."]
    if strong:
        parts.append(
            "Strongest areas: "
            + ", ".join(f"{g.key.replace('_', ' ')} ({g.group_score:.0f})" for g in strong)
            + "."
        )
    parts.append(
        f"Context net multiplier ×{result.context.combined_multiplier:.2f}"
        f" (raw {result.raw_score:.1f} → adjusted {result.context_adjusted_score:.1f})."
    )
    if result.form_bonus:
        parts.append(f"Recent-form bonus +{result.form_bonus:.1f}.")
    if result.penalties_total:
        keys = ", ".join(p.key for p in result.penalties)
        parts.append(f"Risk penalties −{result.penalties_total:.1f} ({keys}).")
    parts.append(f"Confidence: {result.confidence.label.lower()}.")
    return " ".join(parts)


def build_strengths_concerns(result: RoleRatingResult) -> dict:
    """Plain-English strengths/concerns grounded in the audit breakdown."""
    strengths: list[dict] = []
    for g in _top_groups(result, 3, best=True):
        if g.group_score is not None and g.group_score >= 65:
            strengths.append(
                {
                    "label": g.key.replace("_", " ").title(),
                    "detail": f"{g.group_score:.0f}/100 in {g.key.replace('_', ' ')} for this role.",
                    "score": g.group_score,
                }
            )
    concerns: list[dict] = []
    for p in result.penalties:
        concerns.append({"label": p.key.replace("_", " ").title(), "detail": p.explanation})
    for g in _top_groups(result, 2, best=False):
        if g.group_score is not None and g.group_score <= 35:
            concerns.append(
                {
                    "label": f"Weak {g.key.replace('_', ' ')}",
                    "detail": f"Only {g.group_score:.0f}/100 in {g.key.replace('_', ' ')}.",
                }
            )
    if result.confidence.missing_required:
        concerns.append(
            {
                "label": "Incomplete data",
                "detail": "Missing metrics: " + ", ".join(result.confidence.missing_required),
            }
        )
    return {"strengths": strengths, "concerns": concerns}
