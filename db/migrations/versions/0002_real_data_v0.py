"""real data v0 — universe table + dedupe/uniqueness constraints

Additive and inspector-guarded so it is safe whether the DB was created by the 0001
create_all baseline (which already reflects current ORM metadata, including these) or
is an older database that predates them.

Revision ID: 0002_real_data_v0
Revises: 0001_initial
Create Date: 2024-02-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from app.models.orm import Base

revision = "0002_real_data_v0"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1) new table (skip if the baseline create_all already made it)
    if "player_universe_memberships" not in insp.get_table_names():
        Base.metadata.tables["player_universe_memberships"].create(bind=bind)

    # 2) unique indexes / constraints (skip if already present)
    existing_raw = {ix["name"] for ix in insp.get_indexes("player_metrics_raw")}
    if "uq_metric_raw_dedupe" not in existing_raw:
        op.create_index(
            "uq_metric_raw_dedupe",
            "player_metrics_raw",
            ["player_id", "source_name", "season_id", "metric_name", "source_snapshot_id"],
            unique=True,
        )

    rr_uniques = {c["name"] for c in insp.get_unique_constraints("role_ratings")}
    rr_indexes = {ix["name"] for ix in insp.get_indexes("role_ratings")}
    if "uq_role_rating" not in rr_uniques and "uq_role_rating" not in rr_indexes:
        # portable across SQLite/Postgres without a table rebuild
        op.create_index(
            "uq_role_rating",
            "role_ratings",
            ["player_id", "role_key", "season_id", "version"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for name, table in [
        ("uq_role_rating", "role_ratings"),
        ("uq_metric_raw_dedupe", "player_metrics_raw"),
    ]:
        if name in {ix["name"] for ix in insp.get_indexes(table)}:
            op.drop_index(name, table_name=table)
    if "player_universe_memberships" in insp.get_table_names():
        op.drop_table("player_universe_memberships")
