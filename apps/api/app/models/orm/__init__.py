"""SQLAlchemy ORM models. Importing this package registers every table on
``Base.metadata`` (used by Alembic migrations and by tests)."""

from __future__ import annotations

from .base import Base
from .entities import (
    Appearance,
    Competition,
    Player,
    PlayerSourceId,
    Season,
    Team,
)
from .market import MarketValue
from .metrics import ContextAdjustment, PlayerMetricNormalized, PlayerMetricRaw
from .playstyles import PlayerPlaystyle, PlaystyleDefinition
from .ratings import RatingAudit, RoleDefinition, RoleRating, RoleWeightVersion
from .runs import (
    DataQualityReport,
    PlayerUniverseMembership,
    RatingRun,
    SimilarityVector,
    SourceSnapshot,
)

__all__ = [
    "Base",
    "Player",
    "PlayerSourceId",
    "Team",
    "Competition",
    "Season",
    "Appearance",
    "PlayerMetricRaw",
    "PlayerMetricNormalized",
    "ContextAdjustment",
    "RoleDefinition",
    "RoleWeightVersion",
    "RoleRating",
    "RatingAudit",
    "PlaystyleDefinition",
    "PlayerPlaystyle",
    "MarketValue",
    "SimilarityVector",
    "PlayerUniverseMembership",
    "RatingRun",
    "DataQualityReport",
    "SourceSnapshot",
]
