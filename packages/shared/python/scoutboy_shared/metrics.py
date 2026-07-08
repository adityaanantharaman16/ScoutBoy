from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml


@dataclass(frozen=True)
class MetricMeta:
    name: str  # canonical name
    display: str
    unit: str  # per90 | pct | index | count | years
    higher_better: bool
    kind: str  # performance | context | identity
    face_group: str  # attack | creation | progression | dribbling | defending | possession | physical | form
    aliases: tuple[str, ...] = field(default_factory=tuple)


# Face-stat categories shown on the player card. "value" is sourced from the market
# model, not from metrics, so it is not listed here.
FACE_STAT_GROUPS: dict[str, str] = {
    "attack": "Attack",
    "creation": "Creation",
    "progression": "Progression",
    "dribbling": "Dribbling",
    "defending": "Defending",
    "possession": "Possession",
    "physical": "Physical / Availability",
}


def _config_dir() -> Path:
    override = os.environ.get("SCOUTBOY_CONFIG_DIR")
    if override:
        return Path(override).resolve()
    # metrics.py -> scoutboy_shared -> python -> shared -> packages -> repo root
    return Path(__file__).resolve().parents[4] / "configs"


def _registry_path() -> Path:
    return _config_dir() / "metrics" / "canonical_metrics_v1.yaml"


@lru_cache(maxsize=1)
def _load() -> tuple[dict[str, MetricMeta], dict[str, str]]:
    path = _registry_path()
    with open(path) as f:
        data = yaml.safe_load(f)
    registry: dict[str, MetricMeta] = {}
    aliases: dict[str, str] = {}
    for name, spec in data["metrics"].items():
        kind = spec.get("kind", "performance")
        meta = MetricMeta(
            name=name,
            display=spec.get("display", name),
            unit=spec.get("unit", "per90"),
            higher_better=bool(spec.get("higher_better", True)),
            kind=kind,
            face_group=spec.get("face_group", ""),
            aliases=tuple(spec.get("aliases", []) or []),
        )
        registry[name] = meta
        for alias in meta.aliases:
            aliases[alias] = name
    return registry, aliases


# Public surface. Built once from the canonical YAML.
METRIC_REGISTRY: dict[str, MetricMeta] = _load()[0]
ALIASES: dict[str, str] = _load()[1]
PERFORMANCE_METRICS: tuple[str, ...] = tuple(
    n for n, m in METRIC_REGISTRY.items() if m.kind == "performance"
)


def resolve_metric(name: str) -> str | None:
    """Resolve a canonical name or a known alias to its canonical name."""
    if name in METRIC_REGISTRY:
        return name
    return ALIASES.get(name)


def metric_meta(name: str) -> MetricMeta | None:
    canonical = resolve_metric(name)
    return METRIC_REGISTRY.get(canonical) if canonical else None


def is_higher_better(name: str) -> bool:
    """Direction from the registry; True when a larger value is better."""
    meta = metric_meta(name)
    return meta.higher_better if meta else True


def is_performance_metric(name: str) -> bool:
    meta = metric_meta(name)
    return bool(meta and meta.kind == "performance")
