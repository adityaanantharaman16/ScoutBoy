from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class RoleGroupMeta(BaseModel):
    key: str
    weight: float


class RoleMeta(BaseModel):
    role_key: str
    display_name: str
    position_group: str
    description: Optional[str] = None
    groups: list[RoleGroupMeta] = []


class PlaystyleMeta(BaseModel):
    key: str
    display_name: str
    category: Optional[str] = None
    description: Optional[str] = None


class ConcernMeta(BaseModel):
    key: str
    display_name: str
    description: Optional[str] = None


class ContextDimMeta(BaseModel):
    key: str
    explanation: str


class DataSourceMeta(BaseModel):
    name: str
    role: str
    url: Optional[str] = None
    note: str


class CalibrationSummary(BaseModel):
    passed: int = 0
    warned: int = 0
    failed: int = 0
    inconclusive: int = 0
    total: int = 0


CalibrationStatus = Literal["pass", "warn", "fail", "inconclusive"]


class CalibrationMeta(BaseModel):
    """Compact, evidence-honest calibration status for the Methodology surface.

    When calibration cannot be evaluated in this environment, ``available`` is False and
    ``status`` is ``inconclusive`` — totals stay zero and ``config_hash`` is null rather than
    fabricating a successful result or hiding the section."""

    available: bool = True
    suite_id: Optional[str] = None
    suite_version: Optional[str] = None
    calibration_version: Optional[str] = None
    rating_version: Optional[str] = None
    status: CalibrationStatus
    benchmarks: CalibrationSummary = CalibrationSummary()
    scenarios: CalibrationSummary = CalibrationSummary()
    methodology_note: str
    pilot_coverage_limitation: str
    config_hash: Optional[str] = None


class MethodologyResponse(BaseModel):
    scope: str
    rating_version: str
    playstyle_version: str
    market_version: str
    formula: str
    roles: list[RoleMeta] = []
    playstyles: list[PlaystyleMeta] = []
    concerns: list[ConcernMeta] = []
    context_dimensions: list[ContextDimMeta] = []
    data_sources: list[DataSourceMeta] = []
    limitations: list[str] = []
    calibration: Optional[CalibrationMeta] = None
    last_updated: Optional[str] = None
