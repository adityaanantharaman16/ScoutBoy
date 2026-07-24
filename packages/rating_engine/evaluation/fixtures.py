"""Deterministic calibration fixtures.

A calibration fixture is a *controlled synthetic profile* — raw per-90 metric values plus a
context — not a claim about any real footballer. Percentiles are earned the same way the
production recompute earns them: every fixture player is percentiled against a committed
reference cohort using ``normalize_metrics`` (role-eligible population per role, position-group
population for playstyles). We then score with the real ``compute_role_rating`` /
``compute_playstyles``. Nothing here duplicates the scoring formula; it only assembles inputs.

Data lives in ``configs/calibration/fixtures_v1.yaml`` so it is versioned and independent of
external data, network access, or database state.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml
from data_pipeline.normalize.metrics_normalizer import normalize_metrics
from rolefit import (
    AppliedBadge,
    ContextConfig,
    PlaystyleConfig,
    RoleConfig,
    RoleRatingResult,
    build_audit,
    build_context,
    compute_playstyles,
    compute_role_rating,
)
from rolefit.paths import config_dir
from scoutboy_shared import position_group_for

FIXTURES_FILE = "fixtures_v1.yaml"


@dataclass(frozen=True)
class FixturePlayer:
    fixture_id: str
    position: str
    minutes: int
    metrics: dict  # canonical metric name -> per90 value
    context: dict = field(default_factory=dict)
    is_benchmark: bool = False

    @property
    def position_group(self) -> str:
        return position_group_for(self.position) or ""


@dataclass(frozen=True)
class RoleScore:
    role_key: str
    final_score: float
    raw_score: float
    context_adjusted_score: float
    confidence_level: str
    confidence_score: float
    result: RoleRatingResult
    audit: dict = field(default_factory=dict)  # == rolefit.build_audit(result)


@dataclass(frozen=True)
class ScoredBenchmark:
    fixture_id: str
    position: str
    position_group: str
    minutes: int
    primary_role: Optional[str]
    role_scores: tuple[RoleScore, ...]
    playstyles: tuple[AppliedBadge, ...]
    translation_risk: str

    def role_score(self, role_key: str) -> Optional[RoleScore]:
        for rs in self.role_scores:
            if rs.role_key == role_key:
                return rs
        return None


@dataclass
class FixtureSuite:
    version: str
    players: dict  # fixture_id -> FixturePlayer
    benchmark_ids: tuple[str, ...]
    config_hash: str

    @classmethod
    def load(cls, directory: Optional[Path] = None) -> FixtureSuite:
        directory = directory or (config_dir() / "calibration")
        with open(directory / FIXTURES_FILE) as f:
            data = yaml.safe_load(f)
        players: dict[str, FixturePlayer] = {}
        benchmark_ids: list[str] = []

        def _add(entry: dict, *, is_benchmark: bool) -> None:
            fid = entry["id"]
            if fid in players:
                raise ValueError(f"duplicate calibration fixture id '{fid}'")
            players[fid] = FixturePlayer(
                fixture_id=fid,
                position=entry["position"],
                minutes=int(entry["minutes"]),
                metrics={k: (None if v is None else float(v)) for k, v in entry["metrics"].items()},
                context=dict(entry.get("context", {})),
                is_benchmark=is_benchmark,
            )
            if is_benchmark:
                benchmark_ids.append(fid)

        for _group, entries in (data.get("reference_cohorts") or {}).items():
            for entry in entries:
                _add(entry, is_benchmark=False)
        for entry in data.get("benchmarks") or []:
            _add(entry, is_benchmark=True)

        payload = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
        return cls(
            version=str(data.get("version", "v1")),
            players=players,
            benchmark_ids=tuple(benchmark_ids),
            config_hash=hashlib.sha256(payload).hexdigest()[:16],
        )

    # -- percentile assembly ---------------------------------------------------
    def _minutes_by_player(self) -> dict:
        return {fid: p.minutes for fid, p in self.players.items()}

    def playstyle_percentiles(self) -> dict:
        """player_id -> {metric: goodness percentile} within its position group."""
        raw = {fid: p.metrics for fid, p in self.players.items()}
        pg = {fid: p.position_group for fid, p in self.players.items()}
        return _percentiles(raw, pg, self._minutes_by_player())

    def role_percentiles(self, role: RoleConfig) -> dict:
        """player_id -> {metric: goodness percentile} within the role-eligible population."""
        eligible = {
            fid: p.metrics
            for fid, p in self.players.items()
            if p.position in role.eligible_positions
        }
        groups = {fid: role.role_key for fid in eligible}
        minutes = {fid: self.players[fid].minutes for fid in eligible}
        return _percentiles(eligible, groups, minutes)


def _percentiles(raw: dict, groups: dict, minutes: dict) -> dict:
    out: dict[str, dict] = {fid: {} for fid in raw}
    for nm in normalize_metrics(raw, groups, minutes):
        if nm.percentile is not None:
            out[nm.player_key][nm.metric_name] = nm.percentile
    return out


def score_benchmark(
    suite: FixtureSuite,
    fixture_id: str,
    roles: dict,
    ctx_config: ContextConfig,
    ps_config: PlaystyleConfig,
    *,
    min_minutes: int,
    context_override: Optional[dict] = None,
    minutes_override: Optional[int] = None,
) -> ScoredBenchmark:
    """Score one fixture player across every role its position is eligible for, plus playstyles.

    Reuses the production engine verbatim. ``context_override`` and ``minutes_override`` support
    context/confidence scenarios (re-scoring the same profile under a different environment or
    sample size). Percentiles are unaffected by these overrides — only context/confidence are.
    """
    player = suite.players[fixture_id]
    minutes = player.minutes if minutes_override is None else int(minutes_override)
    ctx_inputs = dict(player.context)
    if context_override:
        ctx_inputs.update(context_override)
    context = build_context(
        ctx_config,
        competition_slug=ctx_inputs.get("competition_slug"),
        team_slug=ctx_inputs.get("team_slug"),
        competition_type=ctx_inputs.get("competition_type"),
        minutes=minutes,
        recent_form_index=ctx_inputs.get("recent_form_index"),
        role_usage=float(ctx_inputs.get("role_usage", 1.0)),
        team_tier=ctx_inputs.get("team_tier"),
    )

    role_scores: list[RoleScore] = []
    for role in roles.values():
        if player.position not in role.eligible_positions:
            continue
        perc = suite.role_percentiles(role).get(fixture_id, {})
        result = compute_role_rating(role, perc, context, minutes=minutes, min_minutes=min_minutes)
        role_scores.append(
            RoleScore(
                role_key=role.role_key,
                final_score=result.final_score,
                raw_score=result.raw_score,
                context_adjusted_score=result.context_adjusted_score,
                confidence_level=result.confidence.level.value,
                confidence_score=result.confidence.score,
                result=result,
                # Reuse the production audit builder verbatim — no audit logic is re-created here.
                audit=build_audit(result),
            )
        )
    # Deterministic ordering: final desc, then role_key asc (stable tie-break).
    role_scores.sort(key=lambda rs: (-rs.final_score, rs.role_key))

    ps_perc = suite.playstyle_percentiles().get(fixture_id, {})
    badges = compute_playstyles(
        ps_perc,
        position_group=player.position_group,
        minutes=minutes,
        config=ps_config,
        translation_risk=context.translation_risk,
    )

    return ScoredBenchmark(
        fixture_id=fixture_id,
        position=player.position,
        position_group=player.position_group,
        minutes=minutes,
        primary_role=role_scores[0].role_key if role_scores else None,
        role_scores=tuple(role_scores),
        playstyles=tuple(badges),
        translation_risk=context.translation_risk,
    )
