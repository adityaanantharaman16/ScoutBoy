"""provider agnostic event provenance and coverage

Revision ID: 0004_provider_agnostic_events
Revises: 0003_real_pilot
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from app.models.orm import Base

revision = "0004_provider_agnostic_events"
down_revision = "0003_real_pilot"
branch_labels = None
depends_on = None


TABLES = (
    "providers",
    "provider_identifiers",
    "player_team_season_registrations",
    "matches",
    "match_lineup_appearances",
    "events",
    "data_coverages",
    "player_evidence_confidences",
)


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    for table in TABLES:
        if table not in existing:
            Base.metadata.tables[table].create(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    for table in reversed(TABLES):
        if table in existing:
            op.drop_table(table)
