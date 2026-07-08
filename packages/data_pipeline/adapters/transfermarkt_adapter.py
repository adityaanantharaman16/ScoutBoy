"""Transfermarkt dataset adapter (Phase 2) — dcaribou/transfermarkt-datasets.

This is the intended primary identity/market source for a real dataset. It reads
from a local DuckDB file if available, else CSV exports. It is NOT required for the
MVP (the sample adapter covers the DoD), so fetch() fails loudly with guidance when
the dataset is absent rather than silently returning nothing.

The mapping helpers are pure and unit-testable so the canonical mapping is verified
without shipping the multi-hundred-MB dataset.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from .base import (
    CanonicalAppearance,
    CanonicalCompetition,
    CanonicalMetric,
    CanonicalPlayer,
    CanonicalSeason,
    CanonicalTeam,
    IngestBundle,
    SourceAdapter,
)

SOURCE_NAME = "transfermarkt"

# European competition ids that fall inside the MVP universe. Extend as needed.
EUROPEAN_COMPETITION_HINT = ("GB1", "ES1", "IT1", "L1", "FR1", "PO1", "NL1", "BE1")


def map_player_row(row: dict) -> CanonicalPlayer:
    """Map a transfermarkt `players` row into a CanonicalPlayer."""
    return CanonicalPlayer(
        source_name=SOURCE_NAME,
        source_player_id=str(row["player_id"]),
        canonical_name=row.get("name") or row.get("pretty_name") or "Unknown",
        birth_date=row.get("date_of_birth"),
        nationality=row.get("country_of_citizenship"),
        preferred_foot=row.get("foot"),
        height_cm=_to_int(row.get("height_in_cm")),
        primary_position=_normalize_position(row.get("sub_position") or row.get("position")),
        source_url=row.get("url"),
        raw_name=row.get("name"),
    )


def map_valuation_row(row: dict) -> Optional[CanonicalMetric]:
    """Map a transfermarkt `player_valuations` row into a public-value metric."""
    value = _to_float(row.get("market_value_in_eur"))
    if value is None:
        return None
    return CanonicalMetric(
        source_player_id=str(row["player_id"]),
        season_label=str(row.get("season") or ""),
        metric_name="public_value_eur",
        metric_value=value,
        unit="eur",
        raw_payload={"date": row.get("date")},
    )


def _normalize_position(pos: Optional[str]) -> Optional[str]:
    if not pos:
        return None
    mapping = {
        # in-scope (attackers + midfielders)
        "Centre-Forward": "CF",
        "Second Striker": "CF",
        "Left Winger": "LW",
        "Right Winger": "RW",
        "Attacking Midfield": "CAM",
        "Central Midfield": "CM",
        "Defensive Midfield": "DM",
        # out-of-scope — retained (mapped to a real code) so the MVP-universe filter and
        # the data-quality report can flag/exclude them rather than silently dropping.
        "Goalkeeper": "GK",
        "Centre-Back": "CB",
        "Left-Back": "LB",
        "Right-Back": "RB",
        "Left Midfield": "LM",
        "Right Midfield": "RM",
    }
    return mapping.get(pos)


def _to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _read_csv(path: Path, required: tuple[str, ...]) -> list[dict]:
    import csv

    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        missing = [c for c in required if c not in header]
        if missing:
            raise ValueError(f"{path.name} missing required columns: {missing}")
        return list(reader)


def _season_dates(label: str) -> dict:
    """Derive start/end dates from a season label like '2024-2025' or '2024/25'."""
    import re

    years = re.findall(r"\d{4}", label)
    if years:
        start_year = int(years[0])
        end_year = int(years[1]) if len(years) > 1 else start_year + 1
        return {"start_date": f"{start_year}-08-01", "end_date": f"{end_year}-06-30"}
    return {}


def _contract_year(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        return float(str(value)[:4])
    except ValueError:
        return None


class TransfermarktAdapter(SourceAdapter):
    """Reads a Transfermarkt-style CSV directory (or DuckDB file) into a full canonical
    bundle. Raw ingest keeps ALL players (incl. out-of-scope positions); the MVP-universe
    filter narrows the view later. Introspects which files exist and validates required
    columns before mapping.

    Expected CSV files (subset of dcaribou/transfermarkt-datasets, pre-shaped):
      competitions.csv  competition_id, name  [slug, country_name, type, confederation]
      clubs.csv         club_id, name         [slug, domestic_competition_id]
      players.csv       player_id, name       [date_of_birth, country_of_citizenship, foot,
                                               height_in_cm, sub_position/position,
                                               current_club_id, contract_expiration_date,
                                               market_value_in_eur, url]
      appearances.csv   (optional) player_id, club_id, competition_id, season, minutes,
                                   appearances, starts, position_group
      player_valuations.csv (optional) player_id, season, market_value_in_eur [date]
    """

    name = SOURCE_NAME

    def __init__(self, csv_dir: Optional[Path] = None, duckdb_path: Optional[Path] = None):
        self.csv_dir = Path(csv_dir) if csv_dir else None
        self.duckdb_path = Path(duckdb_path) if duckdb_path else None

    def fetch(self) -> IngestBundle:
        if self.duckdb_path and self.duckdb_path.exists():
            return self._fetch_duckdb()
        if self.csv_dir and self.csv_dir.exists():
            return self._fetch_csv()
        raise FileNotFoundError(
            "Transfermarkt dataset not found. Download dcaribou/transfermarkt-datasets "
            "(CSV exports or DuckDB) and pass --input-path <dir>. The MVP does not require "
            "this source — use --source sample."
        )

    # -- CSV path --------------------------------------------------------------
    def _fetch_csv(self) -> IngestBundle:
        d = self.csv_dir
        for required_file in ("players.csv", "clubs.csv", "competitions.csv"):
            if not (d / required_file).exists():
                raise FileNotFoundError(f"Transfermarkt CSV dir missing {required_file}: {d}")

        bundle = IngestBundle(source_name=SOURCE_NAME, source_snapshot_id=f"transfermarkt@{d.name}")

        # competitions
        comp_slug_by_id: dict[str, str] = {}
        for row in _read_csv(d / "competitions.csv", ("competition_id", "name")):
            cid = str(row["competition_id"])
            slug = (row.get("slug") or cid).strip()
            comp_slug_by_id[cid] = slug
            conf = (row.get("confederation") or "europa").lower()
            bundle.competitions.append(
                CanonicalCompetition(
                    slug=slug,
                    name=row["name"],
                    country=row.get("country_name"),
                    competition_type=row.get("type") or "domestic_top_tier",
                    is_european="europ" in conf or "uefa" in conf,
                )
            )

        # clubs
        club_slug_by_id: dict[str, str] = {}
        for row in _read_csv(d / "clubs.csv", ("club_id", "name")):
            cid = str(row["club_id"])
            slug = (row.get("slug") or cid).strip()
            club_slug_by_id[cid] = slug
            bundle.teams.append(
                CanonicalTeam(
                    slug=slug,
                    name=row["name"],
                    competition_slug=comp_slug_by_id.get(str(row.get("domestic_competition_id"))),
                )
            )

        # appearances (optional) — also gives us each player's primary season
        primary_season: dict[str, str] = {}
        best_minutes: dict[str, int] = {}
        seasons: set = set()
        appr_path = d / "appearances.csv"
        missing_minutes_flag = False
        if appr_path.exists():
            for row in _read_csv(
                appr_path,
                ("player_id", "club_id", "competition_id", "season", "minutes"),
            ):
                spid = str(row["player_id"])
                minutes = _to_int(row.get("minutes")) or 0
                season = str(row["season"]).strip()
                seasons.add(season)
                bundle.appearances.append(
                    CanonicalAppearance(
                        source_player_id=spid,
                        team_slug=club_slug_by_id.get(str(row["club_id"]), str(row["club_id"])),
                        competition_slug=comp_slug_by_id.get(
                            str(row["competition_id"]), str(row["competition_id"])
                        ),
                        season_label=season,
                        minutes=minutes,
                        appearances=_to_int(row.get("appearances")) or 0,
                        starts=_to_int(row.get("starts")) or 0,
                        position_group=row.get("position_group") or None,
                    )
                )
                if minutes > best_minutes.get(spid, -1):
                    best_minutes[spid] = minutes
                    primary_season[spid] = season
        else:
            missing_minutes_flag = True

        default_season = sorted(seasons)[-1] if seasons else "2024-2025"
        if default_season not in seasons:
            seasons.add(default_season)
        bundle.seasons = [
            CanonicalSeason(label=s, is_current=(s == default_season), **_season_dates(s))
            for s in sorted(seasons)
        ]

        # players (+ market/contract metrics on the player's primary season)
        missing_club = 0
        for row in _read_csv(d / "players.csv", ("player_id", "name")):
            cp = map_player_row(row)
            bundle.players.append(cp)
            spid = cp.source_player_id
            season = primary_season.get(spid, default_season)
            if not row.get("current_club_id"):
                missing_club += 1
            mv = _to_float(row.get("market_value_in_eur"))
            if mv is not None:
                bundle.metrics.append(
                    CanonicalMetric(
                        spid,
                        season,
                        "public_value_eur",
                        mv,
                        "eur",
                        raw_payload={"origin": "players.csv"},
                    )
                )
            contract = _contract_year(row.get("contract_expiration_date"))
            if contract is not None:
                bundle.metrics.append(
                    CanonicalMetric(spid, season, "contract_until", contract, "year")
                )

        # player_valuations (optional) — per-season public value
        val_path = d / "player_valuations.csv"
        if val_path.exists():
            for row in _read_csv(val_path, ("player_id", "market_value_in_eur")):
                metric = map_valuation_row(row)
                if metric and not metric.season_label:
                    metric.season_label = primary_season.get(
                        metric.source_player_id, default_season
                    )
                if metric:
                    bundle.metrics.append(metric)

        bundle.adapter_warnings = [
            {
                "check": "missing_current_club",
                "severity": "warn" if missing_club else "ok",
                "count": missing_club,
                "details": [],
            },
            {
                "check": "appearances_file_absent",
                "severity": "warn" if missing_minutes_flag else "ok",
                "count": 1 if missing_minutes_flag else 0,
                "details": [],
            },
        ]
        return bundle

    # -- DuckDB path (optional dependency) -------------------------------------
    def _fetch_duckdb(self) -> IngestBundle:  # pragma: no cover - requires the external dataset
        import duckdb

        con = duckdb.connect(str(self.duckdb_path), read_only=True)
        bundle = IngestBundle(source_name=SOURCE_NAME, source_snapshot_id=str(self.duckdb_path))
        for row in con.execute("SELECT * FROM players").fetch_arrow_table().to_pylist():
            bundle.players.append(map_player_row(row))
        try:
            for row in (
                con.execute("SELECT * FROM player_valuations").fetch_arrow_table().to_pylist()
            ):
                metric = map_valuation_row(row)
                if metric:
                    bundle.metrics.append(metric)
        except Exception:  # noqa: BLE001 - valuations table optional
            pass
        return bundle
