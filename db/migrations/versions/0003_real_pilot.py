"""real pilot provenance and observation metadata

Revision ID: 0003_real_pilot
Revises: 0002_real_data_v0
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from app.models.orm import Base

revision = "0003_real_pilot"
down_revision = "0002_real_data_v0"
branch_labels = None
depends_on = None


def _add_column_if_missing(table: str, column: sa.Column) -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns(table)}
    if column.name not in columns:
        op.add_column(table, column)


def upgrade() -> None:
    bind = op.get_bind()
    if "source_snapshots" not in sa.inspect(bind).get_table_names():
        Base.metadata.tables["source_snapshots"].create(bind=bind)
    _add_column_if_missing(
        "player_metrics_raw", sa.Column("source_snapshot_record_id", sa.Integer(), nullable=True)
    )
    _add_column_if_missing(
        "player_metrics_raw", sa.Column("metric_provider", sa.String(length=50), nullable=True)
    )
    _add_column_if_missing(
        "player_metrics_raw", sa.Column("scope", sa.String(length=50), nullable=True)
    )
    _add_column_if_missing(
        "appearances", sa.Column("source_snapshot_record_id", sa.Integer(), nullable=True)
    )
    inspector = sa.inspect(bind)
    indexes = inspector.get_indexes("player_metrics_raw")
    if not any(i.get("column_names") == ["source_snapshot_record_id"] for i in indexes):
        op.create_index(
            "ix_player_metrics_raw_snapshot_record",
            "player_metrics_raw",
            ["source_snapshot_record_id"],
        )
    appearance_indexes = inspector.get_indexes("appearances")
    if not any(i.get("column_names") == ["source_snapshot_record_id"] for i in appearance_indexes):
        op.create_index(
            "ix_appearances_snapshot_record", "appearances", ["source_snapshot_record_id"]
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table, index in (
        ("appearances", "ix_appearances_snapshot_record"),
        ("player_metrics_raw", "ix_player_metrics_raw_snapshot_record"),
    ):
        if index in {i["name"] for i in inspector.get_indexes(table)}:
            op.drop_index(index, table_name=table)
    for table, column in (
        ("appearances", "source_snapshot_record_id"),
        ("player_metrics_raw", "scope"),
        ("player_metrics_raw", "metric_provider"),
        ("player_metrics_raw", "source_snapshot_record_id"),
    ):
        if column in {c["name"] for c in inspector.get_columns(table)}:
            op.drop_column(table, column)
    if "source_snapshots" in inspector.get_table_names():
        op.drop_table("source_snapshots")
