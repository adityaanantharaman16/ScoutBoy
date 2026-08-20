"""Milestone 8.4A: optional accounts and durable favorites

Revision ID: 0007_optional_accounts
Revises: 0006_discovery_query_indexes

Phase 8.4A gives a signed-in scout a My Favorites list that survives a new device
and a cleared browser. Guests keep the browser-local list they already have, so
this migration adds capacity without changing a single existing table, column,
index or constraint: an anonymous deployment that never enables authentication
runs against the post-migration schema exactly as it ran before.

Two tables only. `app_users` is the smallest record that can attach a list to a
verified identity — the opaque Clerk subject plus the issuer that vouched for it,
and nothing describing the person. `user_favorites` is the list itself.

The unique constraint on (`auth_issuer`, `external_subject`) is what makes lazy
account creation idempotent under concurrency: two simultaneous first requests
race to insert, the loser's INSERT is rejected by the database rather than by
application logic, and it re-reads the winner's row. Subject alone would be
wrong, because a subject is only unique within its issuing tenant.

`user_favorites` orders on (`created_at`, `id`). A merge inserts several rows in
one transaction and the timestamp default can give them all the same value, so
the autoincrement key is carried as the final ordering term; that is the whole
reason the canonical order is reproducible on SQLite and PostgreSQL alike.
`uq_user_favorite` makes PUT idempotent, and `ix_user_favorites_user_order`
serves the one query every endpoint ends with: this user's rows, in that order.

Both statements are plain portable DDL. `sa.DateTime(timezone=True)` becomes
TIMESTAMP WITH TIME ZONE on PostgreSQL and a TEXT-backed datetime on SQLite,
which is how every existing timestamp column in this schema is already declared.
The tables are created, never altered, so no batch/`render_as_batch` rewrite is
involved on SQLite.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_optional_accounts"
down_revision = "0006_discovery_query_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "app_users" not in tables:
        op.create_table(
            "app_users",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column(
                "auth_provider", sa.String(length=50), nullable=False, server_default="clerk"
            ),
            sa.Column("auth_issuer", sa.String(length=255), nullable=False),
            sa.Column("external_subject", sa.String(length=255), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("auth_issuer", "external_subject", name="uq_app_user_identity"),
        )
        op.create_index("ix_app_users_auth_issuer", "app_users", ["auth_issuer"])
        op.create_index("ix_app_users_external_subject", "app_users", ["external_subject"])

    if "user_favorites" not in tables:
        op.create_table(
            "user_favorites",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("player_id", sa.Integer(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["player_id"], ["players.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "player_id", name="uq_user_favorite"),
        )
        op.create_index("ix_user_favorites_user_id", "user_favorites", ["user_id"])
        op.create_index("ix_user_favorites_player_id", "user_favorites", ["player_id"])
        op.create_index(
            "ix_user_favorites_user_order", "user_favorites", ["user_id", "created_at", "id"]
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    # Favourites first: it is the side that holds the foreign key.
    if "user_favorites" in tables:
        op.drop_table("user_favorites")
    if "app_users" in tables:
        op.drop_table("app_users")
