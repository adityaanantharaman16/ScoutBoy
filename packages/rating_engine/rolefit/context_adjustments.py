"""Context adjustment module.

Turns a player-season's environment (league, team, competition stakes, minutes,
form) into the multipliers and confidence penalties used by the RoleFit formula.
All numbers come from configs/context/*.yaml — nothing is hard-coded here. Context
adjusts *reliability and trust*; it never erases raw production.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml
from scoutboy_shared import ConfidenceLevel

from .paths import config_dir

CONTEXT_FILES = {
    "league": "league_strength_v1.yaml",
    "team": "team_strength_v1.yaml",
    "stakes": "competition_stakes_v1.yaml",
    "sample": "sample_reliability_v1.yaml",
}


def _clamp(value: float, band: dict) -> float:
    return max(float(band["min"]), min(float(band["max"]), value))


@dataclass(frozen=True)
class ContextResult:
    multipliers: dict[str, float]
    combined_multiplier: float
    confidence_penalty: float
    translation_risk: str
    team_tier: str
    sample_confidence: str
    sample_label: str
    form_bonus: float
    explanation: dict = field(default_factory=dict)


@dataclass
class ContextConfig:
    league: dict
    team: dict
    stakes: dict
    sample: dict
    config_hash: str

    @classmethod
    def load(cls, directory: Optional[Path] = None) -> ContextConfig:
        directory = directory or (config_dir() / "context")
        loaded = {}
        for key, fname in CONTEXT_FILES.items():
            with open(directory / fname) as f:
                loaded[key] = yaml.safe_load(f)
        payload = json.dumps(loaded, sort_keys=True, separators=(",", ":")).encode()
        return cls(
            league=loaded["league"],
            team=loaded["team"],
            stakes=loaded["stakes"],
            sample=loaded["sample"],
            config_hash=hashlib.sha256(payload).hexdigest()[:16],
        )

    # -- individual dimensions -------------------------------------------------
    def league_dimension(self, competition_slug: Optional[str]) -> dict:
        entry = self.league.get("leagues", {}).get(competition_slug or "", None)
        if entry is None:
            entry = self.league["default"]
            matched = False
        else:
            matched = True
        mult = _clamp(float(entry["multiplier"]), self.league["band"])
        return {
            "multiplier": mult,
            "translation_risk": entry.get("translation_risk", "high"),
            "confidence_penalty": float(entry.get("confidence_penalty", 0.0)),
            "matched": matched,
            "explanation": (
                f"League '{competition_slug or 'unknown'}' strength ×{mult:.2f}"
                f" ({entry.get('translation_risk', 'high')} translation risk)"
                + ("" if matched else " [default — league not in config]")
            ),
        }

    def team_dimension(self, team_slug: Optional[str], team_tier: Optional[str] = None) -> dict:
        tier = team_tier or self.team.get("teams", {}).get(
            team_slug or "", self.team["default_tier"]
        )
        tier_cfg = self.team["tiers"].get(tier, self.team["tiers"][self.team["default_tier"]])
        mult = _clamp(float(tier_cfg["multiplier"]), self.team["band"])
        return {
            "multiplier": mult,
            "tier": tier,
            "confidence_penalty": float(tier_cfg.get("confidence_penalty", 0.0)),
            "explanation": f"Team '{team_slug or 'unknown'}' tier '{tier}' ×{mult:.2f}",
        }

    def stakes_dimension(self, competition_type: Optional[str]) -> dict:
        entry = self.stakes.get("by_competition_type", {}).get(competition_type or "", None)
        if entry is None:
            entry = self.stakes["default"]
        mult = _clamp(float(entry["multiplier"]), self.stakes["band"])
        return {
            "multiplier": mult,
            "label": entry.get("label", "standard"),
            "explanation": f"Stakes '{entry.get('label', 'standard')}' ×{mult:.2f}",
        }

    def opposition_dimension(self, league_dim: dict) -> dict:
        # MVP proxy: derive from league strength (no per-match opponent data yet).
        band = self.sample["opposition_proxy"]["band"]
        # Map league multiplier (≈0.85..1.05) into the opposition band.
        lm = league_dim["multiplier"]
        proxy = 1.0 + (lm - 1.0) * 0.6
        mult = _clamp(proxy, band)
        return {
            "multiplier": mult,
            "explanation": f"Opposition quality (proxy from league) ×{mult:.2f}",
        }

    def sample_dimension(self, minutes: Optional[int]) -> dict:
        minutes = minutes or 0
        thresholds = sorted(
            self.sample["minutes_thresholds"], key=lambda t: t["min_minutes"], reverse=True
        )
        chosen = thresholds[-1]
        for t in thresholds:
            if minutes >= t["min_minutes"]:
                chosen = t
                break
        mult = _clamp(float(chosen["multiplier"]), self.sample["band"])
        return {
            "multiplier": mult,
            "confidence": chosen["confidence"],
            "label": chosen["label"],
            "explanation": f"{minutes} minutes → {chosen['label']} ×{mult:.2f}",
        }

    def form_bonus_points(
        self, recent_form_index: Optional[float], sample_confidence: str
    ) -> float:
        cfg = self.sample["form_bonus"]
        if recent_form_index is None:
            return 0.0
        base = max(0.0, float(recent_form_index) - 0.5) * 2.0 * float(cfg["max_points"])
        if sample_confidence == ConfidenceLevel.LOW.value:
            base *= 0.5
        elif sample_confidence == ConfidenceLevel.UNKNOWN.value:
            base = 0.0
        return round(base, 2)


def build_context(
    config: ContextConfig,
    *,
    competition_slug: Optional[str],
    team_slug: Optional[str],
    competition_type: Optional[str],
    minutes: Optional[int],
    recent_form_index: Optional[float] = None,
    role_usage: float = 1.0,
    team_tier: Optional[str] = None,
) -> ContextResult:
    league = config.league_dimension(competition_slug)
    team = config.team_dimension(team_slug, team_tier)
    stakes = config.stakes_dimension(competition_type)
    opposition = config.opposition_dimension(league)
    sample = config.sample_dimension(minutes)

    multipliers = {
        "league_strength": league["multiplier"],
        "team_strength": team["multiplier"],
        "opposition_quality": opposition["multiplier"],
        "competition_stakes": stakes["multiplier"],
        "role_usage": round(role_usage, 3),
        "sample_reliability": sample["multiplier"],
    }
    combined = 1.0
    for m in multipliers.values():
        combined *= m

    confidence_penalty = round(league["confidence_penalty"] + team["confidence_penalty"], 3)
    form_bonus = config.form_bonus_points(recent_form_index, sample["confidence"])

    explanation = {
        "league_strength": league["explanation"],
        "team_strength": team["explanation"],
        "opposition_quality": opposition["explanation"],
        "competition_stakes": stakes["explanation"],
        "role_usage": f"Role usage ×{role_usage:.2f} (nominal — no positional-split data in MVP)",
        "sample_reliability": sample["explanation"],
        "combined_multiplier": round(combined, 4),
    }

    return ContextResult(
        multipliers=multipliers,
        combined_multiplier=round(combined, 4),
        confidence_penalty=confidence_penalty,
        translation_risk=league["translation_risk"],
        team_tier=team["tier"],
        sample_confidence=sample["confidence"],
        sample_label=sample["label"],
        form_bonus=form_bonus,
        explanation=explanation,
    )
