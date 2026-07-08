from __future__ import annotations

from typing import Optional

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
    last_updated: Optional[str] = None
