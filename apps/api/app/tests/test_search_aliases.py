"""The Discovery alias registry: normalization, validation, and the shipped file.

Two things have to be true for a configuration-backed lookup table to be safe. It has
to normalize inputs the way the documentation claims, and it has to REFUSE a malformed
file rather than loading an empty table and leaving the feature silently disabled -
which would look exactly like the bug it was added to fix.
"""

from __future__ import annotations

import pytest
import yaml

from app.core.search_aliases import (
    ALIAS_FILE,
    AliasConfigError,
    club_alias_targets,
    league_alias_targets,
    load_aliases,
    normalize_alias_key,
    parse_aliases,
)


# ---------------------------------------------------------------------------
# key normalization
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "raw,expected",
    [
        ("psg", "psg"),
        ("PSG", "psg"),
        ("  psg  ", "psg"),
        ("P.S.G.", "psg"),
        ("p.s.g", "psg"),
        ("Paris SG", "paris sg"),
        ("paris   sg", "paris sg"),
        ("  Paris\tSG\n", "paris sg"),
        ("Man Utd", "man utd"),
        ("BARÇA", "barça"),
        ("O'Brien FC", "obrien fc"),
        ("", ""),
        ("   ", ""),
    ],
)
def test_normalization(raw, expected):
    assert normalize_alias_key(raw) == expected


def test_hyphens_are_preserved():
    """A hyphen carries meaning in real club names and is never stripped."""
    assert normalize_alias_key("Saint-Étienne") == "saint-étienne"
    assert normalize_alias_key("Paris Saint-Germain") == "paris saint-germain"


def test_normalization_uses_python_lower():
    """The same case rule the SQL predicates use, so the two layers cannot disagree."""
    for value in ("İPEK", "STRAẞE", "ΟΔΟΣ", "ЖУК"):
        assert normalize_alias_key(value) == value.lower()


# ---------------------------------------------------------------------------
# lookup
# ---------------------------------------------------------------------------
def test_unknown_input_is_not_an_alias():
    for value in (None, "", "   ", "no-such-club", "qpr", "Tottenham Hotspur"):
        assert club_alias_targets(value) == (), value
        assert league_alias_targets(value) == (), value


def test_a_known_alias_returns_its_targets():
    assert club_alias_targets("psg") == ("paris saint-germain", "paris_sg")
    assert club_alias_targets("  P.S.G. ") == club_alias_targets("psg")
    assert league_alias_targets("portgual") == ("portugal",)


def test_an_ambiguous_alias_keeps_every_target():
    assert set(club_alias_targets("fcb")) == {"barcelona", "bayern munich", "bayern_munich"}


# ---------------------------------------------------------------------------
# the shipped registry
# ---------------------------------------------------------------------------
def test_shipped_registry_loads_and_is_versioned():
    registry = load_aliases()
    assert registry.version == "v1"
    assert len(registry.clubs) >= 20, "the curated club registry has shrunk unexpectedly"
    assert registry.leagues, "the league misspelling table is empty"


def test_shipped_registry_is_cached_per_process():
    """One parse per process. A re-read per request would turn a table into I/O."""
    assert load_aliases() is load_aliases()


def test_every_shipped_key_is_already_normalized():
    """A key that is not in normalized form could never be reached by a lookup."""
    registry = load_aliases()
    for table in (registry.clubs, registry.leagues):
        for key in table:
            assert normalize_alias_key(key) == key, key


def test_no_dangerously_generic_club_alias_ships():
    """Each of these names several major clubs; none may silently resolve to one."""
    registry = load_aliases()
    for generic in ("united", "city", "real", "blues", "athletic", "sporting", "inter"):
        assert generic not in registry.clubs, generic


