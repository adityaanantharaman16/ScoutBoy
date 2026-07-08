"""Role configuration loader.

Role weights live in configs/roles/*.yaml and are loaded/validated here — never
hard-coded into scoring logic, the API, or the UI. Each config is hashed so a rating
run can record exactly which weights produced a score.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml
from scoutboy_shared import resolve_metric

from .paths import config_dir


@dataclass(frozen=True)
class MetricWeight:
    name: str
    direction: str  # higher_better | lower_better
    weight: float

    @property
    def higher_better(self) -> bool:
        return self.direction != "lower_better"


@dataclass(frozen=True)
class MetricGroup:
    key: str
    weight: float
    metrics: tuple[MetricWeight, ...]


@dataclass(frozen=True)
class ConcernRule:
    key: str
    metric: str
    direction: str  # higher_worse | lower_worse
    percentile_threshold: float
    penalty: float


@dataclass(frozen=True)
class RoleConfig:
    role_key: str
    display_name: str
    position_group: str
    eligible_positions: tuple[str, ...]
    description: str
    groups: tuple[MetricGroup, ...]
    required_metrics: tuple[str, ...]
    optional_metrics: tuple[str, ...]
    confidence_rules: dict
    concern_rules: tuple[ConcernRule, ...]
    config_hash: str
    raw: dict = field(repr=False, default_factory=dict)

    def all_metric_names(self) -> list[str]:
        names: list[str] = []
        for g in self.groups:
            for m in g.metrics:
                if m.name not in names:
                    names.append(m.name)
        return names


class RoleConfigError(ValueError):
    pass


def _hash_config(data: dict) -> str:
    payload = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


def _parse_role(data: dict) -> RoleConfig:
    required_top = ["role_key", "display_name", "position_group", "metric_groups"]
    for key in required_top:
        if key not in data:
            raise RoleConfigError(f"role config missing '{key}'")

    groups: list[MetricGroup] = []
    group_weight_sum = 0.0
    for gkey, gval in data["metric_groups"].items():
        gweight = float(gval["weight"])
        group_weight_sum += gweight
        metrics: list[MetricWeight] = []
        raw_metrics = gval.get("metrics", [])
        default_w = 1.0 / len(raw_metrics) if raw_metrics else 0.0
        for m in raw_metrics:
            name = m["name"]
            if resolve_metric(name) is None:
                raise RoleConfigError(
                    f"role '{data['role_key']}' group '{gkey}' references unknown metric '{name}'"
                )
            metrics.append(
                MetricWeight(
                    name=name,
                    direction=m.get("direction", "higher_better"),
                    weight=float(m.get("weight", default_w)),
                )
            )
        groups.append(MetricGroup(key=gkey, weight=gweight, metrics=tuple(metrics)))

    if abs(group_weight_sum - 1.0) > 0.01:
        raise RoleConfigError(
            f"role '{data['role_key']}' group weights sum to {group_weight_sum:.3f}, expected ~1.0"
        )

    concern_rules = tuple(
        ConcernRule(
            key=c["key"],
            metric=c["metric"],
            direction=c.get("direction", "higher_worse"),
            percentile_threshold=float(c.get("percentile_threshold", 0.2)),
            penalty=float(c.get("penalty", 1.0)),
        )
        for c in data.get("concern_rules", [])
    )

    return RoleConfig(
        role_key=data["role_key"],
        display_name=data["display_name"],
        position_group=data["position_group"],
        eligible_positions=tuple(data.get("eligible_positions", [])),
        description=(data.get("description") or "").strip(),
        groups=tuple(groups),
        required_metrics=tuple(data.get("required_metrics", [])),
        optional_metrics=tuple(data.get("optional_metrics", [])),
        confidence_rules=dict(data.get("confidence_rules", {})),
        concern_rules=concern_rules,
        config_hash=_hash_config(data),
        raw=data,
    )


def load_role_config(path: Path) -> RoleConfig:
    with open(path) as f:
        data = yaml.safe_load(f)
    return _parse_role(data)


def load_role_configs(directory: Optional[Path] = None) -> dict[str, RoleConfig]:
    """Load every role config keyed by role_key. Deterministic ordering by filename."""
    directory = directory or (config_dir() / "roles")
    if not directory.exists():
        raise RoleConfigError(f"role config directory not found: {directory}")
    configs: dict[str, RoleConfig] = {}
    for path in sorted(directory.glob("*.yaml")):
        cfg = load_role_config(path)
        if cfg.role_key in configs:
            raise RoleConfigError(f"duplicate role_key '{cfg.role_key}' in {path}")
        configs[cfg.role_key] = cfg
    if not configs:
        raise RoleConfigError(f"no role configs found in {directory}")
    return configs
