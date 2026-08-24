"""Milestone 8.4B: saved Discovery views and saved comparison setups

Revision ID: 0008_saved_work
Revises: 0007_optional_accounts

Phase 8.4A gave a signed-in scout a durable My Favorites list. 8.4B extends the
same optional-account architecture to the two artifacts that carry a DECISION
rather than a player: the Discovery setup that produced a cohort, and the
comparison setup that weighed two players in a role.

Additive only. Two new tables, no existing table, column, index or constraint is
touched, so an anonymous deployment that never enables authentication runs
against the post-migration schema exactly as it ran before - and a deployment
already running 8.4A keeps every favourite it holds.

Why the two unique constraints per table
----------------------------------------
`*_fingerprint` is the LOGICAL identity: a SHA-256 digest the service computes
from the validated columns, so saving the same Discovery configuration (or the
same ordered player pair and role) twice updates the existing row instead of
growing a silent duplicate. A fixed-width digest rather than the canonical query
string itself, because a percent-encoded club name would push a raw string past
PostgreSQL's btree key-size limit.

`*_client_id` is the RETRY identity: the client mints a UUID before it sends
anything, so a create whose response was lost is retried onto the same row. Both
are scoped to `user_id`, so one account's id can never address another's row.

Ordering and indexes
--------------------
`ix_saved_*_user_order` serves the one query every endpoint here ends with: this
user's rows, in `(user_id, created_at, id)` order. The primary key is carried as
the final ordering term for the same reason `user_favorites` carries it - a merge
inserts several rows inside one transaction and the timestamp default can hand
them all the same value, so without a total tie-break the order of a just-merged
block would be whatever the storage engine returned that day.

Foreign keys, and why the two tables differ
-------------------------------------------
`user_id` is `ON DELETE CASCADE` on both: deleting an account removes its saved
work, which is what deleting an account means.

`saved_comparisons.player_a_id` / `player_b_id` are `ON DELETE SET NULL`, NOT
cascade. Cascading would silently delete a scout's saved comparison as a side
effect of a data refresh that happened to drop one participant; leaving a
dangling id would let the interface fabricate a player that no longer exists.
Nulling the reference while keeping `player_*_label` lets the row stay visible,
renameable and removable, and lets the interface name the unavailable side
honestly. There is no dangling reference either way.

Portability
-----------
Plain portable DDL. `sa.DateTime(timezone=True)` becomes TIMESTAMP WITH TIME ZONE
on PostgreSQL and a TEXT-backed datetime on SQLite, as every existing timestamp
column in this schema already is. `sa.BigInteger` carries the absolute-EUR asking
bounds, which a hand-crafted value can push past a 32-bit integer long before the
request schema's own ceiling rejects it. The tables are created, never altered,
so no batch/`render_as_batch` rewrite is involved on SQLite.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_saved_work"
down_revision = "0007_optional_accounts"
branch_labels = None
depends_on = None


def _timestamp(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "saved_discovery_views" not in tables:
        op.create_table(
            "saved_discovery_views",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("client_id", sa.String(length=36), nullable=False),
            sa.Column("fingerprint", sa.String(length=64), nullable=False),
            sa.Column("label", sa.String(length=80), nullable=False),
            # The representable Discovery state, one typed column per parameter
            # the rail can actually express. Deliberately not a JSON blob: a typed
            # column is what makes "no arbitrary URL or opaque payload is stored"
            # a property of the schema rather than a promise made above it.
            # `scope`/`universe` (retired in Phase 8.1A) and `page` (a saved view
            # always opens on page 1) have no column by design.
            sa.Column("q", sa.String(length=120), nullable=True),
            sa.Column("position_group", sa.String(length=64), nullable=True),
            sa.Column("role", sa.String(length=64), nullable=True),
            sa.Column("league", sa.String(length=120), nullable=True),
            sa.Column("club", sa.String(length=120), nullable=True),
            sa.Column("nationality", sa.String(length=120), nullable=True),
            sa.Column("playstyle", sa.String(length=64), nullable=True),
            sa.Column("age_min", sa.Integer(), nullable=True),
            sa.Column("age_max", sa.Integer(), nullable=True),
            sa.Column("min_minutes", sa.Integer(), nullable=True),
            sa.Column("rolefit_min", sa.Integer(), nullable=True),
            sa.Column("rolefit_max", sa.Integer(), nullable=True),
            sa.Column("value_min", sa.BigInteger(), nullable=True),
            sa.Column("value_max", sa.BigInteger(), nullable=True),
            sa.Column("sort", sa.String(length=64), nullable=True),
            sa.Column("page_size", sa.Integer(), nullable=True),
            _timestamp("created_at"),
            _timestamp("updated_at"),
            sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "fingerprint", name="uq_saved_view_fingerprint"),
            sa.UniqueConstraint("user_id", "client_id", name="uq_saved_view_client_id"),
        )
        op.create_index("ix_saved_discovery_views_user_id", "saved_discovery_views", ["user_id"])
        op.create_index(
            "ix_saved_views_user_order",
            "saved_discovery_views",
            ["user_id", "created_at", "id"],
        )

    if "saved_comparisons" not in tables:
        op.create_table(
            "saved_comparisons",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("client_id", sa.String(length=36), nullable=False),
            sa.Column("fingerprint", sa.String(length=64), nullable=False),
            sa.Column("label", sa.String(length=80), nullable=False),
            # Nullable by design - see the module docstring. A removed player
            # leaves the reference null and the saved label intact.
            sa.Column("player_a_id", sa.Integer(), nullable=True),
            sa.Column("player_b_id", sa.Integer(), nullable=True),
            sa.Column("player_a_label", sa.String(length=160), nullable=False),
            sa.Column("player_b_label", sa.String(length=160), nullable=False),
            # NULL is Automatic Role, canonically. No sentinel string.
            sa.Column("role_key", sa.String(length=64), nullable=True),
            _timestamp("created_at"),
            _timestamp("updated_at"),
            sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["player_a_id"], ["players.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["player_b_id"], ["players.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "fingerprint", name="uq_saved_comparison_fingerprint"),
            sa.UniqueConstraint("user_id", "client_id", name="uq_saved_comparison_client_id"),
        )
        op.create_index("ix_saved_comparisons_user_id", "saved_comparisons", ["user_id"])
        op.create_index("ix_saved_comparisons_player_a_id", "saved_comparisons", ["player_a_id"])
        op.create_index("ix_saved_comparisons_player_b_id", "saved_comparisons", ["player_b_id"])
        op.create_index(
            "ix_saved_comparisons_user_order",
            "saved_comparisons",
            ["user_id", "created_at", "id"],
        )


def downgrade() -> None:
    """Removes ONLY the 8.4B structures.

    `app_users` and `user_favorites` belong to 0007 and are left exactly as they
    are, so downgrading this revision returns a deployment to working 8.4A
    optional accounts rather than to no accounts at all.
    """
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "saved_comparisons" in tables:
        op.drop_table("saved_comparisons")
    if "saved_discovery_views" in tables:
        op.drop_table("saved_discovery_views")
