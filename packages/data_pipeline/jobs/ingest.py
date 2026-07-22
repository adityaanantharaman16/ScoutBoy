"""Ingestion job.

    python -m data_pipeline.jobs.ingest --source sample

Fetches a canonical bundle from a source adapter, runs data-quality checks (failing
loudly on errors), and upserts canonical entities + raw metrics. Idempotent: re-running
the same source/season replaces that source's appearances and raw metrics in place.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict, is_dataclass
from datetime import date, datetime, timezone

from app.core.db import SessionLocal
from app.models.orm import (
    Appearance,
    Competition,
    DataCoverage,
    DataQualityReport,
    Event,
    Match,
    MatchLineupAppearance,
    Player,
    PlayerEvidenceConfidence,
    PlayerMetricRaw,
    PlayerSourceId,
    PlayerTeamSeasonRegistration,
    Provider,
    ProviderIdentifier,
    QuarantineRecord,
    RatingRun,
    Season,
    SourceSnapshot,
    Team,
)
from scoutboy_shared import resolve_metric
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..adapters import get_adapter, provider_capabilities
from ..adapters.base import IngestBundle
from ..normalize.identity_resolution import resolve_players
from ..provider_contract import require_adapter_conformance
from ..quality.checks import run_bundle_checks
from ._common import (
    fail_run,
    finish_run,
    get_or_create_season,
    start_run,
    transition_run,
)

INGESTION_MODES = {"normal", "dry_run", "validate_only"}
COMPLETED_INGEST_STATUSES = {"completed", "completed_with_warnings"}


def _stable_hash(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def _record_dict(record) -> dict:
    return asdict(record) if is_dataclass(record) else dict(record)


def bundle_inventory(bundle: IngestBundle) -> dict:
    """Compact immutable inventory retained on snapshots for deterministic diffs."""

    def keyed(records, key):
        result = {}
        for record in records:
            payload = _record_dict(record)
            result[key(payload)] = _stable_hash(payload)
        return dict(sorted(result.items()))

    return {
        "entities": {
            "players": keyed(
                bundle.players, lambda p: f"{p['source_name']}:{p['source_player_id']}"
            ),
            "teams": keyed(bundle.teams, lambda row: row["slug"]),
            "competitions": keyed(bundle.competitions, lambda row: row["slug"]),
            "seasons": keyed(bundle.seasons, lambda row: row["label"]),
            "matches": keyed(
                bundle.matches,
                lambda row: f"{row['provider_slug']}:{row['provider_match_id']}",
            ),
        },
        "metrics": keyed(
            bundle.metrics,
            lambda row: (
                f"{row.get('id_source_name') or bundle.source_name}:"
                f"{row['source_player_id']}:{row['season_label']}:{row['metric_name']}"
            ),
        ),
        "coverage": keyed(
            bundle.coverages,
            lambda row: (f"{row['provider_slug']}:{row['competition_slug']}:{row['season_label']}"),
        ),
        "counts": {
            "players": len(bundle.players),
            "teams": len(bundle.teams),
            "competitions": len(bundle.competitions),
            "seasons": len(bundle.seasons),
            "appearances": len(bundle.appearances),
            "matches": len(bundle.matches),
            "events": len(bundle.events),
            "metrics": len(bundle.metrics),
            "coverage_rows": len(bundle.coverages),
            "quarantine_candidates": len(bundle.quarantine_candidates),
        },
    }


def bundle_scope(bundle: IngestBundle) -> dict:
    meta = bundle.snapshot_metadata or {}
    return {
        "source_snapshot_id": bundle.source_snapshot_id,
        "target_season": meta.get("target_season"),
        "competition": (meta.get("metadata") or {}).get("competition_id"),
    }


def bundle_fingerprint(bundle: IngestBundle, *, provider: str | None = None) -> str:
    meta = bundle.snapshot_metadata or {}
    identity = {
        "provider": provider or meta.get("provider", bundle.source_name),
        "dataset_version": meta.get("dataset_version"),
        "checksum": meta.get("checksum"),
        "scope": bundle_scope(bundle),
        "inventory": bundle_inventory(bundle),
    }
    return _stable_hash(identity)


def _quality_summary(report: dict) -> dict:
    return {
        "errors": sum(
            1
            for finding in report["findings"]
            if finding["severity"] == "error" and finding["count"]
        ),
        "warnings": sum(
            1
            for finding in report["findings"]
            if finding["severity"] == "warn" and finding["count"]
        ),
    }


def _sanitize_context(value, *, depth: int = 0):
    if depth >= 4:
        return "[truncated]"
    if isinstance(value, dict):
        result = {}
        for key, item in list(value.items())[:30]:
            normalized = str(key).lower()
            if any(
                marker in normalized
                for marker in (
                    "token",
                    "secret",
                    "password",
                    "authorization",
                    "api_key",
                    "credential",
                )
            ):
                continue
            if normalized in {"raw_payload", "payload", "raw"}:
                continue
            result[str(key)] = _sanitize_context(item, depth=depth + 1)
        return result
    if isinstance(value, (list, tuple, set)):
        return [_sanitize_context(item, depth=depth + 1) for item in list(value)[:20]]
    if isinstance(value, str):
        return value[:500]
    if value is None or isinstance(value, (int, float, bool)):
        return value
    return str(value)[:500]


def _quarantine_candidate(
    *,
    entity_type: str,
    external_id: str | None,
    reason_code: str,
    context: dict,
    severity: str = "warning",
) -> dict:
    safe_context = _sanitize_context(context)
    return {
        "entity_type": entity_type,
        "external_id": external_id,
        "reason_code": reason_code,
        "severity": severity,
        "diagnostic_context": safe_context,
        "payload_fingerprint": _stable_hash(safe_context),
    }


def _persist_quarantine(
    session: Session,
    *,
    run: RatingRun,
    snapshot: SourceSnapshot | None,
    provider: str,
    source_name: str,
    fingerprint: str,
    candidates: list[dict],
) -> int:
    written = 0
    seen = set()
    for candidate in candidates:
        context = _sanitize_context(
            candidate.get("diagnostic_context") or candidate.get("context") or {}
        )
        payload_fingerprint = candidate.get("payload_fingerprint") or _stable_hash(context)
        key = (
            candidate.get("entity_type", "source_row"),
            candidate.get("external_id"),
            candidate.get("reason_code", "invalid_source_row"),
            payload_fingerprint,
        )
        if key in seen:
            continue
        seen.add(key)
        existing = session.scalar(
            select(QuarantineRecord).where(
                QuarantineRecord.provider == provider,
                QuarantineRecord.snapshot_fingerprint == fingerprint,
                QuarantineRecord.entity_type == key[0],
                QuarantineRecord.external_id == key[1],
                QuarantineRecord.reason_code == key[2],
                QuarantineRecord.payload_fingerprint == key[3],
            )
        )
        if existing is not None:
            continue
        session.add(
            QuarantineRecord(
                ingestion_run_id=run.id,
                source_snapshot_id=snapshot.id if snapshot else None,
                provider=provider,
                source_name=source_name,
                snapshot_fingerprint=fingerprint,
                entity_type=key[0],
                external_id=key[1],
                reason_code=key[2],
                severity=candidate.get("severity", "warning"),
                payload_fingerprint=key[3],
                diagnostic_context_json=context,
            )
        )
        written += 1
    return written


def _candidate_quarantine_identity(provider: str, candidate: dict) -> tuple:
    context = _sanitize_context(
        candidate.get("diagnostic_context") or candidate.get("context") or {}
    )
    return (
        provider,
        candidate.get("entity_type", "source_row"),
        candidate.get("external_id"),
        candidate.get("reason_code", "invalid_source_row"),
        candidate.get("payload_fingerprint") or _stable_hash(context),
    )


def _quarantine_source_reference(context: dict) -> str | None:
    value = (context or {}).get("source_row_number")
    if value is None:
        value = (context or {}).get("row_number")
    return str(value) if value is not None else None


def _resolve_replayed_quarantine(
    session: Session,
    *,
    original_run_id: int,
    replay_run: RatingRun,
    provider: str,
    replay_candidates: list[dict],
    published_player_external_ids: set[str],
    published_metric_external_ids: set[str],
    published_source_references: set[str],
) -> int:
    """Resolve only original issues demonstrably addressed by this successful replay."""
    unresolved_identities = {
        _candidate_quarantine_identity(provider, candidate) for candidate in replay_candidates
    }
    unresolved_base_keys = {identity[:4] for identity in unresolved_identities}
    unresolved_source_references = {
        (
            provider,
            candidate.get("entity_type", "source_row"),
            candidate.get("reason_code", "invalid_source_row"),
            source_reference,
        )
        for candidate in replay_candidates
        if (
            source_reference := _quarantine_source_reference(
                candidate.get("diagnostic_context") or candidate.get("context") or {}
            )
        )
        is not None
    }
    replayed_at = datetime.now(timezone.utc)
    resolved = 0
    for row in session.scalars(
        select(QuarantineRecord).where(
            QuarantineRecord.ingestion_run_id == original_run_id,
            QuarantineRecord.status == "open",
        )
    ):
        identity = (
            row.provider,
            row.entity_type,
            row.external_id,
            row.reason_code,
            row.payload_fingerprint,
        )
        if identity in unresolved_identities:
            continue
        source_reference = _quarantine_source_reference(row.diagnostic_context_json or {})
        if source_reference is not None:
            unresolved_reference = (
                row.provider,
                row.entity_type,
                row.reason_code,
                source_reference,
            )
            if unresolved_reference in unresolved_source_references:
                continue
            addressed = source_reference in published_source_references
        else:
            if identity[:4] in unresolved_base_keys:
                continue
            if row.entity_type == "player":
                addressed = bool(row.external_id in published_player_external_ids)
            elif row.entity_type in {"metric", "player_metric"}:
                addressed = bool(row.external_id in published_metric_external_ids)
            else:
                # Source-level failures have no row identity; a successful replay with no
                # equivalent rejection is the strongest available evidence of correction.
                addressed = row.external_id is None
        if not addressed:
            continue
        row.status = "resolved"
        row.resolved_at = replayed_at
        row.replayed_at = replayed_at
        row.replay_run_id = replay_run.id
        resolved += 1
    return resolved


def ingest_bundle(
    session: Session,
    bundle: IngestBundle,
    *,
    min_minutes: int = 450,
    mode: str = "normal",
    adapter=None,
    existing_run: RatingRun | None = None,
    replay_of_run_id: int | None = None,
) -> dict:
    if mode not in INGESTION_MODES:
        raise ValueError(f"Unknown ingestion mode: {mode}")
    contract_report = require_adapter_conformance(adapter, bundle) if adapter else None
    supported_positions = {
        "ST",
        "CF",
        "LW",
        "RW",
        "CAM",
        "AM",
        "CM",
        "DM",
        "LM",
        "RM",
        "CB",
        "LB",
        "RB",
        "GK",
    }
    for player in bundle.players:
        already_quarantined = any(
            candidate.get("reason_code") == "unsupported_position_mapping"
            and candidate.get("external_id") == player.source_player_id
            for candidate in bundle.quarantine_candidates
        )
        if (
            player.primary_position
            and player.primary_position not in supported_positions
            and not already_quarantined
        ):
            bundle.quarantine_candidates.append(
                _quarantine_candidate(
                    entity_type="player",
                    external_id=player.source_player_id,
                    reason_code="unsupported_position_mapping",
                    context={"canonical_position": player.primary_position},
                )
            )
    report = run_bundle_checks(bundle, min_minutes=min_minutes)
    # fold in any adapter-level findings (e.g. rows quarantined during CSV parsing)
    if bundle.adapter_warnings:
        report["findings"].extend(bundle.adapter_warnings)
        report["has_errors"] = report["has_errors"] or any(
            f.get("severity") == "error" and f.get("count") for f in bundle.adapter_warnings
        )
    provider_slug = (
        adapter.capabilities.provider_id
        if adapter is not None
        else (bundle.snapshot_metadata or {}).get("provider", bundle.source_name)
    )
    fingerprint = bundle_fingerprint(bundle, provider=provider_slug)
    scope = bundle_scope(bundle)
    plan = {
        "provider": provider_slug,
        "source": bundle.source_name,
        "snapshot": bundle.source_snapshot_id,
        "snapshot_fingerprint": fingerprint,
        "scope": scope,
        "intended_writes": bundle_inventory(bundle)["counts"],
        "quality": _quality_summary(report),
        "quarantine_candidates": len(bundle.quarantine_candidates),
        "contract": contract_report,
    }
    if mode in {"dry_run", "validate_only"}:
        return {
            "run_id": None,
            "status": "validated" if not report["has_errors"] else "blocked",
            "mode": mode,
            "players": len(bundle.players),
            "metrics": len(bundle.metrics),
            "quarantined": len(bundle.quarantine_candidates),
            "report": report,
            "plan": plan,
        }

    run = existing_run or start_run(
        session,
        "ingest",
        f"ingest:{bundle.source_name}",
        [bundle.source_snapshot_id],
        {},
        status="planned",
        provider=provider_slug,
        ingestion_mode=mode,
        snapshot_fingerprint=fingerprint,
        scope=scope,
    )
    run.provider = provider_slug
    run.ingestion_mode = mode
    run.snapshot_fingerprint = fingerprint
    run.scope_json = scope
    run.replay_of_run_id = replay_of_run_id
    if run.status != "validating":
        transition_run(run, "validating")
    session.flush()

    prior = None
    for candidate_run in session.scalars(
        select(RatingRun).where(
            RatingRun.run_type == "ingest",
            RatingRun.provider == provider_slug,
            RatingRun.snapshot_fingerprint == fingerprint,
            RatingRun.status.in_(COMPLETED_INGEST_STATUSES),
            RatingRun.id != run.id,
        )
    ):
        if (candidate_run.scope_json or {}) == scope:
            prior = candidate_run
            break
    if prior is not None:
        transition_run(run, "skipped_idempotent")
        run.completed_at = datetime.now(timezone.utc)
        run.summary_json = {
            **(run.summary_json or {}),
            "idempotent_of_run_id": prior.id,
            "plan": plan,
        }
        session.commit()
        return {
            "run_id": run.id,
            "status": "skipped_idempotent",
            "players": 0,
            "metrics": 0,
            "quarantined": 0,
            "report": report,
            "plan": plan,
        }

    if report["has_errors"]:
        blocking_candidates = list(bundle.quarantine_candidates)
        for finding in report["findings"]:
            if finding["severity"] == "error" and finding["count"]:
                if finding["check"].startswith("duplicate_"):
                    reason_code = "duplicate_source_record"
                elif finding["check"] == "source_schema_drift":
                    reason_code = "source_schema_drift"
                else:
                    reason_code = finding["check"]
                blocking_candidates.append(
                    _quarantine_candidate(
                        entity_type=(
                            "source_schema"
                            if finding["check"] == "source_schema_drift"
                            else "source_row"
                        ),
                        external_id=None,
                        reason_code=reason_code,
                        severity="error",
                        context={"details": finding.get("details", [])[:10]},
                    )
                )
        _persist_quarantine(
            session,
            run=run,
            snapshot=None,
            provider=provider_slug,
            source_name=bundle.source_name,
            fingerprint=fingerprint,
            candidates=blocking_candidates,
        )
        session.add(
            DataQualityReport(source_name=bundle.source_name, run_id=run.id, report_json=report)
        )
        run.failure_details_json = {"quality_errors": report["error_checks"]}
        fail_run(session, run, f"quality errors: {report['error_checks']}")
        session.commit()
        raise ValueError(f"Ingestion aborted — data-quality errors in {report['error_checks']}")

    transition_run(run, "ingesting")
    snapshot = session.scalar(
        select(SourceSnapshot).where(
            SourceSnapshot.provider == provider_slug, SourceSnapshot.fingerprint == fingerprint
        )
    )
    if snapshot is None:
        snapshot_key = bundle.source_snapshot_id
        key_collision = session.scalar(
            select(SourceSnapshot).where(SourceSnapshot.snapshot_key == snapshot_key)
        )
        if key_collision is not None:
            snapshot_key = f"{snapshot_key[:107]}:{fingerprint[:12]}"
        snapshot = SourceSnapshot(
            snapshot_key=snapshot_key, provider=provider_slug, fingerprint=fingerprint
        )
        session.add(snapshot)
    meta = bundle.snapshot_metadata or {}
    snapshot.provider = provider_slug
    snapshot.fingerprint = fingerprint
    snapshot.scope_json = scope
    snapshot.dataset_version = meta.get("dataset_version")
    as_of = meta.get("as_of_date")
    snapshot.as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) and as_of else as_of
    snapshot.target_season = meta.get("target_season")
    snapshot.local_path = meta.get("local_path")
    snapshot.checksum = meta.get("checksum")
    snapshot.license_url = meta.get("license_url")
    snapshot.source_type = adapter.capabilities.provider_type if adapter else None
    snapshot.known_limitation = (
        "; ".join(adapter.capabilities.known_limitations) if adapter else None
    )
    snapshot.attribution = adapter.capabilities.attribution if adapter else None
    snapshot.health_label = (
        "demo_only" if adapter and adapter.capabilities.fixture_data else "unknown"
    )
    snapshot.row_counts_json = meta.get("row_counts", {})
    snapshot.metadata_json = {
        **meta.get("metadata", {}),
        "operational_inventory": bundle_inventory(bundle),
    }
    snapshot.ingested_run_id = run.id
    session.flush()

    # providers
    provider_by_slug: dict[str, Provider] = {}
    for p in bundle.providers:
        provider = session.scalar(select(Provider).where(Provider.slug == p.slug))
        if provider is None:
            provider = Provider(slug=p.slug)
            session.add(provider)
        provider.name = p.name
        provider.provider_type = p.provider_type
        provider.license_url = p.license_url
        provider.attribution = p.attribution
        session.flush()
        provider_by_slug[p.slug] = provider

    def provider_for(slug: str) -> Provider:
        if slug in provider_by_slug:
            return provider_by_slug[slug]
        provider = session.scalar(select(Provider).where(Provider.slug == slug))
        if provider is None:
            provider = Provider(slug=slug, name=slug.replace("_", " ").title())
            session.add(provider)
            session.flush()
        provider_by_slug[slug] = provider
        return provider

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
    unsupported_player_ids = {
        candidate.get("external_id")
        for candidate in bundle.quarantine_candidates
        if candidate.get("reason_code") == "unsupported_position_mapping"
    }
    publishable_players = [
        player for player in bundle.players if player.source_player_id not in unsupported_player_ids
    ]
    identity_resolution = resolve_players(session, publishable_players)
    for ambiguity in identity_resolution.ambiguities:
        bundle.quarantine_candidates.append(
            _quarantine_candidate(
                entity_type="player",
                external_id=ambiguity.source_player_id,
                reason_code="unresolved_or_ambiguous_player_identity",
                context={
                    "identity_source": ambiguity.source_name,
                    "canonical_name": ambiguity.canonical_name,
                    "birth_date": (
                        ambiguity.birth_date.isoformat() if ambiguity.birth_date else None
                    ),
                    "match_outcome": "ambiguous_name_and_birth_date",
                    "candidate_count": ambiguity.candidate_count,
                },
            )
        )
    player_by_source_key = identity_resolution.players_by_source_key

    def player_for(source_name: str, source_player_id: str) -> Player | None:
        return player_by_source_key.get((source_name, source_player_id))

    session.flush()

    entity_id_by_key: dict[tuple[str, str], int] = {}
    entity_id_by_key.update({("competition", slug): c.id for slug, c in comp_by_slug.items()})
    entity_id_by_key.update({("season", label): s.id for label, s in season_by_label.items()})
    entity_id_by_key.update({("team", slug): t.id for slug, t in team_by_slug.items()})
    entity_id_by_key.update(
        {
            ("player", source_player_id): player.id
            for (source_name, source_player_id), player in player_by_source_key.items()
            if source_name == bundle.source_name
        }
    )

    for identifier in bundle.provider_identifiers:
        entity_id = entity_id_by_key.get((identifier.entity_type, identifier.scoutboy_key))
        if entity_id is None:
            continue
        provider = provider_for(identifier.provider_slug)
        row = session.scalar(
            select(ProviderIdentifier).where(
                ProviderIdentifier.provider_id == provider.id,
                ProviderIdentifier.entity_type == identifier.entity_type,
                ProviderIdentifier.provider_entity_id == identifier.provider_entity_id,
            )
        )
        if row is None:
            row = ProviderIdentifier(
                provider_id=provider.id,
                entity_type=identifier.entity_type,
                provider_entity_id=identifier.provider_entity_id,
            )
            session.add(row)
        row.entity_id = entity_id
        row.provider_entity_name = identifier.provider_entity_name
        row.source_snapshot_record_id = snapshot.id
        row.source_version = snapshot.dataset_version
        row.raw_payload_json = identifier.raw_payload

    # appearances (batch-load then upsert by natural key)
    appearance_by_key: dict[tuple[int, int, int, int], Appearance] = {}
    appearance_player_ids = sorted({player.id for player in player_by_source_key.values()})
    for start in range(0, len(appearance_player_ids), 500):
        for existing_appearance in session.scalars(
            select(Appearance).where(
                Appearance.player_id.in_(appearance_player_ids[start : start + 500])
            )
        ):
            appearance_by_key[
                (
                    existing_appearance.player_id,
                    existing_appearance.team_id,
                    existing_appearance.competition_id,
                    existing_appearance.season_id,
                )
            ] = existing_appearance
    for a in bundle.appearances:
        player = player_for(bundle.source_name, a.source_player_id)
        team = team_by_slug.get(a.team_slug)
        comp = comp_by_slug.get(a.competition_slug)
        season = season_by_label.get(a.season_label)
        if not (player and team and comp and season):
            continue
        appearance_key = (player.id, team.id, comp.id, season.id)
        appr = appearance_by_key.get(appearance_key)
        if appr is None:
            appr = Appearance(
                player_id=player.id, team_id=team.id, competition_id=comp.id, season_id=season.id
            )
            session.add(appr)
            appearance_by_key[appearance_key] = appr
        appr.minutes, appr.appearances, appr.starts = a.minutes, a.appearances, a.starts
        appr.position_group = a.position_group
        appr.role_usage_raw = a.role_usage_raw
        appr.source_snapshot_record_id = snapshot.id

    for r in bundle.registrations:
        player = player_for(bundle.source_name, r.source_player_id)
        team = team_by_slug.get(r.team_slug)
        comp = comp_by_slug.get(r.competition_slug)
        season = season_by_label.get(r.season_label)
        provider = provider_for(r.provider_slug)
        if not (player and team and comp and season):
            continue
        reg = session.scalar(
            select(PlayerTeamSeasonRegistration).where(
                PlayerTeamSeasonRegistration.player_id == player.id,
                PlayerTeamSeasonRegistration.team_id == team.id,
                PlayerTeamSeasonRegistration.competition_id == comp.id,
                PlayerTeamSeasonRegistration.season_id == season.id,
                PlayerTeamSeasonRegistration.provider_id == provider.id,
            )
        )
        if reg is None:
            reg = PlayerTeamSeasonRegistration(
                player_id=player.id,
                team_id=team.id,
                competition_id=comp.id,
                season_id=season.id,
                provider_id=provider.id,
            )
            session.add(reg)
        reg.provider_registration_id = r.provider_registration_id
        reg.source_snapshot_record_id = snapshot.id
        reg.provenance_json = r.provenance

    match_by_provider_id: dict[tuple[str, str], Match] = {}
    for m in bundle.matches:
        provider = provider_for(m.provider_slug)
        comp = comp_by_slug.get(m.competition_slug)
        season = season_by_label.get(m.season_label)
        if not (comp and season):
            continue
        match = session.scalar(
            select(Match).where(
                Match.provider_id == provider.id,
                Match.provider_match_id == m.provider_match_id,
            )
        )
        if match is None:
            match = Match(provider_id=provider.id, provider_match_id=m.provider_match_id)
            session.add(match)
        match.competition_id = comp.id
        match.season_id = season.id
        match.match_date = date.fromisoformat(m.match_date) if m.match_date else None
        home = team_by_slug.get(m.home_team_slug or "")
        away = team_by_slug.get(m.away_team_slug or "")
        match.home_team_id = home.id if home else None
        match.away_team_id = away.id if away else None
        match.home_score = m.home_score
        match.away_score = m.away_score
        match.match_status = m.match_status
        match.source_snapshot_record_id = snapshot.id
        match.raw_payload_json = m.raw_payload
        session.flush()
        match_by_provider_id[(m.provider_slug, m.provider_match_id)] = match
        entity_id_by_key[("match", m.provider_match_id)] = match.id

    for identifier in bundle.provider_identifiers:
        if identifier.entity_type != "match":
            continue
        entity_id = entity_id_by_key.get(("match", identifier.scoutboy_key))
        if entity_id is None:
            continue
        provider = provider_for(identifier.provider_slug)
        row = session.scalar(
            select(ProviderIdentifier).where(
                ProviderIdentifier.provider_id == provider.id,
                ProviderIdentifier.entity_type == "match",
                ProviderIdentifier.provider_entity_id == identifier.provider_entity_id,
            )
        )
        if row is None:
            row = ProviderIdentifier(
                provider_id=provider.id,
                entity_type="match",
                provider_entity_id=identifier.provider_entity_id,
            )
            session.add(row)
        row.entity_id = entity_id
        row.provider_entity_name = identifier.provider_entity_name
        row.source_snapshot_record_id = snapshot.id
        row.source_version = snapshot.dataset_version
        row.raw_payload_json = identifier.raw_payload

    for la in bundle.lineup_appearances:
        match = match_by_provider_id.get((la.provider_slug, la.provider_match_id))
        player = player_for(bundle.source_name, la.source_player_id)
        team = team_by_slug.get(la.team_slug)
        provider = provider_for(la.provider_slug)
        if not (match and player and team):
            continue
        row = session.scalar(
            select(MatchLineupAppearance).where(
                MatchLineupAppearance.match_id == match.id,
                MatchLineupAppearance.player_id == player.id,
                MatchLineupAppearance.team_id == team.id,
            )
        )
        if row is None:
            row = MatchLineupAppearance(match_id=match.id, player_id=player.id, team_id=team.id)
            session.add(row)
        row.provider_id = provider.id
        row.jersey_number = la.jersey_number
        row.position_name = la.position_name
        row.position_group = la.position_group
        row.minutes = la.minutes
        row.starter = la.starter
        row.lineup_available = la.lineup_available
        row.source_snapshot_record_id = snapshot.id
        row.raw_payload_json = la.raw_payload

    for ev in bundle.events:
        provider = provider_for(ev.provider_slug)
        match = match_by_provider_id.get((ev.provider_slug, ev.provider_match_id))
        if match is None:
            continue
        row = session.scalar(
            select(Event).where(
                Event.provider_id == provider.id,
                Event.provider_event_id == ev.provider_event_id,
            )
        )
        if row is None:
            row = Event(provider_id=provider.id, provider_event_id=ev.provider_event_id)
            session.add(row)
        row.match_id = match.id
        player = player_for(bundle.source_name, ev.source_player_id or "")
        team = team_by_slug.get(ev.team_slug or "")
        row.player_id = player.id if player else None
        row.team_id = team.id if team else None
        row.event_type = ev.event_type
        row.minute = ev.minute
        row.second = ev.second
        row.possession = ev.possession
        row.location_json = ev.location
        row.source_snapshot_record_id = snapshot.id
        row.raw_payload_json = ev.raw_payload

    for c in bundle.coverages:
        provider = provider_for(c.provider_slug)
        comp = comp_by_slug.get(c.competition_slug)
        season = season_by_label.get(c.season_label)
        if not (comp and season):
            continue
        row = session.scalar(
            select(DataCoverage).where(
                DataCoverage.provider_id == provider.id,
                DataCoverage.competition_id == comp.id,
                DataCoverage.season_id == season.id,
                DataCoverage.source_snapshot_record_id == snapshot.id,
            )
        )
        if row is None:
            row = DataCoverage(
                provider_id=provider.id,
                competition_id=comp.id,
                season_id=season.id,
                source_snapshot_record_id=snapshot.id,
            )
            session.add(row)
        row.matches_covered = c.matches_covered
        row.known_total_matches = c.known_total_matches
        row.events_available = c.events_available
        row.lineups_available = c.lineups_available
        row.three_sixty_available = c.three_sixty_available
        row.coverage_pct = c.coverage_pct
        row.last_match_date = date.fromisoformat(c.last_match_date) if c.last_match_date else None
        row.confidence_json = c.confidence

    for pe in bundle.player_evidence:
        provider = provider_for(pe.provider_slug)
        player = player_for(bundle.source_name, pe.source_player_id)
        comp = comp_by_slug.get(pe.competition_slug)
        season = season_by_label.get(pe.season_label)
        if not (player and comp and season):
            continue
        row = session.scalar(
            select(PlayerEvidenceConfidence).where(
                PlayerEvidenceConfidence.player_id == player.id,
                PlayerEvidenceConfidence.competition_id == comp.id,
                PlayerEvidenceConfidence.season_id == season.id,
                PlayerEvidenceConfidence.provider_id == provider.id,
            )
        )
        if row is None:
            row = PlayerEvidenceConfidence(
                player_id=player.id,
                competition_id=comp.id,
                season_id=season.id,
                provider_id=provider.id,
            )
            session.add(row)
        row.source_snapshot_record_id = snapshot.id
        row.minutes = pe.minutes
        row.appearances = pe.appearances
        row.starts = pe.starts
        row.matches_covered = pe.matches_covered
        row.known_total_matches = pe.known_total_matches
        row.competition_coverage_pct = pe.competition_coverage_pct
        row.data_recency_days = pe.data_recency_days
        row.sample_size_confidence = pe.sample_size_confidence
        row.coverage_confidence = pe.coverage_confidence
        row.league_adjustment_confidence = pe.league_adjustment_confidence
        row.role_similarity_confidence = pe.role_similarity_confidence
        row.overall_rating_confidence = pe.overall_rating_confidence
        row.explanation_json = pe.explanation

    # ---- resolve metrics to players (bundle players first, then existing source ids) ----
    psid_cache: dict[tuple, Player | None] = {}

    def resolve_metric_player(id_source: str, spid: str) -> Player | None:
        bundle_player = player_for(id_source, spid)
        if bundle_player is not None:
            return bundle_player
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
    quarantine_candidates = list(bundle.quarantine_candidates)
    seen_keys: set = set()
    dup_count = 0
    for m in bundle.metrics:
        id_source = m.id_source_name or bundle.source_name
        canonical_name = resolve_metric(m.metric_name)
        market_metric = m.metric_name in {
            "public_value_eur",
            "contract_until",
            "international_caps",
            "hype_index",
            "recent_form_index",
        }
        if canonical_name is None and not market_metric:
            quarantine_candidates.append(
                _quarantine_candidate(
                    entity_type="metric",
                    external_id=m.source_player_id,
                    reason_code="invalid_canonical_metric_name",
                    context={"metric_name": m.metric_name, "season": m.season_label},
                )
            )
            continue
        if (
            m.metric_value is not None
            and m.metric_value < 0
            and m.metric_name
            not in {
                "goals_minus_xg_per90",
                "finishing_over_xg",
            }
        ):
            quarantine_candidates.append(
                _quarantine_candidate(
                    entity_type="metric",
                    external_id=m.source_player_id,
                    reason_code="invalid_metric_value",
                    context={"metric_name": m.metric_name, "season": m.season_label},
                )
            )
            continue
        player = resolve_metric_player(id_source, m.source_player_id)
        if player is None:
            quarantined.append([id_source, m.source_player_id])
            quarantine_candidates.append(
                _quarantine_candidate(
                    entity_type="player_metric",
                    external_id=m.source_player_id,
                    reason_code="unresolved_or_ambiguous_player_identity",
                    context={
                        "identity_source": id_source,
                        "metric_name": m.metric_name,
                        "source_row_number": m.raw_payload.get("source_row_number"),
                    },
                )
            )
            continue
        season = resolve_season(m.season_label)
        key = (player.id, bundle.source_name, season.id, m.metric_name, bundle.source_snapshot_id)
        if key in seen_keys:
            dup_count += 1
            quarantine_candidates.append(
                _quarantine_candidate(
                    entity_type="metric",
                    external_id=m.source_player_id,
                    reason_code="duplicate_source_record",
                    context={"metric_name": m.metric_name, "season": m.season_label},
                )
            )
            continue
        seen_keys.add(key)
        resolved_rows.append((player.id, season.id, m))

    # clear this source's rows for the affected players/seasons, then re-insert (idempotent)
    pids = {r[0] for r in resolved_rows} | {p.id for p in player_by_source_key.values()}
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
    quarantine_count = _persist_quarantine(
        session,
        run=run,
        snapshot=snapshot,
        provider=provider_slug,
        source_name=bundle.source_name,
        fingerprint=fingerprint,
        candidates=quarantine_candidates,
    )
    session.add(
        DataQualityReport(source_name=bundle.source_name, run_id=run.id, report_json=report)
    )

    warnings_present = _quality_summary(report)["warnings"] > 0 or quarantine_count > 0
    final_status = "completed_with_warnings" if warnings_present else "completed"
    finish_run(session, run, affected=len(player_by_source_key), status=final_status)
    run.summary_json = {
        **(run.summary_json or {}),
        "plan": plan,
        "records": {
            "players_written": len(player_by_source_key),
            "metrics_written": len(resolved_rows),
            "records_quarantined": quarantine_count,
        },
        "quality": _quality_summary(report),
    }
    input_identity_keys = {
        (metric.id_source_name or bundle.source_name, metric.source_player_id)
        for metric in bundle.metrics
    }
    unresolved_identity_keys = {tuple(item) for item in quarantined}
    identity_match_rate = (
        round(1 - len(unresolved_identity_keys) / len(input_identity_keys), 6)
        if input_identity_keys
        else 1.0
    )
    snapshot.metadata_json = {
        **(snapshot.metadata_json or {}),
        "operational_stats": {
            "identity_match_rate": identity_match_rate,
            "quarantine_count": quarantine_count,
            "quality_warning_count": _quality_summary(report)["warnings"],
        },
    }
    if adapter and not adapter.capabilities.fixture_data:
        snapshot.health_label = "partial" if warnings_present else "healthy"
    if replay_of_run_id is not None:
        resolved_quarantine_count = _resolve_replayed_quarantine(
            session,
            original_run_id=replay_of_run_id,
            replay_run=run,
            provider=provider_slug,
            replay_candidates=quarantine_candidates,
            published_player_external_ids={
                source_player_id for _, source_player_id in player_by_source_key
            },
            published_metric_external_ids={
                metric.source_player_id for _, _, metric in resolved_rows
            },
            published_source_references={
                str(source_reference)
                for _, _, metric in resolved_rows
                if (source_reference := metric.raw_payload.get("source_row_number")) is not None
            },
        )
        run.summary_json = {
            **(run.summary_json or {}),
            "replay": {
                "original_run_id": replay_of_run_id,
                "quarantine_records_resolved": resolved_quarantine_count,
            },
        }
    session.commit()
    return {
        "run_id": run.id,
        "status": final_status,
        "players": len(player_by_source_key),
        "metrics": len(resolved_rows),
        "quarantined": quarantine_count,
        "report": report,
        "plan": plan,
    }


def execute_ingestion(
    session: Session,
    adapter,
    *,
    mode: str = "normal",
    min_minutes: int = 450,
    replay_of_run_id: int | None = None,
) -> dict:
    """Own fetch-to-publish lifecycle so parser failures are auditable in normal mode."""
    contract_errors = adapter.validate_contract()
    run = None
    if mode == "normal":
        run = start_run(
            session,
            "ingest",
            f"ingest:{adapter.name}",
            [],
            {},
            status="planned",
            provider=adapter.capabilities.provider_id,
            ingestion_mode=mode,
        )
        run.replay_of_run_id = replay_of_run_id
        session.commit()
    try:
        if run is not None:
            transition_run(run, "validating")
            session.commit()
        if contract_errors:
            raise ValueError(f"Provider contract failed: {contract_errors}")
        bundle = adapter.fetch()
        return ingest_bundle(
            session,
            bundle,
            min_minutes=min_minutes,
            mode=mode,
            adapter=adapter,
            existing_run=run,
            replay_of_run_id=replay_of_run_id,
        )
    except Exception as exc:
        if run is not None:
            session.rollback()
            persisted = session.get(RatingRun, run.id)
            if persisted is not None and persisted.status != "failed":
                message = str(exc)
                if "missing required columns" in message.lower():
                    reason_code = "missing_required_source_fields"
                elif "provider contract failed" in message.lower():
                    reason_code = "provider_contract_failure"
                else:
                    reason_code = "source_schema_drift"
                failure_fingerprint = persisted.snapshot_fingerprint or _stable_hash(
                    {
                        "provider": adapter.capabilities.provider_id,
                        "reason": reason_code,
                        "message": message,
                    }
                )
                persisted.snapshot_fingerprint = failure_fingerprint
                _persist_quarantine(
                    session,
                    run=persisted,
                    snapshot=None,
                    provider=adapter.capabilities.provider_id,
                    source_name=adapter.name,
                    fingerprint=failure_fingerprint,
                    candidates=[
                        _quarantine_candidate(
                            entity_type="source_schema",
                            external_id=None,
                            reason_code=reason_code,
                            severity="error",
                            context={
                                "exception_type": type(exc).__name__,
                                "message": message[:500],
                            },
                        )
                    ],
                )
                persisted.failure_details_json = {
                    "exception_type": type(exc).__name__,
                    "message": message[:500],
                }
                fail_run(session, persisted, message)
                session.commit()
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ScoutBoy ingestion")
    parser.add_argument("--source", default="sample", help="source adapter name")
    parser.add_argument("--list-providers", action="store_true")
    parser.add_argument(
        "--input-path",
        default=None,
        help="path to a CSV directory (transfermarkt) or CSV file (performance_csv)",
    )
    parser.add_argument("--competition-id", default=None, help="source competition id (e.g. L1)")
    parser.add_argument("--target-season", type=int, default=None, help="season start year")
    parser.add_argument(
        "--statsbomb-season-id",
        type=int,
        action="append",
        default=None,
        help="StatsBomb Open Data season_id filter; repeat for multiple seasons",
    )
    parser.add_argument(
        "--recent-seasons",
        type=int,
        default=None,
        help="for statsbomb_open_data, keep N most recent available seasons per competition",
    )
    parser.add_argument("--as-of-date", default=None, help="valuation cutoff date (YYYY-MM-DD)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="plan and validate without writes")
    mode.add_argument(
        "--validate-only", action="store_true", help="validate contract and quality without writes"
    )
    parser.add_argument("--replay-run-id", type=int, default=None)
    parser.add_argument("--generated-size", type=int, default=5000)
    parser.add_argument("--credential-required-mode", action="store_true")
    args = parser.parse_args(argv)

    if args.list_providers:
        print(
            json.dumps(
                {key: value.to_dict() for key, value in provider_capabilities().items()},
                indent=2,
                sort_keys=True,
            )
        )
        return 0

    as_of = date.fromisoformat(args.as_of_date) if args.as_of_date else None
    adapter = get_adapter(
        args.source,
        input_path=args.input_path,
        target_competition_id=args.competition_id,
        target_season=args.target_season,
        statsbomb_season_ids=args.statsbomb_season_id,
        recent_seasons=args.recent_seasons,
        as_of_date=as_of,
        generated_size=args.generated_size,
        credential_required_mode=args.credential_required_mode,
    )
    selected_mode = (
        "dry_run" if args.dry_run else "validate_only" if args.validate_only else "normal"
    )
    with SessionLocal() as session:
        result = execute_ingestion(
            session,
            adapter,
            mode=selected_mode,
            replay_of_run_id=args.replay_run_id,
        )
    print(json.dumps(result, indent=2, sort_keys=True, default=str))
    return 1 if result["status"] == "blocked" else 0


if __name__ == "__main__":
    sys.exit(main())
