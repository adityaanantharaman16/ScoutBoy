"""Milestone 8 phase 8.1B: composite indexes for database-side Discovery selection

Revision ID: 0006_discovery_query_indexes
Revises: 0005_data_operations

Phase 8.1B executes Discovery's candidate selection, predicates, ordering, counting
and pagination in SQL. Every part of that query reaches a one-to-many table the same
way: filter to the current season, then correlate on a single player. The existing
indexes lead with only one of those two columns, so the season-scoped, player-
correlated probes could not be satisfied by a seek.

Measured on a deterministic 5,000-player cohort (SQLite), `EXPLAIN QUERY PLAN` for the
Discovery count went from repeated `SCAN` steps at roughly 1.1s to `SEARCH ... USING
INDEX (season_id=? AND player_id=?)` at roughly 7ms, and a playstyle-filtered search
from roughly 555ms to roughly 14ms. The plans and the reasoning are recorded in
docs/milestone_8_discovery_contract.md.

Scope is deliberately narrow: one composite index per table Discovery correlates on
per candidate, and nothing else. `player_universe_memberships` is excluded because its
existing unique constraint already leads with `player_id` and serves its EXISTS probe.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_discovery_query_indexes"
down_revision = "0005_data_operations"
branch_labels = None
depends_on = None

#: index name -> (table, columns)
INDEXES = {
    "ix_appearances_season_player": ("appearances", ["season_id", "player_id"]),
    "ix_role_ratings_season_player": ("role_ratings", ["season_id", "player_id"]),
    "ix_market_values_season_player": ("market_values", ["season_id", "player_id"]),
    "ix_player_playstyles_season_player": ("player_playstyles", ["season_id", "player_id"]),
}


def _existing(inspector, table: str) -> set:
    return {index["name"] for index in inspector.get_indexes(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for name, (table, columns) in INDEXES.items():
        if table in tables and name not in _existing(inspector, table):
            op.create_index(name, table, columns)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for name, (table, _columns) in INDEXES.items():
        if table in tables and name in _existing(inspector, table):
            op.drop_index(name, table_name=table)
