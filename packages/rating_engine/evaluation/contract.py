"""The versioned RoleFit calibration contract.

The contract is the single, human-reviewable source of truth for *what a credible RoleFit
output looks like*. It never encodes magical absolute scores; it encodes role order,
confidence outcomes, playstyle/concern presence, translation-risk direction, bounded context
impact, and whether ``inconclusive`` is acceptable for each benchmark.

It is loaded through a **strict** schema: unknown fields, missing required fields, invalid
enums, duplicate ids, malformed role-ordering, invalid kind/evidence combinations, unknown
scenario types, and missing scenario parameters are all rejected with a single
``ContractError`` — malformed input never escapes as an incidental ``KeyError``/``TypeError``.
A contract ``rating_version`` that does not equal the production ``RATING_VERSION`` is also
rejected, so the contract and engine cannot silently diverge. Cross-validation against the
live role/playstyle/concern/fixture/context configuration runs automatically before either
fixture or pilot evaluation (see :meth:`CalibrationContract.validate`).

Lives at ``configs/calibration/rolefit_calibration_v1.yaml``.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from numbers import Number
from pathlib import Path
from typing import Optional, Union

import yaml
from rolefit import RATING_VERSION
from rolefit.paths import config_dir
from scoutboy_shared import ConfidenceLevel, resolve_metric

CONTRACT_FILE = "rolefit_calibration_v1.yaml"

BENCHMARK_KINDS = ("fixture", "pilot")
EVIDENCE_LEVELS = ("fixture", "reviewed", "illustrative", "pilot")
# Which evidence levels are valid for each benchmark kind.
KIND_EVIDENCE = {
    "fixture": ("fixture", "reviewed", "illustrative"),
    "pilot": ("pilot",),
}
CONFIDENCE_LEVELS = tuple(c.value for c in ConfidenceLevel)
TRANSLATION_RISKS = ("low", "medium", "high")
TIER_NAMES = ("base", "plus", "elite")

_CONF_RANK = {
    ConfidenceLevel.UNKNOWN: 0,
    ConfidenceLevel.LOW: 1,
    ConfidenceLevel.MEDIUM: 2,
    ConfidenceLevel.HIGH: 3,
}
TIER_RANK = {None: 0, "base": 1, "plus": 2, "elite": 3}

# Allowed key sets per schema level (unknown keys are rejected).
_TOP_KEYS = {"suite", "defaults", "limitations", "benchmarks", "scenarios"}
_SUITE_KEYS = {"id", "version", "rating_version", "methodology_note"}
_DEFAULTS_KEYS = {"inconclusive_allowed"}
_BENCHMARK_KEYS = {
    "id",
    "kind",
    "evidence_level",
    "description",
    "expected_primary_role",
    "role_ordering",
    "expected_playstyles",
    "expected_concerns",
    "confidence",
    "expected_translation_risk",
    "inconclusive_allowed",
    "limitations",
    "source_ids",
    "season_label",
}
_ORDERING_KEYS = {"higher", "lower"}
_PLAYSTYLE_KEYS = {"key", "present", "min_tier"}
_CONCERN_KEYS = {"key", "present"}
_CONFIDENCE_KEYS = {"role", "min_level", "max_level", "expect_missing_required"}
_SOURCE_ID_KEYS = {"source_name", "source_player_id"}
_SCENARIO_KEYS = {"id", "type", "description", "params"}

# Known scenario types and their required / optional parameter names. Structural presence is
# enforced here; reference existence (fixture ids, roles, metrics) is checked in cross-validation.
SCENARIO_SPECS = {
    "context_ordering": {
        "required": {"fixture_id", "role", "dimension", "high", "low", "max_ratio"},
        "optional": set(),
    },
    "minutes_monotonicity": {
        "required": {"fixture_id", "role", "minutes_ladder"},
        "optional": set(),
    },
    "form_gating": {"required": {"fixture_id", "role", "recent_form_index"}, "optional": set()},
    "confidence_bounds": {"required": set(), "optional": set()},
    "playstyle_tiers": {
        "required": {"position_group", "playstyle_key", "metric"},
        "optional": set(),
    },
    "concern_boundary": {
        "required": {"position_group", "concern_key", "metric"},
        "optional": set(),
    },
    "deterministic_ordering": {"required": set(), "optional": set()},
}
CONTEXT_ORDERING_DIMENSIONS = ("league", "team", "stakes")
# The single context-override field each dimension is allowed to vary. A context_ordering
# scenario's `high`/`low` must contain exactly this field (a non-empty string) — no unknown
# fields and no other dimension's override field — so a pass can only come from the declared
# dimension moving, never from an unrelated override leaking into the score.
DIMENSION_OVERRIDE_FIELD = {
    "league": "competition_slug",
    "team": "team_tier",
    "stakes": "competition_type",
}
RECENT_FORM_INDEX_DOMAIN = (0.0, 1.0)


class ContractError(ValueError):
    """Raised for any malformed / invalid calibration contract."""


# --------------------------------------------------------------------------- dataclasses
@dataclass(frozen=True)
class ExpectedPlaystyle:
    key: str
    present: bool = True
    min_tier: Optional[str] = None  # base | plus | elite


@dataclass(frozen=True)
class ExpectedConcern:
    key: str
    present: bool = True


@dataclass(frozen=True)
class RoleOrdering:
    higher: str
    lower: str


@dataclass(frozen=True)
class ConfidenceExpectation:
    role: Optional[str] = None  # None -> primary role
    min_level: Optional[str] = None
    max_level: Optional[str] = None
    expect_missing_required: Optional[bool] = None


@dataclass(frozen=True)
class Benchmark:
    id: str
    kind: str  # fixture | pilot
    evidence_level: str
    description: str
    expected_primary_role: Optional[Union[str, tuple]] = None
    role_ordering: tuple = ()
    expected_playstyles: tuple = ()
    expected_concerns: tuple = ()
    confidence: Optional[ConfidenceExpectation] = None
    expected_translation_risk: Optional[str] = None
    inconclusive_allowed: bool = False
    limitations: str = ""
    source_ids: tuple = ()  # pilot only: (source_name, source_player_id) pairs
    season_label: Optional[str] = None  # pilot only

    @property
    def acceptable_primary_roles(self) -> tuple:
        if self.expected_primary_role is None:
            return ()
        if isinstance(self.expected_primary_role, (list, tuple)):
            return tuple(self.expected_primary_role)
        return (self.expected_primary_role,)


@dataclass(frozen=True)
class Scenario:
    id: str
    type: str
    description: str
    params: dict = field(default_factory=dict)


@dataclass
class CalibrationContract:
    suite_id: str
    version: str
    rating_version: str
    methodology_note: str
    default_inconclusive_allowed: bool
    benchmarks: tuple
    scenarios: tuple
    config_hash: str
    limitations: tuple

    @property
    def fixture_benchmarks(self) -> tuple:
        return tuple(b for b in self.benchmarks if b.kind == "fixture")

    @property
    def pilot_benchmarks(self) -> tuple:
        return tuple(b for b in self.benchmarks if b.kind == "pilot")

    # -- loading / parsing -----------------------------------------------------
    @classmethod
    def load(cls, directory: Optional[Path] = None) -> CalibrationContract:
        directory = directory or (config_dir() / "calibration")
        with open(directory / CONTRACT_FILE) as f:
            data = yaml.safe_load(f)
        return cls.parse(data)

    @classmethod
    def parse(cls, data: dict) -> CalibrationContract:
        if not isinstance(data, dict):
            raise ContractError("calibration contract must be a mapping")
        _reject_unknown(data, _TOP_KEYS, "contract")

        suite = _require_mapping(data.get("suite"), "suite")
        _reject_unknown(suite, _SUITE_KEYS, "suite")
        for key in ("id", "version", "rating_version"):
            if not suite.get(key):
                raise ContractError(f"calibration suite missing required '{key}'")
        rating_version = str(suite["rating_version"])
        if rating_version != RATING_VERSION:
            raise ContractError(
                f"contract rating_version '{rating_version}' != production "
                f"RATING_VERSION '{RATING_VERSION}' — contract and engine must not diverge"
            )

        defaults = data.get("defaults") or {}
        defaults = _require_mapping(defaults, "defaults")
        _reject_unknown(defaults, _DEFAULTS_KEYS, "defaults")
        default_inc = _as_bool(
            defaults.get("inconclusive_allowed", False), "defaults.inconclusive_allowed"
        )

        benchmarks: list[Benchmark] = []
        seen: set = set()
        raw_benchmarks = data.get("benchmarks") or []
        if not isinstance(raw_benchmarks, list):
            raise ContractError("'benchmarks' must be a list")
        for raw in raw_benchmarks:
            b = _parse_benchmark(_require_mapping(raw, "benchmark"), default_inc)
            if b.id in seen:
                raise ContractError(f"duplicate benchmark id '{b.id}'")
            seen.add(b.id)
            benchmarks.append(b)
        if not benchmarks:
            raise ContractError("calibration contract defines no benchmarks")

        scenarios: list[Scenario] = []
        scen_seen: set = set()
        raw_scenarios = data.get("scenarios") or []
        if not isinstance(raw_scenarios, list):
            raise ContractError("'scenarios' must be a list")
        for raw in raw_scenarios:
            s = _parse_scenario(_require_mapping(raw, "scenario"))
            if s.id in scen_seen:
                raise ContractError(f"duplicate scenario id '{s.id}'")
            scen_seen.add(s.id)
            scenarios.append(s)

        limitations = data.get("limitations") or []
        if not isinstance(limitations, list):
            raise ContractError("'limitations' must be a list")

        payload = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
        return cls(
            suite_id=str(suite["id"]),
            version=str(suite["version"]),
            rating_version=rating_version,
            methodology_note=(suite.get("methodology_note") or "").strip(),
            default_inconclusive_allowed=default_inc,
            benchmarks=tuple(benchmarks),
            scenarios=tuple(scenarios),
            config_hash=hashlib.sha256(payload).hexdigest()[:16],
            limitations=tuple(str(x) for x in limitations),
        )

    # -- cross-validation ------------------------------------------------------
    def validate_against_engine(self, roles: dict, ps_config) -> None:
        """Engine-only cross-validation: reject references to roles / playstyles / concerns that
        do not exist in the current configs."""
        role_keys = set(roles)
        positive_keys = {p["key"] for p in ps_config.positives}
        concern_keys = {c["key"] for c in ps_config.concerns}
        for b in self.benchmarks:
            for rk in b.acceptable_primary_roles:
                if rk not in role_keys:
                    raise ContractError(f"benchmark '{b.id}' expects unknown role '{rk}'")
            for ro in b.role_ordering:
                for rk in (ro.higher, ro.lower):
                    if rk not in role_keys:
                        raise ContractError(
                            f"benchmark '{b.id}' role_ordering references unknown role '{rk}'"
                        )
            if b.confidence and b.confidence.role and b.confidence.role not in role_keys:
                raise ContractError(
                    f"benchmark '{b.id}' confidence targets unknown role '{b.confidence.role}'"
                )
            for ps in b.expected_playstyles:
                if ps.key not in positive_keys:
                    raise ContractError(f"benchmark '{b.id}' expects unknown playstyle '{ps.key}'")
            for cn in b.expected_concerns:
                if cn.key not in concern_keys and cn.key not in positive_keys:
                    raise ContractError(f"benchmark '{b.id}' expects unknown concern '{cn.key}'")

    def validate(self, *, roles: dict, ps_config, fixtures, ctx_config=None) -> None:
        """Full cross-validation run automatically before fixture or pilot evaluation.

        Extends the engine checks with committed-fixture mapping and scenario-reference
        existence, so a contract can never point at data or config that is not present.
        """
        self.validate_against_engine(roles, ps_config)
        positive_keys = {p["key"] for p in ps_config.positives}
        concern_keys = {c["key"] for c in ps_config.concerns}
        role_keys = set(roles)
        fixture_ids = set(getattr(fixtures, "players", {}))

        for b in self.fixture_benchmarks:
            if b.id not in fixture_ids:
                raise ContractError(
                    f"fixture benchmark '{b.id}' has no committed fixture in fixtures_v1.yaml"
                )
        for b in self.pilot_benchmarks:
            if not b.source_ids:
                raise ContractError(f"pilot benchmark '{b.id}' must declare stable source_ids")
            if not b.inconclusive_allowed:
                raise ContractError(f"pilot benchmark '{b.id}' must set inconclusive_allowed: true")

        for s in self.scenarios:
            p = s.params
            if s.type == "context_ordering":
                if p["fixture_id"] not in fixture_ids:
                    raise ContractError(
                        f"scenario '{s.id}' references unknown fixture '{p['fixture_id']}'"
                    )
                if p["role"] not in role_keys:
                    raise ContractError(f"scenario '{s.id}' references unknown role '{p['role']}'")
            elif s.type in ("minutes_monotonicity", "form_gating"):
                if p["fixture_id"] not in fixture_ids:
                    raise ContractError(
                        f"scenario '{s.id}' references unknown fixture '{p['fixture_id']}'"
                    )
                if p["role"] not in role_keys:
                    raise ContractError(f"scenario '{s.id}' references unknown role '{p['role']}'")
            elif s.type == "playstyle_tiers":
                if p["playstyle_key"] not in positive_keys:
                    raise ContractError(
                        f"scenario '{s.id}' references unknown playstyle '{p['playstyle_key']}'"
                    )
                if resolve_metric(p["metric"]) is None:
                    raise ContractError(
                        f"scenario '{s.id}' references unknown metric '{p['metric']}'"
                    )
            elif s.type == "concern_boundary":
                if p["concern_key"] not in concern_keys:
                    raise ContractError(
                        f"scenario '{s.id}' references unknown concern '{p['concern_key']}'"
                    )
                if resolve_metric(p["metric"]) is None:
                    raise ContractError(
                        f"scenario '{s.id}' references unknown metric '{p['metric']}'"
                    )


# --------------------------------------------------------------------------- helpers
def _require_mapping(value, ctx: str) -> dict:
    if not isinstance(value, dict):
        raise ContractError(f"{ctx} must be a mapping, got {type(value).__name__}")
    return value


def _reject_unknown(mapping: dict, allowed: set, ctx: str) -> None:
    unknown = set(mapping) - allowed
    if unknown:
        raise ContractError(f"{ctx} has unknown field(s): {sorted(unknown)}")


def _as_bool(value, ctx: str) -> bool:
    if not isinstance(value, bool):
        raise ContractError(f"{ctx} must be a boolean, got {type(value).__name__}")
    return value


def _as_str(value, ctx: str) -> str:
    if not isinstance(value, str) or not value:
        raise ContractError(f"{ctx} must be a non-empty string")
    return value


def _parse_benchmark(raw: dict, default_inc: bool) -> Benchmark:
    _reject_unknown(raw, _BENCHMARK_KEYS, "benchmark")
    bid = _as_str(raw.get("id"), "benchmark.id")
    kind = raw.get("kind", "fixture")
    if kind not in BENCHMARK_KINDS:
        raise ContractError(f"benchmark '{bid}' has invalid kind '{kind}'")
    evidence = raw.get("evidence_level", "fixture")
    if evidence not in EVIDENCE_LEVELS:
        raise ContractError(f"benchmark '{bid}' has invalid evidence_level '{evidence}'")
    if evidence not in KIND_EVIDENCE[kind]:
        raise ContractError(
            f"benchmark '{bid}' invalid kind/evidence combination: kind='{kind}', "
            f"evidence_level='{evidence}' (allowed: {list(KIND_EVIDENCE[kind])})"
        )
    if "description" not in raw or not str(raw.get("description") or "").strip():
        raise ContractError(f"benchmark '{bid}' missing required 'description'")

    # expected_primary_role: None | str | list[str]
    epr = raw.get("expected_primary_role")
    if epr is not None and not isinstance(epr, str):
        if not isinstance(epr, list) or not all(isinstance(x, str) and x for x in epr):
            raise ContractError(
                f"benchmark '{bid}' expected_primary_role must be a string or list of strings"
            )

    role_ordering = _parse_role_ordering(raw.get("role_ordering", []), bid)
    playstyles = _parse_expected_playstyles(raw.get("expected_playstyles", []), bid)
    concerns = _parse_expected_concerns(raw.get("expected_concerns", []), bid)
    confidence = _parse_confidence(raw.get("confidence"), bid)

    tr = raw.get("expected_translation_risk")
    if tr is not None and tr not in TRANSLATION_RISKS:
        raise ContractError(f"benchmark '{bid}' expected_translation_risk invalid: '{tr}'")

    inconclusive_allowed = _as_bool(
        raw.get("inconclusive_allowed", default_inc), f"benchmark '{bid}'.inconclusive_allowed"
    )
    source_ids = _parse_source_ids(raw.get("source_ids", []), bid)
    season_label = raw.get("season_label")
    if season_label is not None and not isinstance(season_label, str):
        raise ContractError(f"benchmark '{bid}' season_label must be a string")

    # kind-specific structural rules
    if kind == "pilot":
        if not source_ids:
            raise ContractError(f"pilot benchmark '{bid}' must declare stable source_ids")
        if not inconclusive_allowed:
            raise ContractError(f"pilot benchmark '{bid}' must set inconclusive_allowed: true")
        if not season_label:
            raise ContractError(f"pilot benchmark '{bid}' must declare a season_label")
    else:  # fixture
        if source_ids or season_label is not None:
            raise ContractError(
                f"fixture benchmark '{bid}' must not declare source_ids / season_label"
            )

    return Benchmark(
        id=bid,
        kind=kind,
        evidence_level=evidence,
        description=str(raw["description"]).strip(),
        expected_primary_role=epr,
        role_ordering=role_ordering,
        expected_playstyles=playstyles,
        expected_concerns=concerns,
        confidence=confidence,
        expected_translation_risk=tr,
        inconclusive_allowed=inconclusive_allowed,
        limitations=(raw.get("limitations") or "").strip(),
        source_ids=source_ids,
        season_label=season_label,
    )


def _parse_role_ordering(raw, bid: str) -> tuple:
    if not isinstance(raw, list):
        raise ContractError(f"benchmark '{bid}' role_ordering must be a list")
    out = []
    for o in raw:
        o = _require_mapping(o, f"benchmark '{bid}' role_ordering entry")
        _reject_unknown(o, _ORDERING_KEYS, f"benchmark '{bid}' role_ordering entry")
        higher = _as_str(o.get("higher"), f"benchmark '{bid}' role_ordering.higher")
        lower = _as_str(o.get("lower"), f"benchmark '{bid}' role_ordering.lower")
        if higher == lower:
            raise ContractError(
                f"benchmark '{bid}' role_ordering has identical higher/lower '{higher}'"
            )
        out.append(RoleOrdering(higher=higher, lower=lower))
    return tuple(out)


def _parse_expected_playstyles(raw, bid: str) -> tuple:
    if not isinstance(raw, list):
        raise ContractError(f"benchmark '{bid}' expected_playstyles must be a list")
    out = []
    for p in raw:
        p = _require_mapping(p, f"benchmark '{bid}' expected_playstyle")
        _reject_unknown(p, _PLAYSTYLE_KEYS, f"benchmark '{bid}' expected_playstyle")
        key = _as_str(p.get("key"), f"benchmark '{bid}' playstyle.key")
        present = _as_bool(p.get("present", True), f"benchmark '{bid}' playstyle.present")
        min_tier = p.get("min_tier")
        if min_tier is not None and min_tier not in TIER_NAMES:
            raise ContractError(
                f"benchmark '{bid}' playstyle '{key}' invalid min_tier '{min_tier}'"
            )
        out.append(ExpectedPlaystyle(key=key, present=present, min_tier=min_tier))
    return tuple(out)


def _parse_expected_concerns(raw, bid: str) -> tuple:
    if not isinstance(raw, list):
        raise ContractError(f"benchmark '{bid}' expected_concerns must be a list")
    out = []
    for c in raw:
        c = _require_mapping(c, f"benchmark '{bid}' expected_concern")
        _reject_unknown(c, _CONCERN_KEYS, f"benchmark '{bid}' expected_concern")
        key = _as_str(c.get("key"), f"benchmark '{bid}' concern.key")
        present = _as_bool(c.get("present", True), f"benchmark '{bid}' concern.present")
        out.append(ExpectedConcern(key=key, present=present))
    return tuple(out)


def _parse_confidence(raw, bid: str) -> Optional[ConfidenceExpectation]:
    if raw is None:
        return None
    raw = _require_mapping(raw, f"benchmark '{bid}' confidence")
    _reject_unknown(raw, _CONFIDENCE_KEYS, f"benchmark '{bid}' confidence")
    for lvl_key in ("min_level", "max_level"):
        lvl = raw.get(lvl_key)
        if lvl is not None and lvl not in CONFIDENCE_LEVELS:
            raise ContractError(f"benchmark '{bid}' confidence.{lvl_key} invalid: '{lvl}'")
    emr = raw.get("expect_missing_required")
    if emr is not None:
        emr = _as_bool(emr, f"benchmark '{bid}' confidence.expect_missing_required")
    role = raw.get("role")
    if role is not None and not isinstance(role, str):
        raise ContractError(f"benchmark '{bid}' confidence.role must be a string")
    return ConfidenceExpectation(
        role=role,
        min_level=raw.get("min_level"),
        max_level=raw.get("max_level"),
        expect_missing_required=emr,
    )


def _parse_source_ids(raw, bid: str) -> tuple:
    if not isinstance(raw, list):
        raise ContractError(f"benchmark '{bid}' source_ids must be a list")
    out = []
    for s in raw:
        s = _require_mapping(s, f"benchmark '{bid}' source_id")
        _reject_unknown(s, _SOURCE_ID_KEYS, f"benchmark '{bid}' source_id")
        sn = _as_str(s.get("source_name"), f"benchmark '{bid}' source_id.source_name")
        spid = s.get("source_player_id")
        if spid is None or str(spid) == "":
            raise ContractError(f"benchmark '{bid}' source_id.source_player_id is required")
        out.append((sn, str(spid)))
    return tuple(out)


def _parse_scenario(raw: dict) -> Scenario:
    _reject_unknown(raw, _SCENARIO_KEYS, "scenario")
    sid = _as_str(raw.get("id"), "scenario.id")
    stype = _as_str(raw.get("type"), f"scenario '{sid}'.type")
    if stype not in SCENARIO_SPECS:
        raise ContractError(
            f"scenario '{sid}' has unknown type '{stype}' (known: {sorted(SCENARIO_SPECS)})"
        )
    params = raw.get("params") or {}
    params = _require_mapping(params, f"scenario '{sid}'.params")
    spec = SCENARIO_SPECS[stype]
    allowed = spec["required"] | spec["optional"]
    _reject_unknown(params, allowed, f"scenario '{sid}'.params")
    missing = spec["required"] - set(params)
    if missing:
        raise ContractError(f"scenario '{sid}' missing required param(s): {sorted(missing)}")
    description = (raw.get("description") or "").strip()
    if not description:
        raise ContractError(f"scenario '{sid}' must have a non-empty description")
    _validate_scenario_param_types(sid, stype, params)
    return Scenario(id=sid, type=stype, description=description, params=dict(params))


def _validate_scenario_param_types(sid: str, stype: str, p: dict) -> None:
    def _str(name):
        _as_str(p.get(name), f"scenario '{sid}'.params.{name}")

    if stype == "context_ordering":
        _str("fixture_id")
        _str("role")
        dimension = p["dimension"]
        if dimension not in CONTEXT_ORDERING_DIMENSIONS:
            raise ContractError(
                f"scenario '{sid}' dimension must be one of {list(CONTEXT_ORDERING_DIMENSIONS)}"
            )
        field_name = DIMENSION_OVERRIDE_FIELD[dimension]
        for env in ("high", "low"):
            mapping = _require_mapping(p[env], f"scenario '{sid}'.params.{env}")
            # exactly the declared dimension's override field — reject unknown fields and any
            # other dimension's field so the effect cannot come from an unrelated override.
            extra = set(mapping) - {field_name}
            if extra:
                raise ContractError(
                    f"scenario '{sid}' dimension '{dimension}' {env} may only set "
                    f"'{field_name}', not {sorted(extra)}"
                )
            if field_name not in mapping:
                raise ContractError(
                    f"scenario '{sid}' dimension '{dimension}' {env} must set '{field_name}'"
                )
            _as_str(mapping[field_name], f"scenario '{sid}'.params.{env}.{field_name}")
        mr = p["max_ratio"]
        if not isinstance(mr, Number) or isinstance(mr, bool) or not math.isfinite(float(mr)):
            raise ContractError(f"scenario '{sid}'.params.max_ratio must be a finite number")
        if float(mr) <= 1.0:
            raise ContractError(f"scenario '{sid}'.params.max_ratio must be > 1.0")
    elif stype == "minutes_monotonicity":
        _str("fixture_id")
        _str("role")
        ladder = p["minutes_ladder"]
        if (
            not isinstance(ladder, list)
            or len(ladder) < 2
            or not all(isinstance(m, int) and not isinstance(m, bool) and m >= 0 for m in ladder)
        ):
            raise ContractError(
                f"scenario '{sid}'.params.minutes_ladder must be a list of >=2 non-negative ints"
            )
        if list(ladder) != sorted(ladder):
            raise ContractError(f"scenario '{sid}'.params.minutes_ladder must be non-decreasing")
    elif stype == "form_gating":
        _str("fixture_id")
        _str("role")
        rfi = p["recent_form_index"]
        if not isinstance(rfi, Number) or isinstance(rfi, bool) or not math.isfinite(float(rfi)):
            raise ContractError(
                f"scenario '{sid}'.params.recent_form_index must be a finite number"
            )
        lo_d, hi_d = RECENT_FORM_INDEX_DOMAIN
        if not (lo_d <= float(rfi) <= hi_d):
            raise ContractError(
                f"scenario '{sid}'.params.recent_form_index {rfi} outside supported "
                f"domain [{lo_d}, {hi_d}]"
            )
    elif stype == "playstyle_tiers":
        _str("position_group")
        _str("playstyle_key")
        _str("metric")
    elif stype == "concern_boundary":
        _str("position_group")
        _str("concern_key")
        _str("metric")


def confidence_rank(level: str) -> int:
    return _CONF_RANK.get(ConfidenceLevel(level), 0)
