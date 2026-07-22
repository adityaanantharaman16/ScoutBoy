"""Milestone 5 data operations lifecycle and quarantine

Revision ID: 0005_data_operations
Revises: 0004_provider_agnostic_events
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from app.models.orm import Base

revision = "0005_data_operations"
down_revision = "0004_provider_agnostic_events"
branch_labels = None
depends_on = None


def _columns(inspector, table: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table)}


def _indexes(inspector, table: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    with op.batch_alter_table("rating_runs") as batch_op:
        batch_op.alter_column(
            "status", existing_type=sa.String(20), type_=sa.String(32), existing_nullable=False
        )

    snapshot_columns = _columns(inspector, "source_snapshots")
    snapshot_additions = {
        "fingerprint": sa.Column("fingerprint", sa.String(128), nullable=True),
        "scope_json": sa.Column("scope_json", sa.JSON(), nullable=False, server_default="{}"),
        "source_type": sa.Column("source_type", sa.String(40), nullable=True),
        "health_label": sa.Column(
            "health_label", sa.String(20), nullable=False, server_default="unknown"
        ),
        "known_limitation": sa.Column("known_limitation", sa.Text(), nullable=True),
        "attribution": sa.Column("attribution", sa.String(500), nullable=True),
    }
    for name, column in snapshot_additions.items():
        if name not in snapshot_columns:
            op.add_column("source_snapshots", column)

    inspector = sa.inspect(bind)
    run_columns = _columns(inspector, "rating_runs")
    run_additions = {
        "provider": sa.Column("provider", sa.String(80), nullable=True),
        "ingestion_mode": sa.Column("ingestion_mode", sa.String(30), nullable=True),
        "snapshot_fingerprint": sa.Column("snapshot_fingerprint", sa.String(128), nullable=True),
        "scope_json": sa.Column("scope_json", sa.JSON(), nullable=False, server_default="{}"),
        "summary_json": sa.Column("summary_json", sa.JSON(), nullable=False, server_default="{}"),
        "failure_details_json": sa.Column(
            "failure_details_json", sa.JSON(), nullable=False, server_default="{}"
        ),
        "replay_of_run_id": sa.Column(
            "replay_of_run_id",
            sa.Integer(),
            sa.ForeignKey("rating_runs.id", name="fk_rating_runs_replay_of_run_id"),
            nullable=True,
        ),
    }
    recreate = "always" if bind.dialect.name == "sqlite" else "auto"
    with op.batch_alter_table("rating_runs", recreate=recreate) as batch_op:
        for name, column in run_additions.items():
            if name not in run_columns:
                batch_op.add_column(column)

    inspector = sa.inspect(bind)
    if "quarantine_records" not in inspector.get_table_names():
        Base.metadata.tables["quarantine_records"].create(bind=bind)

    inspector = sa.inspect(bind)
    index_specs = {
        "source_snapshots": {
            "ix_source_snapshots_fingerprint": ["fingerprint"],
            "ix_source_snapshots_health_label": ["health_label"],
        },
        "rating_runs": {
            "ix_rating_runs_provider": ["provider"],
            "ix_rating_runs_snapshot_fingerprint": ["snapshot_fingerprint"],
            "ix_rating_runs_replay_of_run_id": ["replay_of_run_id"],
            "ix_ingest_provider_fingerprint_status": [
                "provider",
                "snapshot_fingerprint",
                "status",
            ],
        },
        "player_metrics_normalized": {
            "ix_metric_normalized_player_season_metric": [
                "player_id",
                "season_id",
                "metric_name",
            ],
        },
    }
    for table, specs in index_specs.items():
        existing = _indexes(inspector, table)
        for name, columns in specs.items():
            if name not in existing:
                op.create_index(name, table, columns)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "quarantine_records" in inspector.get_table_names():
        op.drop_table("quarantine_records")
    if "ix_metric_normalized_player_season_metric" in _indexes(
        sa.inspect(bind), "player_metrics_normalized"
    ):
        op.drop_index(
            "ix_metric_normalized_player_season_metric",
            table_name="player_metrics_normalized",
        )
    for name in (
        "ix_ingest_provider_fingerprint_status",
        "ix_rating_runs_replay_of_run_id",
        "ix_rating_runs_snapshot_fingerprint",
        "ix_rating_runs_provider",
    ):
        if name in _indexes(sa.inspect(bind), "rating_runs"):
            op.drop_index(name, table_name="rating_runs")
    run_columns = _columns(sa.inspect(bind), "rating_runs")
    removable_run_columns = (
        "replay_of_run_id",
        "failure_details_json",
        "summary_json",
        "scope_json",
        "snapshot_fingerprint",
        "ingestion_mode",
        "provider",
    )
    # replay_of_run_id participates in a self-referential FK. Rebuilding through
    # Alembic's batch implementation removes the column and its reflected FK together
    # on SQLite; PostgreSQL uses equivalent safe ALTER operations.
    recreate = "always" if bind.dialect.name == "sqlite" else "auto"
    with op.batch_alter_table("rating_runs", recreate=recreate) as batch_op:
        for column in removable_run_columns:
            if column in run_columns:
                batch_op.drop_column(column)
        batch_op.alter_column(
            "status", existing_type=sa.String(32), type_=sa.String(20), existing_nullable=False
        )
    for name in (
        "ix_source_snapshots_health_label",
        "ix_source_snapshots_fingerprint",
    ):
        if name in _indexes(sa.inspect(bind), "source_snapshots"):
            op.drop_index(name, table_name="source_snapshots")
    snapshot_columns = _columns(sa.inspect(bind), "source_snapshots")
    removable_snapshot_columns = (
        "attribution",
        "known_limitation",
        "health_label",
        "source_type",
        "scope_json",
        "fingerprint",
    )
    # SQLite refuses to drop columns that are still referenced by reflected
    # indexes. A single table rebuild removes the Milestone 5 columns and any
    # implicit indexes atomically.
    with op.batch_alter_table("source_snapshots", recreate=recreate) as batch_op:
        for column in removable_snapshot_columns:
            if column in snapshot_columns:
                batch_op.drop_column(column)
