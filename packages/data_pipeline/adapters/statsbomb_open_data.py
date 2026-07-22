"""StatsBomb Open Data reader for ScoutBoy's provider-agnostic domain model.

The adapter reads the official local JSON layout from statsbomb/open-data:
competitions.json, matches/{competition_id}/{season_id}.json, events/{match_id}.json,
lineups/{match_id}.json, and optional three-sixty/{match_id}.json files.

It deliberately does not fetch from GitHub. Tests and local demos should use pinned
fixtures so imports are deterministic and do not depend on the full Open Data archive.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Optional, Union

from data_pipeline.coverage import (
    coverage_confidence,
    recency_days,
    role_similarity_confidence,
    sample_confidence,
    weakest_confidence,
)

from .base import (
    CanonicalAppearance,
    CanonicalCompetition,
    CanonicalDataCoverage,
    CanonicalEvent,
    CanonicalLineupAppearance,
    CanonicalMatch,
    CanonicalMetric,
    CanonicalPlayer,
    CanonicalPlayerEvidence,
    CanonicalProvider,
    CanonicalProviderIdentifier,
    CanonicalRegistration,
    CanonicalSeason,
    CanonicalTeam,
    IngestBundle,
    ProviderCapabilities,
    SourceAdapter,
)
from .statsbomb_pilot import _accumulate_match, _blank_counts, _canonical

SOURCE_NAME = "statsbomb_open_data"
PROVIDER_SLUG = "statsbomb_open_data"
ATTRIBUTION = "StatsBomb Open Data: https://github.com/statsbomb/open-data"
LICENSE_URL = "https://github.com/statsbomb/open-data/blob/master/LICENSE.pdf"


def _read_json(path: Path):
    return json.loads(path.read_text())


def _slugify(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return text or "unknown"


def _competition_slug(row: dict) -> str:
    return _slugify(f"{row.get('country_name')} {row.get('competition_name')}")


def _team_slug(team_id: Union[int, str]) -> str:
    return f"statsbomb_team_{team_id}"


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    return date.fromisoformat(value[:10])


def _season_dates_from_name(season_name: str) -> tuple[Optional[date], Optional[date]]:
    years = [int(y) for y in re.findall(r"\d{4}", season_name or "")]
    if len(years) >= 2:
        return date(years[0], 7, 1), date(years[1], 6, 30)
    if len(years) == 1:
        return date(years[0], 1, 1), date(years[0], 12, 31)
    return None, None


def _position_group(position_name: Optional[str]) -> Optional[str]:
    if not position_name:
        return None
    p = position_name.lower()
    if "goalkeeper" in p:
        return "GK"
    if "back" in p:
        return "DEF"
    if "midfield" in p:
        return "MID"
    if "wing" in p or "forward" in p or "striker" in p:
        return "ATT"
    return None


def _primary_position(position_name: Optional[str]) -> Optional[str]:
    if not position_name:
        return None
    p = position_name.lower()
    if "goalkeeper" in p:
        return "GK"
    if "left wing back" in p or "left back" in p:
        return "LB"
    if "right wing back" in p or "right back" in p:
        return "RB"
    if "back" in p:
        return "CB"
    if "defensive midfield" in p:
        return "DM"
    if "midfield" in p:
        return "CM"
    if "left wing" in p or "left center forward" in p:
        return "LW"
    if "right wing" in p or "right center forward" in p:
        return "RW"
    if "forward" in p or "striker" in p:
        return "CF"
    return None


def _time_to_minute(value: Optional[str], default: float) -> float:
    if not value:
        return default
    bits = value.split(":")
    if len(bits) < 2:
        return default
    return int(bits[0]) + int(bits[1]) / 60.0


def _event_match_duration(events: list[dict]) -> float:
    half_ends = [
        float(e.get("minute", 0)) for e in events if e.get("type", {}).get("name") == "Half End"
    ]
    if half_ends:
        return max(half_ends)
    if events:
        return float(max(e.get("minute", 0) for e in events))
    return 90.0


def _latest_commit_hint(root_dir: Path) -> Optional[str]:
    git_head = root_dir / ".git" / "HEAD"
    if git_head.exists():
        return hashlib.sha256(git_head.read_bytes()).hexdigest()
    return None


class StatsBombOpenDataAdapter(SourceAdapter):
    name = SOURCE_NAME
    capabilities = ProviderCapabilities(
        provider_id=SOURCE_NAME,
        display_name="StatsBomb Open Data",
        provider_type="event",
        ingestion_mode="local_snapshot",
        credentials_required=False,
        supported_entities=frozenset(
            {
                "players",
                "teams",
                "competitions",
                "seasons",
                "appearances",
                "lineups",
                "matches",
                "events",
            }
        ),
        supported_metric_keys=frozenset(
            {"performance_covered_minutes", "performance_covered_appearances"}
        ),
        supported_metric_families=frozenset({"performance", "event"}),
        coverage_dimensions=frozenset(
            {"competition", "season", "team", "match", "player", "event_location"}
        ),
        freshness_semantics="local immutable snapshot with match-date recency",
        attribution_required=True,
        attribution=ATTRIBUTION,
        license_url=LICENSE_URL,
        known_limitations=("Coverage is exactly the local files selected; absence is missing.",),
    )
    name = SOURCE_NAME

    def __init__(
        self,
        root_dir: Path,
        *,
        competition_ids: Optional[list[int]] = None,
        season_ids: Optional[list[int]] = None,
        recent_seasons: Optional[int] = 2,
        as_of_date: Optional[date] = None,
    ):
        self.root_dir = Path(root_dir)
        self.competition_ids = set(competition_ids or [])
        self.season_ids = set(season_ids or [])
        self.recent_seasons = recent_seasons
        self.as_of_date = as_of_date

    def _matches_path(self, competition_id: int, season_id: int) -> Path:
        return self.root_dir / "matches" / str(competition_id) / f"{season_id}.json"

    def _events_path(self, match_id: int) -> Path:
        return self.root_dir / "events" / f"{match_id}.json"

    def _lineups_path(self, match_id: int) -> Path:
        return self.root_dir / "lineups" / f"{match_id}.json"

    def _three_sixty_path(self, match_id: int) -> Path:
        return self.root_dir / "three-sixty" / f"{match_id}.json"

    def _competition_rows(self) -> list[dict]:
        rows = _read_json(self.root_dir / "competitions.json")
        if self.competition_ids:
            rows = [r for r in rows if int(r["competition_id"]) in self.competition_ids]
        if self.season_ids:
            rows = [r for r in rows if int(r["season_id"]) in self.season_ids]

        enriched = []
        for row in rows:
            match_path = self._matches_path(int(row["competition_id"]), int(row["season_id"]))
            matches = _read_json(match_path) if match_path.exists() else []
            dates = [_parse_date(m.get("match_date")) for m in matches]
            dates = [d for d in dates if d is not None]
            if dates:
                start_date, end_date = min(dates), max(dates)
            else:
                start_date, end_date = _season_dates_from_name(row.get("season_name", ""))
            enriched.append({**row, "_start_date": start_date, "_end_date": end_date})

        if self.recent_seasons and self.recent_seasons > 0:
            grouped: dict[int, list[dict]] = defaultdict(list)
            for row in enriched:
                grouped[int(row["competition_id"])].append(row)
            selected = []
            for comp_rows in grouped.values():
                comp_rows.sort(
                    key=lambda r: (
                        r["_end_date"] or date.min,
                        r["_start_date"] or date.min,
                        int(r["season_id"]),
                    ),
                    reverse=True,
                )
                selected.extend(comp_rows[: self.recent_seasons])
            enriched = selected
        return enriched

    def fetch(self) -> IngestBundle:
        rows = self._competition_rows()
        snapshot_key = (
            "statsbomb_open_data@"
            + hashlib.sha1(
                "|".join(
                    f"{r['competition_id']}-{r['season_id']}-{r.get('match_updated')}"
                    for r in sorted(rows, key=lambda x: (x["competition_id"], x["season_id"]))
                ).encode()
            ).hexdigest()[:12]
        )
        bundle = IngestBundle(
            source_name=SOURCE_NAME,
            source_snapshot_id=snapshot_key,
            providers=[
                CanonicalProvider(
                    slug=PROVIDER_SLUG,
                    name="StatsBomb Open Data",
                    provider_type="event",
                    license_url=LICENSE_URL,
                    attribution=ATTRIBUTION,
                )
            ],
            snapshot_metadata={
                "provider": "StatsBomb Open Data",
                "dataset_version": _latest_commit_hint(self.root_dir),
                "as_of_date": self.as_of_date.isoformat() if self.as_of_date else None,
                "local_path": str(self.root_dir),
                "license_url": LICENSE_URL,
                "metadata": {"attribution": ATTRIBUTION, "recent_seasons": self.recent_seasons},
            },
        )
        seen_players: set[str] = set()
        seen_teams: set[str] = set()
        seen_competitions: set[str] = set()
        seen_seasons: set[str] = set()
        seen_registrations: set[tuple[str, str, str, str]] = set()

        for row in rows:
            competition_id = int(row["competition_id"])
            season_id = int(row["season_id"])
            row_payload = {k: v for k, v in row.items() if not k.startswith("_")}
            comp_slug = _competition_slug(row)
            season_label = row.get("season_name") or str(season_id)
            start_date = row.get("_start_date")
            end_date = row.get("_end_date")
            if comp_slug not in seen_competitions:
                bundle.competitions.append(
                    CanonicalCompetition(
                        slug=comp_slug,
                        name=row.get("competition_name") or comp_slug,
                        country=row.get("country_name"),
                        competition_type=(
                            "international" if row.get("competition_international") else "domestic"
                        ),
                        is_european=row.get("country_name")
                        in {
                            "Europe",
                            "Germany",
                            "Spain",
                            "England",
                            "Italy",
                            "France",
                            "Netherlands",
                            "Portugal",
                            "Belgium",
                        },
                    )
                )
                bundle.provider_identifiers.append(
                    CanonicalProviderIdentifier(
                        provider_slug=PROVIDER_SLUG,
                        entity_type="competition",
                        scoutboy_key=comp_slug,
                        provider_entity_id=str(competition_id),
                        provider_entity_name=row.get("competition_name"),
                        raw_payload=row_payload,
                    )
                )
                seen_competitions.add(comp_slug)
            if season_label not in seen_seasons:
                bundle.seasons.append(
                    CanonicalSeason(
                        label=season_label,
                        is_current=False,
                        start_date=start_date.isoformat() if start_date else None,
                        end_date=end_date.isoformat() if end_date else None,
                    )
                )
                bundle.provider_identifiers.append(
                    CanonicalProviderIdentifier(
                        provider_slug=PROVIDER_SLUG,
                        entity_type="season",
                        scoutboy_key=season_label,
                        provider_entity_id=str(season_id),
                        provider_entity_name=season_label,
                        raw_payload=row_payload,
                    )
                )
                seen_seasons.add(season_label)

            matches_path = self._matches_path(competition_id, season_id)
            if not matches_path.exists():
                bundle.adapter_warnings.append(
                    {
                        "check": "statsbomb_matches_file_missing",
                        "severity": "warn",
                        "count": 1,
                        "details": [str(matches_path)],
                    }
                )
                continue
            matches = _read_json(matches_path)
            events_available = 0
            lineups_available = 0
            three_sixty_available = 0
            player_minutes: dict[str, int] = defaultdict(int)
            player_apps: Counter[str] = Counter()
            player_starts: Counter[str] = Counter()
            player_team: dict[str, str] = {}
            player_positions: dict[str, str] = {}
            player_metric_counts: dict[str, int] = defaultdict(int)
            counts_by_player: dict[int, dict] = defaultdict(_blank_counts)
            names_by_player: dict[int, str] = {}
            teams_by_player: dict[int, str] = {}

            for match in matches:
                match_id = int(match["match_id"])
                home = match.get("home_team") or {}
                away = match.get("away_team") or {}
                for team_block, side in ((home, "home"), (away, "away")):
                    team_id = team_block.get(f"{side}_team_id")
                    if team_id is None:
                        continue
                    slug = _team_slug(team_id)
                    if slug not in seen_teams:
                        bundle.teams.append(
                            CanonicalTeam(
                                slug=slug,
                                name=team_block.get(f"{side}_team_name") or slug,
                                competition_slug=comp_slug,
                                country=(team_block.get("country") or {}).get("name"),
                            )
                        )
                        bundle.provider_identifiers.append(
                            CanonicalProviderIdentifier(
                                provider_slug=PROVIDER_SLUG,
                                entity_type="team",
                                scoutboy_key=slug,
                                provider_entity_id=str(team_id),
                                provider_entity_name=team_block.get(f"{side}_team_name"),
                                raw_payload=team_block,
                            )
                        )
                        seen_teams.add(slug)
                bundle.matches.append(
                    CanonicalMatch(
                        provider_slug=PROVIDER_SLUG,
                        provider_match_id=str(match_id),
                        competition_slug=comp_slug,
                        season_label=season_label,
                        home_team_slug=(
                            _team_slug(home.get("home_team_id"))
                            if home.get("home_team_id") is not None
                            else None
                        ),
                        away_team_slug=(
                            _team_slug(away.get("away_team_id"))
                            if away.get("away_team_id") is not None
                            else None
                        ),
                        match_date=match.get("match_date"),
                        home_score=match.get("home_score"),
                        away_score=match.get("away_score"),
                        match_status=match.get("match_status"),
                        raw_payload=match,
                    )
                )
                bundle.provider_identifiers.append(
                    CanonicalProviderIdentifier(
                        provider_slug=PROVIDER_SLUG,
                        entity_type="match",
                        scoutboy_key=str(match_id),
                        provider_entity_id=str(match_id),
                        provider_entity_name=f"{home.get('home_team_name')} vs {away.get('away_team_name')}",
                        raw_payload=match,
                    )
                )

                event_path = self._events_path(match_id)
                events = _read_json(event_path) if event_path.exists() else []
                if events:
                    events_available += 1
                    _accumulate_match(events, counts_by_player, names_by_player, teams_by_player)
                else:
                    bundle.adapter_warnings.append(
                        {
                            "check": "statsbomb_events_file_missing",
                            "severity": "warn",
                            "count": 1,
                            "details": [str(event_path)],
                        }
                    )
                match_duration = _event_match_duration(events)

                lineup_path = self._lineups_path(match_id)
                lineups = _read_json(lineup_path) if lineup_path.exists() else []
                if lineups:
                    lineups_available += 1
                else:
                    bundle.adapter_warnings.append(
                        {
                            "check": "statsbomb_lineups_file_missing",
                            "severity": "warn",
                            "count": 1,
                            "details": [str(lineup_path)],
                        }
                    )
                if self._three_sixty_path(match_id).exists():
                    three_sixty_available += 1

                for team_lineup in lineups:
                    team_slug = _team_slug(team_lineup["team_id"])
                    for player in team_lineup.get("lineup", []):
                        spid = str(player["player_id"])
                        positions = player.get("positions") or []
                        position_name = positions[0].get("position") if positions else None
                        minutes = int(
                            round(
                                sum(
                                    max(
                                        0.0,
                                        _time_to_minute(pos.get("to"), match_duration)
                                        - _time_to_minute(pos.get("from"), 0.0),
                                    )
                                    for pos in positions
                                )
                            )
                        )
                        starter = any(
                            (pos.get("start_reason") or "").startswith("Starting XI")
                            for pos in positions
                        )
                        if spid not in seen_players:
                            bundle.players.append(
                                CanonicalPlayer(
                                    source_name=SOURCE_NAME,
                                    source_player_id=spid,
                                    canonical_name=player.get("player_name") or f"StatsBomb {spid}",
                                    nationality=(player.get("country") or {}).get("name"),
                                    primary_position=_primary_position(position_name),
                                    raw_name=player.get("player_name"),
                                )
                            )
                            bundle.provider_identifiers.append(
                                CanonicalProviderIdentifier(
                                    provider_slug=PROVIDER_SLUG,
                                    entity_type="player",
                                    scoutboy_key=spid,
                                    provider_entity_id=spid,
                                    provider_entity_name=player.get("player_name"),
                                    raw_payload=player,
                                )
                            )
                            seen_players.add(spid)
                        if position_name:
                            player_positions.setdefault(spid, position_name)
                        player_team[spid] = team_slug
                        if minutes > 0:
                            player_minutes[spid] += minutes
                            player_apps[spid] += 1
                        if starter:
                            player_starts[spid] += 1
                        reg_key = (spid, team_slug, comp_slug, season_label)
                        if reg_key not in seen_registrations:
                            bundle.registrations.append(
                                CanonicalRegistration(
                                    source_player_id=spid,
                                    team_slug=team_slug,
                                    competition_slug=comp_slug,
                                    season_label=season_label,
                                    provider_slug=PROVIDER_SLUG,
                                    provider_registration_id=f"{spid}:{team_slug}:{season_id}",
                                    provenance={"source": "StatsBomb lineup file"},
                                )
                            )
                            seen_registrations.add(reg_key)
                        bundle.lineup_appearances.append(
                            CanonicalLineupAppearance(
                                provider_slug=PROVIDER_SLUG,
                                provider_match_id=str(match_id),
                                source_player_id=spid,
                                team_slug=team_slug,
                                jersey_number=player.get("jersey_number"),
                                position_name=position_name,
                                position_group=_position_group(position_name),
                                minutes=minutes,
                                starter=starter,
                                lineup_available=True,
                                raw_payload=player,
                            )
                        )

                for event in events:
                    event_id = event.get("id")
                    if not event_id:
                        continue
                    player_block = event.get("player") or {}
                    team_block = event.get("team") or {}
                    spid = str(player_block["id"]) if player_block.get("id") is not None else None
                    if spid and spid not in seen_players:
                        bundle.players.append(
                            CanonicalPlayer(
                                source_name=SOURCE_NAME,
                                source_player_id=spid,
                                canonical_name=player_block.get("name") or f"StatsBomb {spid}",
                                raw_name=player_block.get("name"),
                            )
                        )
                        bundle.provider_identifiers.append(
                            CanonicalProviderIdentifier(
                                provider_slug=PROVIDER_SLUG,
                                entity_type="player",
                                scoutboy_key=spid,
                                provider_entity_id=spid,
                                provider_entity_name=player_block.get("name"),
                                raw_payload=player_block,
                            )
                        )
                        seen_players.add(spid)
                    bundle.events.append(
                        CanonicalEvent(
                            provider_slug=PROVIDER_SLUG,
                            provider_event_id=event_id,
                            provider_match_id=str(match_id),
                            source_player_id=spid,
                            team_slug=(
                                _team_slug(team_block["id"]) if team_block.get("id") else None
                            ),
                            event_type=(event.get("type") or {}).get("name", "Unknown"),
                            minute=event.get("minute"),
                            second=event.get("second"),
                            possession=event.get("possession"),
                            location=event.get("location"),
                            raw_payload=event,
                        )
                    )

            for pid, mins in player_minutes.items():
                team_slug = player_team.get(pid)
                if not team_slug:
                    continue
                position_name = player_positions.get(pid)
                bundle.appearances.append(
                    CanonicalAppearance(
                        source_player_id=pid,
                        team_slug=team_slug,
                        competition_slug=comp_slug,
                        season_label=season_label,
                        minutes=mins,
                        appearances=player_apps[pid],
                        starts=player_starts[pid],
                        position_group=_position_group(position_name),
                    )
                )

            for pid_int, mins in ((int(pid), mins) for pid, mins in player_minutes.items()):
                metrics = _canonical(counts_by_player[pid_int], mins)
                player_metric_counts[str(pid_int)] = len(metrics)
                payload = {
                    "scope": "statsbomb_open_data_covered_matches",
                    "competition_id": competition_id,
                    "season_id": season_id,
                    "minutes": mins,
                    "matches": player_apps[str(pid_int)],
                }
                bundle.metrics.append(
                    CanonicalMetric(
                        source_player_id=str(pid_int),
                        season_label=season_label,
                        metric_name="performance_covered_minutes",
                        metric_value=float(mins),
                        unit="count",
                        id_source_name=SOURCE_NAME,
                        raw_payload=payload,
                        metric_provider=SOURCE_NAME,
                        scope="covered_matches",
                    )
                )
                bundle.metrics.append(
                    CanonicalMetric(
                        source_player_id=str(pid_int),
                        season_label=season_label,
                        metric_name="performance_covered_appearances",
                        metric_value=float(player_apps[str(pid_int)]),
                        unit="count",
                        id_source_name=SOURCE_NAME,
                        raw_payload=payload,
                        metric_provider=SOURCE_NAME,
                        scope="covered_matches",
                    )
                )
                for metric_name, value in metrics.items():
                    bundle.metrics.append(
                        CanonicalMetric(
                            source_player_id=str(pid_int),
                            season_label=season_label,
                            metric_name=metric_name,
                            metric_value=value,
                            unit="pct" if metric_name.endswith("_pct") else "per90",
                            id_source_name=SOURCE_NAME,
                            raw_payload=payload,
                            metric_provider=SOURCE_NAME,
                            scope="covered_matches",
                        )
                    )

            covered_dates = [_parse_date(m.get("match_date")) for m in matches]
            covered_dates = [d for d in covered_dates if d is not None]
            last_match_date = max(covered_dates) if covered_dates else None
            known_total_matches = None
            coverage_pct = None
            cov_conf = coverage_confidence(coverage_pct, len(matches))
            bundle.coverages.append(
                CanonicalDataCoverage(
                    provider_slug=PROVIDER_SLUG,
                    competition_slug=comp_slug,
                    season_label=season_label,
                    matches_covered=len(matches),
                    known_total_matches=known_total_matches,
                    events_available=events_available,
                    lineups_available=lineups_available,
                    three_sixty_available=three_sixty_available,
                    coverage_pct=coverage_pct,
                    last_match_date=last_match_date.isoformat() if last_match_date else None,
                    confidence={
                        "coverage_confidence": cov_conf,
                        "reason": "StatsBomb Open Data coverage is selective; total competition matches are not assumed unless supplied by a commercial/current-data provider.",
                    },
                )
            )

            for pid, mins in player_minutes.items():
                samp_conf = sample_confidence(mins)
                role_conf = role_similarity_confidence(mins, player_metric_counts.get(pid, 0))
                overall = weakest_confidence(samp_conf, cov_conf, "low", role_conf)
                bundle.player_evidence.append(
                    CanonicalPlayerEvidence(
                        provider_slug=PROVIDER_SLUG,
                        source_player_id=pid,
                        competition_slug=comp_slug,
                        season_label=season_label,
                        minutes=mins,
                        appearances=player_apps[pid],
                        starts=player_starts[pid],
                        matches_covered=len(matches),
                        known_total_matches=known_total_matches,
                        competition_coverage_pct=coverage_pct,
                        data_recency_days=recency_days(last_match_date, self.as_of_date),
                        sample_size_confidence=samp_conf,
                        coverage_confidence=cov_conf,
                        league_adjustment_confidence="low",
                        role_similarity_confidence=role_conf,
                        overall_rating_confidence=overall,
                        explanation={
                            "rating_value_is_separate": True,
                            "sample": f"{mins} minutes across {player_apps[pid]} covered appearances.",
                            "coverage": "Open Data match coverage is selective and may not represent the full competition.",
                            "league_adjustment": "No calibrated league-strength coefficient is inferred from sparse Open Data.",
                            "role_similarity": f"{player_metric_counts.get(pid, 0)} event-derived metrics available.",
                        },
                    )
                )

        bundle.snapshot_metadata["row_counts"] = {
            "competitions": len(bundle.competitions),
            "seasons": len(bundle.seasons),
            "teams": len(bundle.teams),
            "players": len(bundle.players),
            "matches": len(bundle.matches),
            "lineup_appearances": len(bundle.lineup_appearances),
            "events": len(bundle.events),
            "metrics": len(bundle.metrics),
        }
        return bundle
