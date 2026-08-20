"""Optional-account durable state (Milestone 8.4A).

Two tables, and deliberately only two. ScoutBoy stores the *minimum* it needs to
attach a favourites list to a verified identity: an opaque external subject and
the issuer that vouched for it. Email address, display name, avatar, password
material and provider access tokens are Clerk's responsibility and are never
copied here, so a ScoutBoy database compromise cannot leak them.

Anonymous use is unaffected: nothing in this module is read or written for a
guest, whose favourites remain in `scoutboy.shortlist.v1` browser storage.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, utcnow


class AppUser(Base, TimestampMixin):
    """A ScoutBoy account, keyed to one verified external identity.

    `external_subject` is Clerk's `sub` claim, taken exclusively from a token
    whose signature, expiry, issuer and authorized party have already been
    verified. `auth_issuer` is stored alongside it because a subject is only
    unique *within* an issuing tenant: two Clerk instances (say staging and
    production, or a future second provider) can legitimately mint the same
    `user_...` string, and joining them onto one favourites list would be a
    cross-tenant data leak. The unique constraint therefore spans both.

    Rows are created lazily on first authenticated request, never ahead of time,
    so signing in to browse without saving anything writes nothing.
    """

    __tablename__ = "app_users"
    __table_args__ = (
        UniqueConstraint("auth_issuer", "external_subject", name="uq_app_user_identity"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Which managed identity product vouched for this subject. One value today
    # ("clerk"); recorded so a future provider is a data question, not a schema
    # migration.
    auth_provider: Mapped[str] = mapped_column(String(50), default="clerk", server_default="clerk")
    # The verified `iss` claim, e.g. https://your-app-42.clerk.accounts.dev.
    auth_issuer: Mapped[str] = mapped_column(String(255), index=True)
    # The verified `sub` claim. Opaque to ScoutBoy by design.
    external_subject: Mapped[str] = mapped_column(String(255), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    favorites: Mapped[list[UserFavorite]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserFavorite(Base, TimestampMixin):
    """One saved player on one account's My Favorites list.

    Ordering is `(created_at, id)`, never `created_at` alone: a merge inserts
    several rows inside one transaction and a timestamp default can hand them all
    the same value, at which point the returned order would depend on whatever the
    storage engine felt like doing. The autoincrement primary key is a total order
    by construction, so appending it as the final key makes the canonical list
    reproducible on SQLite and PostgreSQL alike.

    The unique constraint is what makes `PUT` idempotent, and the composite index
    serves the single query every endpoint here ends with: this user's rows, in
    canonical order.
    """

    __tablename__ = "user_favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "player_id", name="uq_user_favorite"),
        Index("ix_user_favorites_user_order", "user_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), index=True)
    # Deleting a player removes it from every list rather than leaving an id that
    # resolves to nothing.
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)

    user: Mapped[AppUser] = relationship(back_populates="favorites")
