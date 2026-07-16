"""Ingestion job.

    python -m data_pipeline.jobs.ingest --source sample

Fetches a canonical bundle from a source adapter, runs data-quality checks (failing
loudly on errors), and upserts canonical entities + raw metrics. Idempotent: re-running
the same source/season replaces that source's appearances and raw metrics in place.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date

from app.core.db import SessionLocal
from app.models.orm import (
    Appearance,
    Competition,
    DataQualityReport,
    Player,
    PlayerMetricRaw,
    PlayerSourceId,
    Season,
    SourceSnapshot,
    Team,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..adapters import get_adapter
from ..adapters.base import IngestBundle
from ..normalize.identity_resolution import resolve_player
from ..quality.checks import run_bundle_checks
from ._common import fail_run, finish_run, get_or_create_season, start_run


def ingest_bundle(session: Session, bundle: IngestBundle, *, min_minutes: int = 450) -> dict:
    report = run_bundle_checks(bundle, min_minutes=min_minutes)
    # fold in any adapter-level findings (e.g. rows quarantined during CSV parsing)
    if bundle.adapter_warnings:
        report["findings"].extend(bundle.adapter_warnings)
        report["has_errors"] = report["has_errors"] or any(
            f.get("severity") == "error" and f.get("count") for f in bundle.adapter_warnings
        )
    run = start_run(
        session, "ingest", f"ingest:{bundle.source_name}", [bundle.source_snapshot_id], {}
    )
    snapshot = session.scalar(
        select(SourceSnapshot).where(SourceSnapshot.snapshot_key == bundle.source_snapshot_id)
    )
    if snapshot is None:
        snapshot = SourceSnapshot(
            snapshot_key=bundle.source_snapshot_id, provider=bundle.source_name
        )
        session.add(snapshot)
    meta = bundle.snapshot_metadata or {}
    snapshot.provider = meta.get("provider", bundle.source_name)
    snapshot.dataset_version = meta.get("dataset_version")
    as_of = meta.get("as_of_date")
    snapshot.as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) and as_of else as_of
    snapshot.target_season = meta.get("target_season")
    snapshot.local_path = meta.get("local_path")
    snapshot.checksum = meta.get("checksum")
    snapshot.license_url = meta.get("license_url")
    snapshot.row_counts_json = meta.get("row_counts", {})
    snapshot.metadata_json = meta.get("metadata", {})
    snapshot.ingested_run_id = run.id
    session.flush()
    if report["has_errors"]:
        session.add(
            DataQualityReport(source_name=bundle.source_name, run_id=run.id, report_json=report)
        )
        fail_run(session, run, f"quality errors: {report['error_checks']}")
        session.commit()
        raise ValueError(f"Ingestion aborted — data-quality errors in {report['error_checks']}")

    # seasons
    season_by_label = {}
    for s in bundle.seasons:
        season_by_label[s.label] = get_or_create_season(
            session, s.label, s.is_current, s.start_date, s.end_date
        )

    # competitions
    comp_by_slug: dict[str, Competition] = {}
    for c in bundle.competitions:
        comp = session.scalar(select(Competition).where(Competition.slug == c.slug))
        if comp is None:
            comp = Competition(slug=c.slug)
            session.add(comp)
        comp.name, comp.country = c.name, c.country
        comp.competition_type, comp.tier, comp.is_european = (
            c.competition_type,
            c.tier,
            c.is_european,
        )
        session.flush()
        comp_by_slug[c.slug] = comp

    # teams
    team_by_slug: dict[str, Team] = {}
    for t in bundle.teams:
        team = session.scalar(select(Team).where(Team.slug == t.slug))
        if team is None:
            team = Team(slug=t.slug)
            session.add(team)
        team.canonical_name = t.name
        team.country = t.country
        comp = comp_by_slug.get(t.competition_slug)
        team.league_id = comp.id if comp else team.league_id
        team.strength_tier = t.strength_tier
        session.flush()
        team_by_slug[t.slug] = team

    # players (identity resolution)
    player_by_source: dict[str, Player] = {}
    for cp in bundle.players:
        player_by_source[cp.source_player_id] = resolve_player(session, cp)
    session.flush()

    # appearances (upsert by natural key)
    for a in bundle.appearances:
        player = player_by_source.get(a.source_player_id)
        team = team_by_slug.get(a.team_slug)
        comp = comp_by_slug.get(a.competition_slug)
        season = season_by_label.get(a.season_label)
        if not (player and team and comp and season):
            continue
        appr = session.scalar(
            select(Appearance).where(
                Appearance.player_id == player.id,
                Appearance.team_id == team.id,
                Appearance.competition_id == comp.id,
                Appearance.season_id == season.id,
            )
        )
        if appr is None:
            appr = Appearance(
                player_id=player.id, team_id=team.id, competition_id=comp.id, season_id=season.id
            )
            session.add(appr)
        appr.minutes, appr.appearances, appr.starts = a.minutes, a.appearances, a.starts
        appr.position_group = a.position_group
        appr.role_usage_raw = a.role_usage_raw
        appr.source_snapshot_record_id = snapshot.id

    # ---- resolve metrics to players (bundle players first, then existing source ids) ----
    psid_cache: dict[tuple, Player | None] = {}

    def resolve_metric_player(id_source: str, spid: str) -> Player | None:
        if spid in player_by_source:
            return player_by_source[spid]
        key = (id_source, spid)
        if key in psid_cache:
            return psid_cache[key]
        link = session.scalar(
            select(PlayerSourceId).where(
                PlayerSourceId.source_name == id_source,
                PlayerSourceId.source_player_id == spid,
            )
        )
        player = session.get(Player, link.player_id) if link else None
        psid_cache[key] = player
        return player

    season_cache: dict[str, Season] = dict(season_by_label)

    def resolve_season(label: str) -> Season:
        if label not in season_cache:
            season_cache[label] = get_or_create_season(session, label)
        return season_cache[label]

    resolved_rows: list[tuple[int, int, object]] = []
    quarantined: list[list] = []
    seen_keys: set = set()
    dup_count = 0
    for m in bundle.metrics:
        id_source = m.id_source_name or bundle.source_name
        player = resolve_metric_player(id_source, m.source_player_id)
        if player is None:
            quarantined.append([id_source, m.source_player_id])
            continue
        season = resolve_season(m.season_label)
        key = (player.id, bundle.source_name, season.id, m.metric_name, bundle.source_snapshot_id)
        if key in seen_keys:
            dup_count += 1
            continue
        seen_keys.add(key)
        resolved_rows.append((player.id, season.id, m))

    # clear this source's rows for the affected players/seasons, then re-insert (idempotent)
    pids = {r[0] for r in resolved_rows} | {p.id for p in player_by_source.values()}
    sids = {r[1] for r in resolved_rows} | {s.id for s in season_by_label.values()}
    if pids and sids:
        session.query(PlayerMetricRaw).filter(
            PlayerMetricRaw.source_name == bundle.source_name,
            PlayerMetricRaw.player_id.in_(pids),
            PlayerMetricRaw.season_id.in_(sids),
        ).delete(synchronize_session=False)
    for player_id, season_id, m in resolved_rows:
        session.add(
            PlayerMetricRaw(
                player_id=player_id,
                source_name=bundle.source_name,
                season_id=season_id,
                metric_name=m.metric_name,
                metric_value=m.metric_value,
                unit=m.unit,
                raw_payload_json=m.raw_payload,
                source_snapshot_id=bundle.source_snapshot_id,
                source_snapshot_record_id=snapshot.id,
                metric_provider=m.metric_provider or bundle.source_name,
                scope=m.scope or m.raw_payload.get("scope"),
            )
        )

    # augment the quality report with resolution outcomes, then persist it
    uniq_quarantined = sorted({tuple(q) for q in quarantined})
    report["findings"].append(
        {
            "check": "unknown_source_player_ids",
            "severity": "warn" if uniq_quarantined else "ok",
            "count": len(uniq_quarantined),
            "details": [list(q) for q in uniq_quarantined[:10]],
        }
    )
    report["findings"].append(
        {
            "check": "duplicate_metric_rows",
            "severity": "warn" if dup_count else "ok",
            "count": dup_count,
            "details": [],
        }
    )
    report["quarantined_metric_rows"] = len(quarantined)
    session.add(
        DataQualityReport(source_name=bundle.source_name, run_id=run.id, report_json=report)
    )

    finish_run(session, run, affected=len(player_by_source))
    session.commit()
    return {
        "run_id": run.id,
        "players": len(player_by_source),
        "metrics": len(resolved_rows),
        "quarantined": len(quarantined),
        "report": report,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ScoutBoy ingestion")
    parser.add_argument("--source", default="sample", help="source adapter name")
    parser.add_argument(
        "--input-path",
        default=None,
        help="path to a CSV directory (transfermarkt) or CSV file (performance_csv)",
    )
    parser.add_argument("--competition-id", default=None, help="source competition id (e.g. L1)")
    parser.add_argument("--target-season", type=int, default=None, help="season start year")
    parser.add_argument("--as-of-date", default=None, help="valuation cutoff date (YYYY-MM-DD)")
    args = parser.parse_args(argv)

    as_of = date.fromisoformat(args.as_of_date) if args.as_of_date else None
    adapter = get_adapter(
        args.source,
        input_path=args.input_path,
        target_competition_id=args.competition_id,
        target_season=args.target_season,
        as_of_date=as_of,
    )
    bundle = adapter.fetch()
    with SessionLocal() as session:
        result = ingest_bundle(session, bundle)
    print(
        f"Ingested source='{args.source}': {result['players']} players, "
        f"{result['metrics']} metric rows, {result['quarantined']} quarantined "
        f"(run {result['run_id']})."
    )
    errs = [f for f in result["report"]["findings"] if f["severity"] == "error" and f["count"]]
    warns = [f for f in result["report"]["findings"] if f["severity"] == "warn" and f["count"]]
    print(f"Quality: {len(errs)} errors, {len(warns)} warnings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
