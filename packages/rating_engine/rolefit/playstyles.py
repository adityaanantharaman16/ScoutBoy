"""Playstyle + concern engine (Playstyles v1).

Badges are computed from configs/playstyles/*.yaml using direction-adjusted goodness
percentiles WITHIN the player's peer group — which is what makes them role-aware. A
positive badge is only applied when the sample is large enough, its required metrics
are present, and the composite percentile clears the `base` tier. Concerns come from
several trigger types (low tail, small sample, translation risk, market label). No
badge is ever produced from missing data.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml
from scoutboy_shared import ConfidenceLevel, metric_meta

from .paths import config_dir


@dataclass(frozen=True)
class AppliedBadge:
    playstyle_key: str
    display_name: str
    category: str
    tier: Optional[str]  # base | plus | elite (None for trigger-based concerns)
    confidence: str
    composite_percentile: Optional[float]
    is_concern: bool
    why_applied: dict
    supporting_metrics: tuple[dict, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict:
        return {
            "playstyle_key": self.playstyle_key,
            "display_name": self.display_name,
            "category": self.category,
            "tier": self.tier,
            "confidence": self.confidence,
            "composite_percentile": self.composite_percentile,
            "is_concern": self.is_concern,
            "supporting_metrics": list(self.supporting_metrics),
            "why_applied_json": self.why_applied,
        }


@dataclass
class PlaystyleConfig:
    version: str
    positives: list[dict]
    concerns: list[dict]
    positive_defaults: dict
    concern_defaults: dict
    config_hash: str

    @classmethod
    def load(cls, directory: Optional[Path] = None) -> PlaystyleConfig:
        directory = directory or (config_dir() / "playstyles")
        with open(directory / "playstyles_v1.yaml") as f:
            pos = yaml.safe_load(f)
        with open(directory / "concerns_v1.yaml") as f:
            con = yaml.safe_load(f)
        payload = json.dumps([pos, con], sort_keys=True, separators=(",", ":")).encode()
        return cls(
            version=str(pos.get("version", "v1")),
            positives=pos.get("playstyles", []),
            concerns=con.get("concerns", []),
            positive_defaults=pos.get("defaults", {}),
            concern_defaults=con.get("defaults", {}),
            config_hash=hashlib.sha256(payload).hexdigest()[:16],
        )


def _minutes_confidence(minutes: int) -> ConfidenceLevel:
    if minutes >= 1800:
        return ConfidenceLevel.HIGH
    if minutes >= 900:
        return ConfidenceLevel.MEDIUM
    if minutes >= 450:
        return ConfidenceLevel.LOW
    return ConfidenceLevel.UNKNOWN


def _composite(metrics_cfg: list[dict], percentiles: dict[str, Optional[float]]):
    """Weighted mean of present metric goodness percentiles + supporting rows."""
    default_w = 1.0 / len(metrics_cfg) if metrics_cfg else 0.0
    usable = []
    supporting = []
    for m in metrics_cfg:
        name = m["name"]
        w = float(m.get("weight", default_w))
        p = percentiles.get(name)
        if p is not None:
            usable.append((w, p))
            meta = metric_meta(name)
            supporting.append(
                {
                    "name": name,
                    "display": meta.display if meta else name,
                    "percentile": round(p, 4),
                    "score": round(p * 100, 1),
                    "weight": w,
                }
            )
    total_w = sum(w for w, _ in usable)
    if total_w <= 0:
        return None, supporting
    composite = sum((w / total_w) * p for w, p in usable)
    return composite, supporting


def _tier_for(composite: float, tiers: dict) -> Optional[str]:
    if composite >= tiers.get("elite", 0.95):
        return "elite"
    if composite >= tiers.get("plus", 0.90):
        return "plus"
    if composite >= tiers.get("base", 0.75):
        return "base"
    return None


def compute_playstyles(
    percentiles: dict[str, Optional[float]],
    *,
    position_group: str,
    minutes: int,
    config: PlaystyleConfig,
    translation_risk: Optional[str] = None,
    market_label: Optional[str] = None,
) -> list[AppliedBadge]:
    badges: list[AppliedBadge] = []
    default_tiers = config.positive_defaults.get(
        "tiers", {"base": 0.75, "plus": 0.90, "elite": 0.95}
    )
    default_min = int(config.positive_defaults.get("min_minutes", 450))

    # --- positive badges ---
    for p in config.positives:
        if position_group not in p.get("position_groups", []):
            continue
        if minutes < int(p.get("min_minutes", default_min)):
            continue
        required = p.get("required_metrics", [])
        if any(percentiles.get(m) is None for m in required):
            continue
        composite, supporting = _composite(p["metrics"], percentiles)
        if composite is None:
            continue
        tier = _tier_for(composite, p.get("tiers", default_tiers))
        if tier is None:
            continue
        conf = _minutes_confidence(minutes).value
        badges.append(
            AppliedBadge(
                playstyle_key=p["key"],
                display_name=p["display_name"],
                category=p.get("category", "general"),
                tier=tier,
                confidence=conf,
                composite_percentile=round(composite, 4),
                is_concern=False,
                supporting_metrics=tuple(supporting),
                why_applied={
                    "text": (
                        f"{p['display_name']} ({tier}): composite {composite * 100:.0f}th "
                        f"percentile among {position_group} peers."
                    ),
                    "composite_percentile": round(composite, 4),
                    "supporting_metrics": supporting,
                },
            )
        )

    # --- concern badges ---
    con_min = int(config.concern_defaults.get("min_minutes", 450))
    for c in config.concerns:
        trigger = c.get("trigger", "low_percentile")
        pgroups = c.get("position_groups")
        if pgroups and position_group not in pgroups:
            continue

        if trigger == "low_percentile":
            if minutes < con_min:
                continue
            required = [m["name"] for m in c["metrics"]]
            if any(percentiles.get(m) is None for m in required):
                continue
            composite, supporting = _composite(c["metrics"], percentiles)
            if composite is None or composite > float(c["percentile_threshold"]):
                continue
            badges.append(
                _concern_badge(
                    c,
                    composite,
                    supporting,
                    text=(
                        f"{c['display_name']}: bottom-tail composite "
                        f"({composite * 100:.0f}th percentile ≤ "
                        f"{float(c['percentile_threshold']) * 100:.0f}th) for {position_group} peers."
                    ),
                    minutes=minutes,
                )
            )
        elif trigger == "small_sample":
            if minutes < int(c["minutes_below"]):
                badges.append(
                    _concern_badge(
                        c,
                        None,
                        [],
                        text=f"{c['display_name']}: {minutes} minutes is below {c['minutes_below']}.",
                        minutes=minutes,
                        confidence=ConfidenceLevel.HIGH.value,
                    )
                )
        elif trigger == "context_translation":
            if translation_risk in c.get("translation_risk_levels", []):
                badges.append(
                    _concern_badge(
                        c,
                        None,
                        [],
                        text=f"{c['display_name']}: league carries {translation_risk} translation risk.",
                        minutes=minutes,
                    )
                )
        elif trigger == "market_label":
            if market_label in c.get("labels", []):
                badges.append(
                    _concern_badge(
                        c,
                        None,
                        [],
                        text=f"{c['display_name']}: market model flagged '{market_label}'.",
                        minutes=minutes,
                    )
                )
    return badges


def _concern_badge(
    c: dict,
    composite: Optional[float],
    supporting: list,
    *,
    text: str,
    minutes: int,
    confidence: Optional[str] = None,
) -> AppliedBadge:
    return AppliedBadge(
        playstyle_key=c["key"],
        display_name=c["display_name"],
        category=c.get("category", "risk"),
        tier=None,
        confidence=confidence or _minutes_confidence(minutes).value,
        composite_percentile=None if composite is None else round(composite, 4),
        is_concern=True,
        supporting_metrics=tuple(supporting),
        why_applied={"text": text, "supporting_metrics": supporting},
    )
