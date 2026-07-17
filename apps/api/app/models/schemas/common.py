from __future__ import annotations

from typing import Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class DataSource(BaseModel):
    source_name: str
    source_player_id: Optional[str] = None
    source_url: Optional[str] = None
    provider_display_name: Optional[str] = None
    data_type: Optional[str] = None
    last_updated: Optional[str] = None
    license_url: Optional[str] = None
    attribution: Optional[str] = None


class Paginated(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
