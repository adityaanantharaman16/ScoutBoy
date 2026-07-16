"""Shared helpers for the ingest / recompute jobs: run bookkeeping and
definition seeding from configs."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from app.models.orm import (
    PlaystyleDefinition,
    RatingRun,
    RoleDefinition,
    RoleWeightVersion,
    Season,
)
from rolefit import PLAYSTYLE_VERSION, RATING_VERSION
from sqlalchemy import select
from sqlalchemy.orm import Session


def start_run(
    session: Session, run_type: str, version: str, snapshot_ids: list, config_hashes: dict
) -> RatingRun:
    run = RatingRun(
        run_type=run_type,
        version=version,
        status="running",
        source_snapshot_ids_json=snapshot_ids,
        config_hashes_json=config_hashes,
        started_at=datetime.now(timezone.utc),
    )
    session.add(run)
    session.flush()
    return run


def finish_run(session: Session, run: RatingRun, affected: int) -> None:
    run.status = "completed"
    run.completed_at = datetime.now(timezone.utc)
    run.affected_players_count = affected


def fail_run(session: Session, run: RatingRun, message: str) -> None:
    run.status = "failed"
    run.completed_at = datetime.now(timezone.utc)
    run.error_message = message[:2000]


def get_or_create_season(
    session: Session,
    label: str,
    is_current: bool = False,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> Season:
    if is_current:
        for existing in session.scalars(select(Season).where(Season.is_current.is_(True))):
            if existing.label != label:
                existing.is_current = False
    season = session.scalar(select(Season).where(Season.label == label))
    if season is None:
        season = Season(label=label)
        session.add(season)
    season.is_current = is_current or season.is_current
    if start:
        season.start_date = _d(start)
    if end:
        season.end_date = _d(end)
    session.flush()
    return season


def _d(value: str) -> Optional[date]:
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def seed_role_definitions(session: Session, roles: dict) -> None:
    for role in roles.values():
        rd = session.scalar(select(RoleDefinition).where(RoleDefinition.role_key == role.role_key))
        if rd is None:
            rd = RoleDefinition(role_key=role.role_key)
            session.add(rd)
        rd.display_name = role.display_name
        rd.position_group = role.position_group
        rd.description = role.description
        rd.is_active = True

        existing = session.scalar(
            select(RoleWeightVersion).where(
                RoleWeightVersion.role_key == role.role_key,
                RoleWeightVersion.version == RATING_VERSION,
            )
        )
        weights = {g.key: g.weight for g in role.groups}
        if existing is None:
            session.add(
                RoleWeightVersion(
                    role_key=role.role_key,
                    version=RATING_VERSION,
                    config_hash=role.config_hash,
                    weights_json=weights,
                    status="published",
                )
            )
        else:
            existing.config_hash = role.config_hash
            existing.weights_json = weights


def seed_playstyle_definitions(session: Session, playstyle_config) -> None:
    def upsert(item: dict, is_concern: bool):
        pd = session.scalar(
            select(PlaystyleDefinition).where(
                PlaystyleDefinition.playstyle_key == item["key"],
                PlaystyleDefinition.version == playstyle_config.version,
            )
        )
        if pd is None:
            pd = PlaystyleDefinition(playstyle_key=item["key"], version=playstyle_config.version)
            session.add(pd)
        pd.display_name = item["display_name"]
        pd.category = item.get("category", "general")
        pd.description = item.get("description")
        pd.thresholds_json = item.get("tiers", playstyle_config.positive_defaults.get("tiers", {}))
        pd.is_concern = is_concern
        pd.is_active = True

    for p in playstyle_config.positives:
        upsert(p, False)
    for c in playstyle_config.concerns:
        upsert(c, True)


def config_hashes(roles: dict, context_config, playstyle_config) -> dict:
    return {
        "roles": {k: v.config_hash for k, v in roles.items()},
        "context": context_config.config_hash,
        "playstyles": playstyle_config.config_hash,
        "rating_version": RATING_VERSION,
        "playstyle_version": PLAYSTYLE_VERSION,
    }
