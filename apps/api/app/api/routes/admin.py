from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import UnauthorizedError
from app.models.orm import RatingRun
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
    from data_pipeline.jobs.ingest import ingest_bundle

    bundle = get_adapter(source).fetch()
    result = ingest_bundle(db, bundle)
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
