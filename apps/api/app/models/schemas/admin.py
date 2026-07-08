from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class RatingRunSummary(BaseModel):
    id: int
    run_type: str
    version: str
    status: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    affected_players_count: Optional[int] = None
    error_message: Optional[str] = None
    config_hashes: dict = {}
    source_snapshot_ids: list[str] = []


class IngestResult(BaseModel):
    run_id: int
    source: str
    players: int
    metrics: int
    quality_errors: int
    quality_warnings: int


class RecomputeResult(BaseModel):
    run_id: int
    affected: int
    seasons: int
    outlier_check: dict = {}
