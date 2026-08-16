"""Deterministic club and league search aliases, loaded once from configuration.

Discovery's Context filters are free text over stored football names, and stored
football names are not what scouts type. Nobody types "Paris Saint-Germain" to find
PSG, and nobody types "Tottenham Hotspur" to find Spurs. Before this module the club
field only did case-insensitive substring matching, so those inputs returned nothing
and the control read as broken.

**This is a lookup table, not fuzzy matching.** There is no edit distance, no phonetic
key, no scoring and no "did you mean". An input either normalizes to a key in
``configs/discovery/search_aliases_v1.yaml`` or it does not; anything that does not
falls straight through to the ordinary substring search it always had. That matters for
a scouting tool: a result set has to be explainable, and "these are the clubs the
registry says PSG means" is explainable in a way that "these scored above 0.82" is not.

**It costs no SQL.** The registry is parsed and validated once per process
(:func:`load_aliases` is cached) and its targets are compiled into the same
``WHERE`` clause the plain needle would have produced. Discovery's four-statement
request shape is unchanged, and nothing is filtered in Python after the fact.

**Malformed configuration fails loudly.** A missing key, an empty target list, a
non-normalized alias or a duplicate key raises :class:`AliasConfigError` at load time
rather than silently disabling aliases and leaving the field quietly broken again.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Optional

import yaml
from rolefit.paths import config_dir

#: Directory and file the registry lives in, relative to ``configs/``.
ALIAS_DIRECTORY = "discovery"
ALIAS_FILE = "search_aliases_v1.yaml"

#: Punctuation that only ever appears as abbreviation decoration, so ``P.S.G.`` and
#: ``PSG`` are the same key. Hyphens are deliberately NOT here: they carry meaning in
#: real club names ("Saint-Étienne", "Paris Saint-Germain").
_ABBREVIATION_PUNCTUATION = re.compile(r"[.·'’`]")
_WHITESPACE = re.compile(r"\s+")


class AliasConfigError(RuntimeError):
    """The alias registry is malformed. Raised at load time, never swallowed."""


def normalize_alias_key(value: str) -> str:
    """The lookup key for a typed input or a configured alias.

    Outer whitespace trimmed, repeated whitespace collapsed to one space, lowercased
    with Python's own ``str.lower()`` — the same case rule the SQL predicates use, so
    the alias layer and the substring layer cannot disagree about what "lowercase"
    means — and abbreviation punctuation removed.

    Only the LOOKUP is normalized. The user's original text is what gets searched when
    no alias matches, and stored names are never rewritten.
    """
    lowered = _WHITESPACE.sub(" ", value.strip()).lower()
    stripped = _ABBREVIATION_PUNCTUATION.sub("", lowered)
    return _WHITESPACE.sub(" ", stripped).strip()


@dataclass(frozen=True)
class AliasRegistry:
    """One parsed registry: normalized key -> the literal substrings it stands for."""

    version: str
    clubs: dict
    leagues: dict

    def club_targets(self, needle: Optional[str]) -> tuple:
        """The club substrings ``needle`` resolves to, or ``()`` if it is not an alias."""
        return _lookup(self.clubs, needle)

    def league_targets(self, needle: Optional[str]) -> tuple:
        """The league substrings ``needle`` resolves to, or ``()`` if not an alias."""
        return _lookup(self.leagues, needle)


def _lookup(table: dict, needle: Optional[str]) -> tuple:
    if not needle:
        return ()
    return table.get(normalize_alias_key(needle), ())


def _parse_group(raw, *, group: str) -> dict:
    """Validate one alias group into ``{normalized key: (target, ...)}``."""
    if raw is None:
        return {}
    if not isinstance(raw, list):
        raise AliasConfigError(f"'{group}' must be a list, got {type(raw).__name__}")

    table: dict = {}
    for index, entry in enumerate(raw):
        where = f"{group}[{index}]"
        if not isinstance(entry, dict):
            raise AliasConfigError(f"{where} must be a mapping, got {type(entry).__name__}")
        unknown = set(entry) - {"alias", "targets"}
        if unknown:
            raise AliasConfigError(f"{where} has unknown keys: {', '.join(sorted(unknown))}")

        alias = entry.get("alias")
        if not isinstance(alias, str) or not alias.strip():
            raise AliasConfigError(f"{where} needs a non-empty string 'alias'")
        key = normalize_alias_key(alias)
        if not key:
            raise AliasConfigError(f"{where}: alias {alias!r} normalizes to nothing")
        # The file must already be written in normalized form. An alias that only
        # differs by case or punctuation could never be reached through the lookup,
        # so shipping one would be a silent dead entry.
        if key != alias:
            raise AliasConfigError(
                f"{where}: alias {alias!r} is not in normalized form (expected {key!r})"
            )
        if key in table:
            raise AliasConfigError(f"{where}: duplicate alias {key!r}")

        targets = entry.get("targets")
        if not isinstance(targets, list) or not targets:
            raise AliasConfigError(f"{where}: alias {key!r} needs a non-empty 'targets' list")
        cleaned: list = []
        for target in targets:
            if not isinstance(target, str) or not target.strip():
                raise AliasConfigError(f"{where}: alias {key!r} has an empty target")
            value = _WHITESPACE.sub(" ", target.strip())
            if value not in cleaned:
                cleaned.append(value)
        table[key] = tuple(cleaned)
    return table


def parse_aliases(data) -> AliasRegistry:
    """Validate an already-loaded registry document. Exposed for tests."""
    if not isinstance(data, dict):
        raise AliasConfigError("the alias registry must be a mapping")
    unknown = set(data) - {"version", "club_aliases", "league_aliases"}
    if unknown:
        raise AliasConfigError(f"unknown top-level keys: {', '.join(sorted(unknown))}")
    version = data.get("version")
    if not isinstance(version, str) or not version.strip():
        raise AliasConfigError("the alias registry needs a non-empty 'version'")
    return AliasRegistry(
        version=version,
        clubs=_parse_group(data.get("club_aliases"), group="club_aliases"),
        leagues=_parse_group(data.get("league_aliases"), group="league_aliases"),
    )


@cache
def load_aliases(directory: Optional[Path] = None) -> AliasRegistry:
    """The registry, parsed and validated once per process.

    Cached deliberately: this is read on every Discovery request that supplies a club
    or league, and re-reading a file per request would turn a lookup table into a
    per-request I/O cost. It performs no database work at all.

    UTF-8 explicitly — the registry carries accented aliases such as ``barça``, and a
    locale-encoded read would turn them into keys nothing can match.
    """
    root = Path(directory) if directory is not None else (config_dir() / ALIAS_DIRECTORY)
    path = root / ALIAS_FILE
    try:
        with open(path, encoding="utf-8") as handle:
            data = yaml.safe_load(handle)
    except FileNotFoundError as exc:  # pragma: no cover - a packaging error, not a state
        raise AliasConfigError(f"alias registry not found at {path}") from exc
    except yaml.YAMLError as exc:
        raise AliasConfigError(f"alias registry at {path} is not valid YAML: {exc}") from exc
    return parse_aliases(data)


def club_alias_targets(needle: Optional[str]) -> tuple:
    """Club substrings for a typed needle, or ``()`` when it is not an alias."""
    return load_aliases().club_targets(needle)


def league_alias_targets(needle: Optional[str]) -> tuple:
    """League substrings for a typed needle, or ``()`` when it is not an alias."""
    return load_aliases().league_targets(needle)