def test_every_target_is_a_plausible_search_substring():
    registry = load_aliases()
    for key, targets in {**registry.clubs, **registry.leagues}.items():
        assert targets, key
        for target in targets:
            assert target == target.strip(), (key, target)
            assert "  " not in target, (key, target)
            # A one- or two-character target would behave as a wildcard against every
            # stored club, which is the opposite of what a curated alias is for.
            assert len(target) >= 4, (key, target)


# ---------------------------------------------------------------------------
# validation fails loudly
# ---------------------------------------------------------------------------
GOOD = {"version": "v1", "club_aliases": [{"alias": "psg", "targets": ["paris"]}]}


@pytest.mark.parametrize(
    "document,message",
    [
        ("not a mapping", "must be a mapping"),
        ({}, "version"),
        ({"version": ""}, "version"),
        ({"version": "v1", "surprise": 1}, "unknown top-level keys"),
        ({"version": "v1", "club_aliases": {}}, "must be a list"),
        ({"version": "v1", "club_aliases": ["psg"]}, "must be a mapping"),
        ({"version": "v1", "club_aliases": [{"targets": ["x"]}]}, "non-empty string 'alias'"),
        ({"version": "v1", "club_aliases": [{"alias": "  ", "targets": ["x"]}]}, "'alias'"),
        ({"version": "v1", "club_aliases": [{"alias": "psg"}]}, "non-empty 'targets'"),
        ({"version": "v1", "club_aliases": [{"alias": "psg", "targets": []}]}, "non-empty"),
        ({"version": "v1", "club_aliases": [{"alias": "psg", "targets": [""]}]}, "empty target"),
        ({"version": "v1", "club_aliases": [{"alias": "psg", "targets": [3]}]}, "empty target"),
        (
            {"version": "v1", "club_aliases": [{"alias": "PSG", "targets": ["paris"]}]},
            "not in normalized form",
        ),
        (
            {
                "version": "v1",
                "club_aliases": [
                    {"alias": "psg", "targets": ["paris"]},
                    {"alias": "psg", "targets": ["other"]},
                ],
            },
            "duplicate alias",
        ),
        (
            {"version": "v1", "club_aliases": [{"alias": "psg", "targets": ["x"], "extra": 1}]},
            "unknown keys",
        ),
        (
            {"version": "v1", "league_aliases": [{"alias": "portgual", "targets": []}]},
            "non-empty",
        ),
    ],
)
def test_malformed_registry_raises(document, message):
    with pytest.raises(AliasConfigError) as excinfo:
        parse_aliases(document)
    assert message in str(excinfo.value)


def test_a_valid_document_parses():
    registry = parse_aliases(GOOD)
    assert registry.club_targets("PSG") == ("paris",)
    assert registry.league_targets("psg") == ()


def test_duplicate_targets_are_collapsed_not_rejected():
    registry = parse_aliases(
        {"version": "v1", "club_aliases": [{"alias": "x", "targets": ["a", "a", " a "]}]}
    )
    assert registry.club_targets("x") == ("a",)


def test_a_missing_file_raises_rather_than_disabling_aliases(tmp_path):
    with pytest.raises(AliasConfigError) as excinfo:
        load_aliases(tmp_path / "nowhere")
    assert "not found" in str(excinfo.value)


def test_invalid_yaml_raises(tmp_path):
    directory = tmp_path / "discovery"
    directory.mkdir()
    (directory / ALIAS_FILE).write_text("version: v1\n  bad: [indent", encoding="utf-8")
    with pytest.raises(AliasConfigError) as excinfo:
        load_aliases(directory)
    assert "not valid YAML" in str(excinfo.value)


def test_the_registry_is_read_as_utf8(tmp_path):
    """Accented aliases survive the load on any platform locale."""
    directory = tmp_path / "discovery"
    directory.mkdir()
    (directory / ALIAS_FILE).write_text(
        yaml.safe_dump(
            {"version": "v1", "club_aliases": [{"alias": "barça", "targets": ["barcelona"]}]},
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    assert load_aliases(directory).club_targets("BARÇA") == ("barcelona",)
