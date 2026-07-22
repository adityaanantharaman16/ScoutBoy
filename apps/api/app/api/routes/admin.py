from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import UnauthorizedError
from app.models.orm import QuarantineRecord, RatingRun
from app.models.schemas import IngestResult, RatingRunSummary, RecomputeResult

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(x_admin_token: Optional[str] = Header(default=None)) -> None:
    """Simple local admin gate. When SCOUTBOY_ADMIN_TOKEN is unset, allow (local dev)."""
    token = get_settings().admin_token
    if token and x_admin_token != token:
        raise UnauthorizedError()


def _iso(dt):
    return dt.isoformat() if dt else None


@router.post("/ingest", response_model=IngestResult, dependencies=[Depends(require_admin)])
def trigger_ingest(source: str = "sample", db: Session = Depends(get_db)):
    from data_pipeline.adapters import get_adapter
    from data_pipeline.jobs.ingest import execute_ingestion

    adapter = get_adapter(source)
    result = execute_ingestion(db, adapter)
    findings = result["report"]["findings"]
    return IngestResult(
        run_id=result["run_id"],
        source=source,
        players=result["players"],
        metrics=result["metrics"],
        quality_errors=sum(1 for f in findings if f["severity"] == "error" and f["count"]),
        quality_warnings=sum(1 for f in findings if f["severity"] == "warn" and f["count"]),
    )


@router.post(
    "/recompute-ratings", response_model=RecomputeResult, dependencies=[Depends(require_admin)]
)
def trigger_recompute(db: Session = Depends(get_db)):
    from data_pipeline.jobs.recompute import recompute

    result = recompute(db)
    return RecomputeResult(
        run_id=result["run_id"],
        affected=result["affected"],
        seasons=result["seasons"],
        outlier_check=result["outlier_check"],
    )


@router.get(
    "/rating-runs", response_model=list[RatingRunSummary], dependencies=[Depends(require_admin)]
)
def rating_runs(limit: int = 50, db: Session = Depends(get_db)):
    runs = db.scalars(select(RatingRun).order_by(RatingRun.id.desc()).limit(limit))
    return [
        RatingRunSummary(
            id=r.id,
            run_type=r.run_type,
            version=r.version,
            status=r.status,
            started_at=_iso(r.started_at),
            completed_at=_iso(r.completed_at),
            affected_players_count=r.affected_players_count,
            error_message=r.error_message,
            config_hashes=r.config_hashes_json or {},
            source_snapshot_ids=r.source_snapshot_ids_json or [],
        )
        for r in runs
    ]


@router.get("/providers", dependencies=[Depends(require_admin)])
def providers():
    from data_pipeline.adapters import provider_capabilities

    return [capability.to_dict() for capability in provider_capabilities().values()]


@router.get("/ingestion-runs", dependencies=[Depends(require_admin)])
def ingestion_runs(limit: int = 50, db: Session = Depends(get_db)):
    from data_pipeline.operations import run_summary

    rows = db.scalars(
        select(RatingRun)
        .where(RatingRun.run_type == "ingest")
        .order_by(RatingRun.id.desc())
        .limit(limit)
    )
    return [run_summary(row) for row in rows]


@router.get("/ingestion-runs/{run_id}", dependencies=[Depends(require_admin)])
def ingestion_run(run_id: int, db: Session = Depends(get_db)):
    from data_pipeline.operations import run_summary

    row = db.get(RatingRun, run_id)
    if row is None or row.run_type != "ingest":
        from app.core.errors import NotFoundError

        raise NotFoundError("Ingestion run not found")
    return run_summary(row)


@router.get("/quarantine", dependencies=[Depends(require_admin)])
def quarantine(status: Optional[str] = None, limit: int = 100, db: Session = Depends(get_db)):
    from data_pipeline.operations import quarantine_summary

    statement = select(QuarantineRecord).order_by(QuarantineRecord.id.desc())
    if status:
        statement = statement.where(QuarantineRecord.status == status)
    return [quarantine_summary(row) for row in db.scalars(statement.limit(limit))]


@router.get("/snapshots/{snapshot_id}/diff", dependencies=[Depends(require_admin)])
def diff_snapshot(snapshot_id: int, other_snapshot_id: int, db: Session = Depends(get_db)):
    from data_pipeline.operations import snapshot_diff

    try:
        return snapshot_diff(db, snapshot_id, other_snapshot_id)
    except ValueError as exc:
        from app.core.errors import BadRequestError

        raise BadRequestError(str(exc)) from exc


@router.get("/freshness", dependencies=[Depends(require_admin)])
def source_freshness(db: Session = Depends(get_db)):
    from data_pipeline.operations import freshness_report

    return freshness_report(db)


@router.get("/coverage", dependencies=[Depends(require_admin)])
def source_coverage(db: Session = Depends(get_db)):
    from data_pipeline.operations import coverage_report

    return coverage_report(db)
