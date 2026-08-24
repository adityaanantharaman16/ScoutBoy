"""Explicitly saved work (Milestone 8.4B).

Two collections, both owned by an `AppUser` and both extending the optional-account
architecture 8.4A established: a saved **Discovery view** (the filter/sort setup
that reproduces a cohort) and a saved **comparison setup** (two players and a
chosen role).

What is deliberately NOT here
-----------------------------
No analytical result is stored. A saved comparison holds participants and a role,
never a score, conclusion, confidence value or evidence summary - reopening it
fetches current ScoutBoy analysis. Storing an old number would let the product
present a stale figure as though it were still true, which is the one thing a
scouting tool must not do.

No URL is stored either. A saved view is a set of TYPED, individually constrained
columns, so "an arbitrary opaque redirect target got persisted" is not a bug this
schema can have - there is nowhere to put one. Every column below is either a
bounded enumerated key, a bounded plain-text predicate, or a bounded number.

Guests are unaffected: nothing in this module is read or written for an anonymous
visitor, whose saved work lives in versioned browser storage.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .accounts import AppUser
from .base import Base, TimestampMixin, utcnow

#: A user-authored label, in characters. Long enough for "U21 Bundesliga wingers
#: under EUR 8M", short enough that no list row can be pushed off screen by one.
LABEL_MAX = 80

#: A free-text Discovery predicate (search needle, league, club, nationality).
TEXT_FILTER_MAX = 120

#: An enumerated key: a role key, a playstyle key, a sort key, a position group.
KEY_MAX = 64

#: A client-generated UUID string, in canonical hyphenated form.
CLIENT_ID_MAX = 36

#: A SHA-256 hex digest. Fixed width, so the unique index it backs is portable and
#: comfortably inside PostgreSQL's btree key-size limit - which a raw canonical
#: query string, inflated by percent-encoding of non-ASCII club names, would not
#: reliably be.
FINGERPRINT_MAX = 64

#: The saved display name of a comparison participant, kept so a deleted player
#: can be named honestly rather than silently forgotten. Sized for the longest
#: canonical names the pipeline stores.
PLAYER_LABEL_MAX = 160


class SavedDiscoveryView(Base, TimestampMixin):
    """One saved Discovery setup on one account.

    Identity, and why there are two unique constraints
    --------------------------------------------------
    - `uq_saved_view_fingerprint` is the LOGICAL identity: a SHA-256 digest of the
      canonical serialization of the columns below, computed server-side from the
      values that were actually validated and stored. Two views that canonicalize
      to the same representable filter/sort state are the same view, so saving the
      same configuration twice updates the existing row instead of quietly growing
      a duplicate. Computing it server-side is what stops a client splitting one
      logical view into two by sending a different digest.
    - `uq_saved_view_client_id` is the RETRY identity. The client mints a UUID
      before it sends anything, so a create whose response was lost can be retried
      without risking a second row. It is scoped to the owner, so one account's id
      can never address another's row.

    Ordering is `(created_at, id)`, never `created_at` alone, for exactly the
    reason `user_favorites` documents: a merge inserts several rows inside one
    transaction and the timestamp default can hand them all the same value, so the
    autoincrement key is carried as the final term to make the canonical order
    reproducible on SQLite and PostgreSQL alike.

    Every filter column is nullable, and NULL means "this criterion is not part of
    the view" - which is the same thing omitting the parameter from the URL means.
    There is no sentinel value and no empty string standing in for absence.
    """

    __tablename__ = "saved_discovery_views"
    __table_args__ = (
        UniqueConstraint("user_id", "fingerprint", name="uq_saved_view_fingerprint"),
        UniqueConstraint("user_id", "client_id", name="uq_saved_view_client_id"),
        Index("ix_saved_views_user_order", "user_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str] = mapped_column(String(CLIENT_ID_MAX))
    fingerprint: Mapped[str] = mapped_column(String(FINGERPRINT_MAX))
    #: User-authored plain text. Rendered as text, never as markup, and never
    #: interpreted as a URL.
    label: Mapped[str] = mapped_column(String(LABEL_MAX))

    # -- The representable Discovery state ----------------------------------
    #
    # One column per parameter the rail can actually express. Deliberately NOT a
    # JSON blob: a typed column is what makes "schema-validated against the same
    # allowlist the UI can represent" a property of the storage rather than a
    # promise made in the service layer above it.
    #
    # `scope` is absent on purpose. Analysis Scope was retired from Discovery in
    # Phase 8.1A; persisting it here would put the retired control back by the side
    # door. `page` is absent too - opening a saved view always starts on page 1.
    q: Mapped[Optional[str]] = mapped_column(String(TEXT_FILTER_MAX), nullable=True)
    position_group: Mapped[Optional[str]] = mapped_column(String(KEY_MAX), nullable=True)
    role: Mapped[Optional[str]] = mapped_column(String(KEY_MAX), nullable=True)
    league: Mapped[Optional[str]] = mapped_column(String(TEXT_FILTER_MAX), nullable=True)
    club: Mapped[Optional[str]] = mapped_column(String(TEXT_FILTER_MAX), nullable=True)
    nationality: Mapped[Optional[str]] = mapped_column(String(TEXT_FILTER_MAX), nullable=True)
    playstyle: Mapped[Optional[str]] = mapped_column(String(KEY_MAX), nullable=True)
    age_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    age_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    min_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rolefit_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rolefit_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    #: Absolute EUR, matching the API contract. `BigInteger` because a hand-crafted
    #: bound can exceed a 32-bit integer long before the schema's own ceiling
    #: rejects it, and an overflow at the storage layer is a worse failure than a
    #: 422.
    value_min: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    value_max: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    #: NULL means the default ordering, exactly as omitting `sort` from the URL does.
    sort: Mapped[Optional[str]] = mapped_column(String(KEY_MAX), nullable=True)
    #: NULL means the default page size.
    page_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    user: Mapped[AppUser] = relationship(back_populates="saved_views")


class SavedComparison(Base, TimestampMixin):
    """One saved comparison setup on one account: two players and a chosen role.

    A SETUP, not a result. There is no score, conclusion, confidence or evidence
    column here and there never should be: reopening a saved comparison runs
    current ScoutBoy analysis, so the product cannot present a stale figure as
    though it were still current.

    Side order is part of the identity
    ----------------------------------
    `player_a` and `player_b` are meaningful screen positions, so `(7, 5)` is a
    different saved setup from `(5, 7)` and the fingerprint reflects that. The
    selected role is part of it too; Automatic Role is represented canonically by
    NULL rather than by a magic string.

    Integrity when a player goes away
    ---------------------------------
    The foreign keys are `ON DELETE SET NULL` rather than `CASCADE`, and each side
    additionally stores the display name the player had when the setup was saved.
    Cascading would silently delete a scout's saved work as a side effect of a data
    refresh; leaving a dangling id would let the interface fabricate a player that
    no longer exists. Nulling the reference while keeping the label lets the row
    stay visible, renameable and removable, and lets the interface say exactly
    which side is unavailable without pretending it is still there.
    """

    __tablename__ = "saved_comparisons"
    __table_args__ = (
        UniqueConstraint("user_id", "fingerprint", name="uq_saved_comparison_fingerprint"),
        UniqueConstraint("user_id", "client_id", name="uq_saved_comparison_client_id"),
        Index("ix_saved_comparisons_user_order", "user_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str] = mapped_column(String(CLIENT_ID_MAX))
    #: SHA-256 of the ordered `(player_a, player_b, role)` triple.
    fingerprint: Mapped[str] = mapped_column(String(FINGERPRINT_MAX))
    label: Mapped[str] = mapped_column(String(LABEL_MAX))

    player_a_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True
    )
    player_b_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True
    )
    #: The names as they were at save time. Display metadata only: never used to
    #: resolve a player, and never rendered as though the player were still
    #: available.
    player_a_label: Mapped[str] = mapped_column(String(PLAYER_LABEL_MAX))
    player_b_label: Mapped[str] = mapped_column(String(PLAYER_LABEL_MAX))
    #: NULL is Automatic Role, canonically. There is no "auto" sentinel string.
    role_key: Mapped[Optional[str]] = mapped_column(String(KEY_MAX), nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    user: Mapped[AppUser] = relationship(back_populates="saved_comparisons")
