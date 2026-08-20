"""My Favorites, for an authenticated account.

Every function here takes an `AppUser` that a caller obtained from the verified
token dependency. None of them accept a user id, owner id or Clerk subject as
data, so there is no argument a request could supply that would let one account
read or mutate another's list.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.orm import AppUser, Player, UserFavorite


def canonical_ids(db: Session, user: AppUser) -> list[int]:
    """This account's favourites in canonical order.

    `(created_at, id)` rather than `created_at` alone. A merge writes several
    rows in one transaction and they can share a timestamp to the resolution the
    column stores, so without the primary key as a final term the order of a
    just-merged block would be whatever the storage engine returned that day.
    """
    statement = (
        select(UserFavorite.player_id)
        .where(UserFavorite.user_id == user.id)
        .order_by(UserFavorite.created_at.asc(), UserFavorite.id.asc())
    )
    return list(db.scalars(statement))


def existing_player_ids(db: Session, player_ids: list[int]) -> set[int]:
    """Which of these IDs are real players, in one query.

    One `IN` lookup rather than a `db.get` per id: a 500-id merge would otherwise
    be 500 round trips, and the N+1 would be invisible on the sample fixture and
    obvious in production.
    """
    if not player_ids:
        return set()
    return set(db.scalars(select(Player.id).where(Player.id.in_(player_ids))))


def add_favorite(db: Session, user: AppUser, player_id: int) -> bool:
    """Idempotently save one player. Returns whether the list actually changed.

    A second PUT for the same player is a success that changed nothing, so a
    client retrying an interrupted request never has to ask whether the first
    attempt landed. The `IntegrityError` branch covers two requests racing on the
    same player: the unique constraint decides, not application logic.
    """
    already = db.scalars(
        select(UserFavorite.id).where(
            UserFavorite.user_id == user.id, UserFavorite.player_id == player_id
        )
    ).first()
    if already is not None:
        return False

    db.add(UserFavorite(user_id=user.id, player_id=player_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return False
    return True


def remove_favorite(db: Session, user: AppUser, player_id: int) -> bool:
    """Idempotently unsave one player. Returns whether a row was removed.

    Scoped by `user_id` in the DELETE itself, so the statement cannot touch
    another account's row even if a player id were somehow shared.
    """
    result = db.execute(
        delete(UserFavorite).where(
            UserFavorite.user_id == user.id, UserFavorite.player_id == player_id
        )
    )
    db.commit()
    return bool(result.rowcount)


def _ordered_unique(player_ids: list[int]) -> list[int]:
    """Collapses duplicates to their FIRST occurrence, preserving guest order.

    First rather than last: the earliest position is the one the guest actually
    saw their list in, and keeping it makes the normalization stable — merging
    the same list twice produces the same order both times.
    """
    seen: set[int] = set()
    out: list[int] = []
    for player_id in player_ids:
        if player_id not in seen:
            seen.add(player_id)
            out.append(player_id)
    return out


#: How many times a merge will re-read canonical state and retry the remainder.
#:
#: Each attempt inserts only what is genuinely still missing, so a uniqueness
#: conflict means somebody else inserted that exact row - which makes it present,
#: which makes the next attempt's remainder strictly smaller. The sequence
#: therefore terminates on its own; this bound exists so a pathological
#: environment cannot spin forever, not because convergence needs it.
MERGE_MAX_ATTEMPTS = 4


class FavoritesMergeConflict(Exception):
    """A merge could not be completed within `MERGE_MAX_ATTEMPTS`.

    Raised instead of returning a plausible-looking response that silently omits
    valid players. The client still holds its guest list (it does not clear it
    until a merge succeeds), so a retry is safe and loses nothing.
    """

    def __init__(self, missing: list):
        self.missing = list(missing)
        super().__init__(
            f"{len(self.missing)} requested player(s) could not be merged after "
            f"{MERGE_MAX_ATTEMPTS} attempts"
        )


def _is_unique_violation(error: IntegrityError) -> bool:
    """Whether this IntegrityError is the uniqueness race a merge expects.

    Anything else - a NOT NULL breach, a foreign key breach, a corrupted row - is
    a real fault and must propagate. Swallowing every `IntegrityError` as "somebody
    beat me to it" would turn genuine data-integrity bugs into silently short
    lists, which is precisely the failure this function exists to prevent.

    PostgreSQL is identified by SQLSTATE 23505 (`unique_violation`). SQLite has no
    error codes, so its message is matched instead, narrowed to this table's own
    constraint.
    """
    original = getattr(error, "orig", None)
    sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    if sqlstate == "23505":
        return True
    text = str(original if original is not None else error).lower()
    if "unique" not in text:
        return False
    return "user_favorites" in text or "uq_user_favorite" in text


@dataclass(frozen=True)
class MergeOutcome:
    """What a merge did with each distinct ID the guest offered.

    `added`, `already_present` and `unknown` are disjoint, and their union is
    every distinct requested ID - no exceptions, including after a concurrency
    race. A caller can therefore account for every player it offered without
    inferring anything from a length comparison.
    """

    player_ids: list[int]
    added: list[int]
    already_present: list[int]
    unknown: list[int]


def merge_favorites(db: Session, user: AppUser, guest_ids: list[int]) -> MergeOutcome:
    """Unions a guest list into an account, server order first.

    The contract, in order:

    1. Whatever the account already holds keeps its established position. A scout
       who has curated a list on one device does not have it reshuffled by
       signing in on another.
    2. Guest IDs the account already holds are reported as `already_present` and
       are NOT re-inserted, so a merge cannot duplicate or reorder them.
    3. Genuinely new guest IDs are appended in the guest's own order, after
       everything the account already had.
    4. IDs that resolve to no player are reported as `unknown` and never
       written, so a stale browser entry cannot create a dangling reference.

    Each attempt is one transaction: the block of missing rows lands, or none of
    it does. What makes the whole call safe under concurrency is that a rolled
    back attempt is not the end of the story. The previous implementation rolled
    the batch back and returned, which meant a concurrent insert of ONE requested
    player silently dropped every other valid player in the same batch - they were
    neither persisted nor reported in any disposition list. Now the loop re-reads
    canonical state, recomputes what is still genuinely missing, and finishes the
    job.

    Idempotent by construction: a second identical call finds everything present,
    inserts nothing, and reports the same canonical list with every ID in
    `already_present`.
    """
    requested = _ordered_unique(guest_ids)
    valid = existing_player_ids(db, requested)
    unknown = [player_id for player_id in requested if player_id not in valid]
    wanted = [player_id for player_id in requested if player_id in valid]

    # Captured once, before any insert, so "added" means "was not on this account
    # when the merge began, and is on it now".
    before = set(canonical_ids(db, user))

    for _attempt in range(MERGE_MAX_ATTEMPTS):
        present = set(canonical_ids(db, user))
        missing = [player_id for player_id in wanted if player_id not in present]
        if not missing:
            break
        try:
            for player_id in missing:
                db.add(UserFavorite(user_id=user.id, player_id=player_id))
            db.commit()
            break
        except IntegrityError as error:
            db.rollback()
            if not _is_unique_violation(error):
                raise

    final = canonical_ids(db, user)
    final_set = set(final)

    # Exhaustiveness is asserted against reality, not assumed from bookkeeping.
    unresolved = [player_id for player_id in wanted if player_id not in final_set]
    if unresolved:
        raise FavoritesMergeConflict(unresolved)

    return MergeOutcome(
        player_ids=final,
        added=[player_id for player_id in wanted if player_id not in before],
        already_present=[player_id for player_id in wanted if player_id in before],
        unknown=unknown,
    )
