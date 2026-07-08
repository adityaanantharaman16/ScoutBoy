from __future__ import annotations

from typing import Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class DataSource(BaseModel):
    source_name: str
    source_player_id: Optional[str] = None
    source_url: Optional[str] = None


class Paginated(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
