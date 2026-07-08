from __future__ import annotations

from typing import Optional

from rolefit import RATING_VERSION
from sqlalchemy.orm import Session

from app.models.schemas import AuditBreakdown, RoleRatingDetail
from app.repositories import players_repo as repo

from . import _common as C


def ratings_detail(session: Session, player_id: int) -> Optional[RoleRatingDetail]:
    if repo.get_player(session, player_id) is None:
        return None
    season = repo.get_current_season(session)
    if season is None:
        return None
    ratings = repo.ratings_for_player(session, player_id, season.id)
    audits = repo.audits_for_ratings(session, [r.id for r in ratings])
    id_to_role = {r.id: r.role_key for r in ratings}

    audit_schemas = []
    for rid, a in audits.items():
        audit_schemas.append(
            AuditBreakdown(
                role_key=id_to_role.get(rid, ""),
                metric_breakdown=a.metric_breakdown_json or {},
                context_breakdown=a.context_breakdown_json or {},
                confidence_breakdown=a.confidence_breakdown_json or {},
                penalties=a.penalties_json or {},
                explanation_text=a.explanation_text,
            )
        )
    audit_schemas.sort(key=lambda x: x.role_key)

    return RoleRatingDetail(
        player_id=player_id,
        season=season.label,
        rating_version=RATING_VERSION,
        ratings=C.role_summaries(ratings),
        audits=audit_schemas,
    )
