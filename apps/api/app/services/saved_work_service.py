"""Saved Discovery views and saved comparison setups, for an authenticated account.

Every function here takes an `AppUser` that a caller obtained from the verified
token dependency. None of them accept a user id, owner id or external subject as
data, so there is no argument a request could supply that would let one account
read or mutate another's saved work. That is the same structural rule
`favorites_service` follows, and a test asserts the signatures.

Shared primitives, not a shared framework
-----------------------------------------
Saved views and saved comparisons are two collections with identical
synchronization semantics, so the parts that were genuinely worth having once -
canonical ordering, idempotent upsert, idempotent removal, and the convergent
merge with its uniqueness-race retry - live here once and are parameterized by
model. `favorites_service` is deliberately NOT rewritten to use them: it is
correct, heavily covered, and refactoring a working synchronization state machine
to serve an abstraction is how a regression gets introduced into the one
collection that already works.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from rolefit import PlaystyleConfig, load_role_configs
from scoutboy_shared import DISCOVERABLE_POSITION_GROUPS
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import VerifiedIdentity, find_app_user
from app.models.orm import AppUser, Player, SavedComparison, SavedDiscoveryView
from app.models.schemas.saved_work import (
    MAX_COLLECTION_ITEMS,
    DiscoveryViewFilters,
    MergeRejection,
    SavedComparisonInput,
    SavedComparisonRecord,
    SavedComparisonSide,
    SavedViewInput,
    SavedViewRecord,
)
from app.services.players_service import SEARCH_SORTS

#: How many times a merge re-reads canonical state and retries the remainder.
#:
#: Identical reasoning to the favourites merge: each attempt inserts only what is
#: genuinely still missing, so a uniqueness conflict means somebody else inserted
#: that exact row - which makes the next attempt's remainder strictly smaller. The
#: sequence terminates on its own; this bound stops a pathological environment
#: spinning, it is not the mechanism.
MERGE_MAX_ATTEMPTS = 4


class SavedWorkMergeConflict(Exception):
    """A merge could not be completed within `MERGE_MAX_ATTEMPTS`.

    Raised instead of returning a plausible-looking response that silently omits
    valid items. The client still holds its device collection - it does not clear
    it until a merge succeeds - so a retry is safe and loses nothing.
    """

    def __init__(self, missing: list):
        self.missing = list(missing)
        super().__init__(
            f"{len(self.missing)} saved item(s) could not be merged after "
            f"{MERGE_MAX_ATTEMPTS} attempts"
        )


class CollectionFullError(Exception):
    """The account already holds the maximum number of items of this type."""

    def __init__(self, limit: int = MAX_COLLECTION_ITEMS):
        self.limit = limit
        super().__init__(f"an account may hold at most {limit} saved items of this type")


class SavedItemNotFound(Exception):
    """The addressed item does not exist on THIS account.

    Deliberately indistinguishable from "does not exist at all": an id that
    belongs to another account must not be reported differently from one that
    belongs to nobody, or the 404 itself becomes an existence oracle.
    """


# ---------------------------------------------------------------------------
# Canonical identity
# ---------------------------------------------------------------------------


def find_owner(db: Session, identity: VerifiedIdentity) -> Optional[AppUser]:
    """The account row for a verified identity, or None. READ ONLY.

    Re-exported through this module so a merge route reads as one import, and so
    the "look, then materialize only if we are going to store something" pair sits
    together where the rule it protects is documented.
    """
    return find_app_user(db, identity)


def _digest(payload: dict) -> str:
    """A stable SHA-256 of a canonical JSON rendering.

    Sorted keys and no insignificant whitespace, so the digest depends on the
    VALUES and not on dictionary ordering or Python version. `ensure_ascii=False`
    keeps non-ASCII characters as themselves; combined with the NFC normalization
    the schema applies to identity-bearing text, one club name has exactly one
    digest.

    This is a storage identity, not a security control: it makes the unique index
    fixed-width and portable. Nothing is authenticated by it.
    """
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


#: The Discovery parameters a saved view is made of, in one place, so the digest,
#: the column copy and the response projection cannot fall out of step.
VIEW_FILTER_FIELDS = (
    "q",
    "position_group",
    "role",
    "league",
    "club",
    "nationality",
    "playstyle",
    "age_min",
    "age_max",
    "min_minutes",
    "rolefit_min",
    "rolefit_max",
    "value_min",
    "value_max",
    "sort",
    "page_size",
)


def view_fingerprint(filters: DiscoveryViewFilters) -> str:
    """The canonical identity of a filter/sort state.

    Only fields that are actually SET take part, so "no age bound" and "age bound
    absent" cannot produce two digests for one cohort - which is what makes saving
    the same configuration twice update the existing view rather than growing a
    duplicate.
    """
    present = {
        field: getattr(filters, field)
        for field in VIEW_FILTER_FIELDS
        if getattr(filters, field) is not None
    }
    return _digest(present)


def comparison_fingerprint(player_a_id: int, player_b_id: int, role_key: Optional[str]) -> str:
    """The canonical identity of an ordered pair plus a role.

    Side order is PRESERVED: Player 1 and Player 2 are meaningful screen
    positions, so `(7, 5)` and `(5, 7)` are different saved setups and are given
    different digests. The role is part of the identity, and Automatic Role is
    represented by omission rather than by a sentinel string.
    """
    payload: dict = {"a": player_a_id, "b": player_b_id}
    if role_key is not None:
        payload["role"] = role_key
    return _digest(payload)


# ---------------------------------------------------------------------------
# Allowlist validation against the live configuration
# ---------------------------------------------------------------------------


def _known_role_keys() -> set:
    return set(load_role_configs().keys())


def _known_playstyle_keys() -> set:
    """Positive playstyle keys, from the same config the engine badges players with.

    `configs/playstyles/playstyles_v1.yaml` is what `GET /methodology` serializes
    and therefore what the Discovery Playstyle filter's options are built from, so
    a saved view cannot store a playstyle the rail has no option for. Concerns are
    excluded because `playstyle=<key>` matches a qualifying POSITIVE badge, so
    saving a concern would store a filter that can only ever return nothing.
    """
    return {entry["key"] for entry in PlaystyleConfig.load().positives}


def validate_view_filters(_db: Session, filters: DiscoveryViewFilters) -> Optional[str]:
    """Why this filter state may not be stored, or None when it may.

    Structural validation (bounds, shape, canonical form) already happened in the
    schema. What is left is membership: whether the enumerated keys name things
    that actually exist right now. This is checked HERE rather than declared on
    the route for the same reason `/api/players` checks its own `role` and `sort`
    in the service layer - the answer comes from configuration, not from a
    literal a route could carry.
    """
    if filters.role is not None and filters.role not in _known_role_keys():
        return "unknown role"
    if (
        filters.position_group is not None
        and filters.position_group not in DISCOVERABLE_POSITION_GROUPS
    ):
        return "unknown position group"
    if filters.sort is not None and filters.sort not in SEARCH_SORTS:
        return "unknown sort"
    if filters.playstyle is not None and filters.playstyle not in _known_playstyle_keys():
        return "unknown playstyle"
    return None


def validate_comparison(db: Session, item: SavedComparisonInput) -> Optional[str]:
    """Why this comparison setup may not be stored, or None when it may.

    Both players must EXIST at the moment the setup is first saved. That is a
    deliberate asymmetry with what happens later: a player deleted afterwards
    leaves the saved setup visible with an honest unavailable side, but a setup
    whose players never existed is a stale device artifact, and storing it would
    manufacture the unavailable state rather than record one.
    """
    if item.role_key is not None and item.role_key not in _known_role_keys():
        return "unknown role"
    found = set(
        db.scalars(select(Player.id).where(Player.id.in_([item.player_a_id, item.player_b_id])))
    )
    missing = [pid for pid in (item.player_a_id, item.player_b_id) if pid not in found]
    if missing:
        return "player not found"
    return None


# ---------------------------------------------------------------------------
# Shared collection primitives
# ---------------------------------------------------------------------------


def _canonical_rows(db: Session, model, user: AppUser) -> list:
    """This account's rows in canonical order.

    `(created_at, id)` rather than `created_at` alone. A merge writes several rows
    in one transaction and they can share a timestamp to the resolution the column
    stores, so without the primary key as a final term the order of a just-merged
    block would be whatever the storage engine returned that day.

    Scoped by `user_id` in the WHERE clause itself - not filtered afterwards in
    Python - so the statement is incapable of reading another account's rows.
    """
    statement = (
        select(model)
        .where(model.user_id == user.id)
        .order_by(model.created_at.asc(), model.id.asc())
    )
    return list(db.scalars(statement))


def _find_by_client_id(db: Session, model, user: AppUser, client_id: str):
    return db.scalars(
        select(model).where(model.user_id == user.id, model.client_id == client_id)
    ).first()


def _find_by_fingerprint(db: Session, model, user: AppUser, fingerprint: str):
    return db.scalars(
        select(model).where(model.user_id == user.id, model.fingerprint == fingerprint)
    ).first()


def _is_unique_violation(error: IntegrityError, *constraints: str) -> bool:
    """Whether this IntegrityError is the uniqueness race an upsert expects.

    Anything else - a NOT NULL breach, a foreign-key breach, a corrupted row - is
    a real fault and must propagate. Swallowing every `IntegrityError` as
    "somebody beat me to it" would turn genuine data-integrity bugs into silently
    short collections, which is exactly the failure this check exists to prevent.

    PostgreSQL is identified by SQLSTATE 23505 (`unique_violation`). SQLite has no
    error codes, so its message is matched instead, narrowed to this table's own
    constraints.
    """
    original = getattr(error, "orig", None)
    sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    if sqlstate == "23505":
        return True
    text = str(original if original is not None else error).lower()
    if "unique" not in text:
        return False
    return any(name.lower() in text for name in constraints)


@dataclass(frozen=True)
class UpsertOutcome:
    """One create-or-update, and which of the two it turned out to be."""

    row: Any
    disposition: str


@dataclass(frozen=True)
class MergeOutcome:
    """What a merge did with each distinct device item it was offered.

    `added`, `already_present` and `rejected` are disjoint, and their union is
    every distinct `client_id` requested - so a caller can account for every item
    it offered without inferring anything from a length comparison.
    """

    rows: list
    added: list
    already_present: list
    rejected: list


def _partition(
    items: list,
    reason_for: Callable[[Any], Optional[str]],
    fingerprint_of: Callable[[Any], str],
) -> tuple:
    """Splits offered device items into what may be stored and what may not.

    Two ways an item is refused, and both are REPORTED rather than dropped:

    * it fails allowlist validation - a role, sort, position group or playstyle
      that no longer exists, or a comparison whose players do not;
    * it repeats the canonical identity of an item earlier in the same payload.

    Duplicates collapse to their FIRST occurrence: the earliest position is the
    one the scout actually saw their collection in, which also makes the
    normalization stable under a repeated merge.

    Silently dropping either kind would produce a merge that reports success while
    losing work, which is the exact failure the disposition lists exist to make
    impossible.
    """
    wanted, rejected, seen = [], [], set()
    for item in items:
        reason = reason_for(item)
        if reason is not None:
            rejected.append(MergeRejection(client_id=item.client_id, reason=reason))
            continue
        fingerprint = fingerprint_of(item)
        if fingerprint in seen:
            rejected.append(
                MergeRejection(client_id=item.client_id, reason="duplicate of an earlier item")
            )
            continue
        seen.add(fingerprint)
        wanted.append(item)
    return wanted, rejected


def _merge_rows(
    db: Session,
    model,
    user: AppUser,
    wanted: list,
    fingerprint_of: Callable[[Any], str],
    build: Callable[[Any], Any],
    constraints: tuple,
) -> tuple:
    """Unions validated device items into an account, account order first.

    The contract, in order:

    1. Whatever the account already holds keeps its established position and its
       existing LABEL. A collection curated on one device is neither reshuffled
       nor silently renamed by signing in on another.
    2. Device items the account already holds by canonical identity are reported
       as `already_present` and are not re-inserted.
    3. Genuinely new device items are appended in device order, after everything
       the account already had.

    Each attempt is one transaction: the block of missing rows lands, or none of
    it does. What makes the call safe under concurrency is that a rolled-back
    attempt is not the end of the story - the loop re-reads canonical state,
    recomputes what is genuinely still missing, and finishes the remainder. The
    favourites merge documents why: rolling back and returning meant a concurrent
    insert of ONE item silently dropped every other valid item in the same batch.
    """
    present_before = {row.fingerprint for row in _canonical_rows(db, model, user)}
    added, already_present = [], []
    for item in wanted:
        (already_present if fingerprint_of(item) in present_before else added).append(item)

    # Refused before anything is written, so a merge cannot grow the collection
    # past the ceiling one signed-in device at a time. Refusing the whole merge
    # rather than truncating it keeps the device copy intact and retryable, which
    # is the same reason an oversized body is a 422 rather than a silent trim.
    if len(present_before) + len(added) > MAX_COLLECTION_ITEMS:
        raise CollectionFullError()

    for _attempt in range(MERGE_MAX_ATTEMPTS):
        present = {row.fingerprint for row in _canonical_rows(db, model, user)}
        missing = [item for item in added if fingerprint_of(item) not in present]
        if not missing:
            break
        try:
            for item in missing:
                db.add(build(item))
            db.commit()
            break
        except IntegrityError as error:
            db.rollback()
            if not _is_unique_violation(error, *constraints):
                raise

    rows = _canonical_rows(db, model, user)
    final = {row.fingerprint for row in rows}
    unresolved = [item for item in added if fingerprint_of(item) not in final]
    if unresolved:
        # Deliberately NOT a 200 with a short list: the client clears its device
        # copy on success, so a partial "success" is how saved work gets lost.
        raise SavedWorkMergeConflict([item.client_id for item in unresolved])

    return rows, [item.client_id for item in added], [item.client_id for item in already_present]


def _remove(db: Session, model, user: AppUser, client_id: str) -> bool:
    """Idempotently remove one item. Returns whether a row was actually removed.

    Scoped by `user_id` in the DELETE itself, so the statement cannot touch
    another account's row even if a client id were somehow shared. Deliberately
    does not 404: the caller's goal is "this item is not on my list", and for an
    id that is not there that is already true, so a retried delete behaves exactly
    like the first attempt.
    """
    result = db.execute(delete(model).where(model.user_id == user.id, model.client_id == client_id))
    db.commit()
    return bool(result.rowcount)


def _rename(db: Session, model, user: AppUser, client_id: str, label: str) -> Any:
    """Rename one item. Raises `SavedItemNotFound` when this account has no such id."""
    row = _find_by_client_id(db, model, user, client_id)
    if row is None:
        raise SavedItemNotFound()
    if row.label != label:
        row.label = label
        db.commit()
        db.refresh(row)
    return row


def _assert_room(db: Session, model, user: AppUser) -> None:
    count = len(_canonical_rows(db, model, user))
    if count >= MAX_COLLECTION_ITEMS:
        raise CollectionFullError()


# ---------------------------------------------------------------------------
# Projections
# ---------------------------------------------------------------------------


def _iso(value: Optional[datetime]) -> str:
    """A UTC ISO-8601 timestamp.

    SQLite hands back a naive datetime where PostgreSQL hands back an aware one,
    so the naive case is read as UTC (which is what `utcnow` wrote) rather than as
    local time. Without this the same row would report two different instants
    depending on which engine served it.
    """
    if value is None:  # pragma: no cover - the column is NOT NULL
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def view_record(row: SavedDiscoveryView) -> SavedViewRecord:
    return SavedViewRecord(
        client_id=row.client_id,
        label=row.label,
        filters=DiscoveryViewFilters(
            **{field: getattr(row, field) for field in VIEW_FILTER_FIELDS}
        ),
        fingerprint=row.fingerprint,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def _resolvable_player_ids(db: Session, rows: list) -> set:
    """Which participants of these saved setups are still real players, in one query.

    One `IN` lookup for the whole page rather than a `db.get` per side: a list of
    fifty setups would otherwise be a hundred round trips, and the N+1 would be
    invisible on the sample fixture and obvious in production.
    """
    wanted = {pid for row in rows for pid in (row.player_a_id, row.player_b_id) if pid is not None}
    if not wanted:
        return set()
    return set(db.scalars(select(Player.id).where(Player.id.in_(wanted))))


def _side(player_id: Optional[int], label: str, resolvable: set) -> SavedComparisonSide:
    available = player_id is not None and player_id in resolvable
    return SavedComparisonSide(
        # An unavailable side reports NO id, whatever the column still holds, so a
        # client cannot be handed a reference it would then try to open.
        player_id=player_id if available else None,
        label=label,
        available=available,
    )


def comparison_record(
    row: SavedComparison, resolvable: Optional[set] = None
) -> SavedComparisonRecord:
    """Projects a saved setup, reporting an unavailable side honestly.

    Availability is decided by whether the player RESOLVES RIGHT NOW, not by
    whether the foreign key column happens to be null. That distinction is not
    academic: `ON DELETE SET NULL` is the PostgreSQL-side integrity guarantee, but
    SQLite does not enforce foreign keys under this project's configuration (the
    same limitation `favorites_service` compensates for by validating player
    existence explicitly on every write). Reading the column alone would therefore
    report a deleted player as still available on SQLite and unavailable on
    PostgreSQL - one saved setup, two answers, depending on the engine.

    An unavailable side keeps the name it was saved under and loses its id, so the
    interface can say which side is gone without fabricating a player that no
    longer exists, and without silently deleting the scout's saved work.

    `resolvable` is passed in by the list path so the lookup happens once for the
    whole page; a caller projecting a single row may omit it.
    """
    if resolvable is None:
        resolvable = {pid for pid in (row.player_a_id, row.player_b_id) if pid is not None}
    return SavedComparisonRecord(
        client_id=row.client_id,
        label=row.label,
        player_a=_side(row.player_a_id, row.player_a_label, resolvable),
        player_b=_side(row.player_b_id, row.player_b_label, resolvable),
        role_key=row.role_key,
        fingerprint=row.fingerprint,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def comparison_records(db: Session, rows: list) -> list:
    """Projects a whole page of saved setups with ONE availability lookup."""
    resolvable = _resolvable_player_ids(db, rows)
    return [comparison_record(row, resolvable) for row in rows]


# ---------------------------------------------------------------------------
# Saved Discovery views
# ---------------------------------------------------------------------------

_VIEW_CONSTRAINTS = (
    "uq_saved_view_fingerprint",
    "uq_saved_view_client_id",
    "saved_discovery_views",
)


def list_views(db: Session, user: Optional[AppUser]) -> list:
    """This account's canonical saved views. Performs no write."""
    return [] if user is None else _canonical_rows(db, SavedDiscoveryView, user)


def _apply_view_filters(row: SavedDiscoveryView, filters: DiscoveryViewFilters) -> None:
    for field in VIEW_FILTER_FIELDS:
        setattr(row, field, getattr(filters, field))
    row.fingerprint = view_fingerprint(filters)


def upsert_view(db: Session, user: AppUser, item: SavedViewInput) -> UpsertOutcome:
    """Stores one saved view, idempotently, on two independent identities.

    Resolution order, and why:

    1. **By canonical fingerprint.** Two views that canonicalize to the same
       filter/sort state ARE the same view, so saving the same configuration again
       updates the existing one - taking the label the scout just typed, because
       naming it is what they asked for - rather than growing a silent duplicate.
    2. **By client id.** The client mints a UUID before it sends anything, so a
       create whose response was lost is retried onto the same row instead of
       producing a second one. This is also the path that lets a saved view's
       filters be replaced in place.
    3. **Insert.** A uniqueness race here means a concurrent request won; the
       loser re-reads the winner's row rather than surfacing a 500, which is what
       makes two simultaneous identical saves converge on one item.
    """
    fingerprint = view_fingerprint(item.filters)

    existing = _find_by_fingerprint(db, SavedDiscoveryView, user, fingerprint)
    if existing is not None:
        # The account's own `client_id` is KEPT, not replaced by the caller's. The
        # row already has a stable identity that other devices address it by, and
        # the client adopts the canonical list this response carries - so a device
        # that offered its own id simply starts using the account's. Rewriting the
        # id here would instead break every other device's reference to the row.
        changed = existing.label != item.label
        if changed:
            existing.label = item.label
            db.commit()
            db.refresh(existing)
        return UpsertOutcome(existing, "updated" if changed else "unchanged")

    by_client = _find_by_client_id(db, SavedDiscoveryView, user, item.client_id)
    if by_client is not None:
        by_client.label = item.label
        _apply_view_filters(by_client, item.filters)
        db.commit()
        db.refresh(by_client)
        return UpsertOutcome(by_client, "updated")

    _assert_room(db, SavedDiscoveryView, user)
    row = SavedDiscoveryView(user_id=user.id, client_id=item.client_id, label=item.label)
    _apply_view_filters(row, item.filters)
    db.add(row)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if not _is_unique_violation(error, *_VIEW_CONSTRAINTS):
            raise
        winner = _find_by_fingerprint(
            db, SavedDiscoveryView, user, fingerprint
        ) or _find_by_client_id(db, SavedDiscoveryView, user, item.client_id)
        if winner is None:  # pragma: no cover - only if the winner vanished mid-race
            raise
        return UpsertOutcome(winner, "updated")
    db.refresh(row)
    return UpsertOutcome(row, "created")


def rename_view(db: Session, user: AppUser, client_id: str, label: str) -> SavedDiscoveryView:
    return _rename(db, SavedDiscoveryView, user, client_id, label)


def remove_view(db: Session, user: AppUser, client_id: str) -> bool:
    return _remove(db, SavedDiscoveryView, user, client_id)


def merge_views(
    db: Session,
    user: Optional[AppUser],
    items: list,
    materialize: Callable[[], AppUser],
) -> MergeOutcome:
    """Unions a guest's device saved views into the account.

    `user` may be None - a verified identity that has never saved anything has no
    row yet - and `materialize` is called only if this merge is actually going to
    store something. That is what keeps "an empty merge creates no account row"
    true, including the case where every offered item turns out to be invalid.
    """
    wanted, rejected = _partition(
        items,
        lambda item: validate_view_filters(db, item.filters),
        lambda item: view_fingerprint(item.filters),
    )
    if user is None:
        if not wanted:
            return MergeOutcome([], [], [], rejected)
        user = materialize()

    owner = user
    rows, added, already = _merge_rows(
        db,
        SavedDiscoveryView,
        owner,
        wanted,
        lambda item: view_fingerprint(item.filters),
        lambda item: _built_view(owner, item),
        _VIEW_CONSTRAINTS,
    )
    return MergeOutcome(rows, added, already, rejected)


def _built_view(user: AppUser, item: SavedViewInput) -> SavedDiscoveryView:
    row = SavedDiscoveryView(user_id=user.id, client_id=item.client_id, label=item.label)
    _apply_view_filters(row, item.filters)
    return row


# ---------------------------------------------------------------------------
# Saved comparison setups
# ---------------------------------------------------------------------------

_COMPARISON_CONSTRAINTS = (
    "uq_saved_comparison_fingerprint",
    "uq_saved_comparison_client_id",
    "saved_comparisons",
)


def list_comparisons(db: Session, user: Optional[AppUser]) -> list:
    """This account's canonical saved comparison setups. Performs no write."""
    return [] if user is None else _canonical_rows(db, SavedComparison, user)


def _built_comparison(user: AppUser, item: SavedComparisonInput) -> SavedComparison:
    return SavedComparison(
        user_id=user.id,
        client_id=item.client_id,
        label=item.label,
        fingerprint=comparison_fingerprint(item.player_a_id, item.player_b_id, item.role_key),
        player_a_id=item.player_a_id,
        player_b_id=item.player_b_id,
        player_a_label=item.player_a_label,
        player_b_label=item.player_b_label,
        role_key=item.role_key,
    )


def upsert_comparison(db: Session, user: AppUser, item: SavedComparisonInput) -> UpsertOutcome:
    """Stores one saved comparison setup, idempotently. See `upsert_view`."""
    fingerprint = comparison_fingerprint(item.player_a_id, item.player_b_id, item.role_key)

    existing = _find_by_fingerprint(db, SavedComparison, user, fingerprint)
    if existing is not None:
        # See `upsert_view`: the account's own `client_id` is kept.
        changed = existing.label != item.label
        if changed:
            existing.label = item.label
            db.commit()
            db.refresh(existing)
        return UpsertOutcome(existing, "updated" if changed else "unchanged")

    by_client = _find_by_client_id(db, SavedComparison, user, item.client_id)
    if by_client is not None:
        by_client.label = item.label
        by_client.fingerprint = fingerprint
        by_client.player_a_id = item.player_a_id
        by_client.player_b_id = item.player_b_id
        by_client.player_a_label = item.player_a_label
        by_client.player_b_label = item.player_b_label
        by_client.role_key = item.role_key
        db.commit()
        db.refresh(by_client)
        return UpsertOutcome(by_client, "updated")

    _assert_room(db, SavedComparison, user)
    row = _built_comparison(user, item)
    db.add(row)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if not _is_unique_violation(error, *_COMPARISON_CONSTRAINTS):
            raise
        winner = _find_by_fingerprint(db, SavedComparison, user, fingerprint) or _find_by_client_id(
            db, SavedComparison, user, item.client_id
        )
        if winner is None:  # pragma: no cover - only if the winner vanished mid-race
            raise
        return UpsertOutcome(winner, "updated")
    db.refresh(row)
    return UpsertOutcome(row, "created")


def rename_comparison(db: Session, user: AppUser, client_id: str, label: str) -> SavedComparison:
    return _rename(db, SavedComparison, user, client_id, label)


def remove_comparison(db: Session, user: AppUser, client_id: str) -> bool:
    return _remove(db, SavedComparison, user, client_id)


def merge_comparisons(
    db: Session,
    user: Optional[AppUser],
    items: list,
    materialize: Callable[[], AppUser],
) -> MergeOutcome:
    """Unions a guest's device comparison setups into the account. See `merge_views`."""
    wanted, rejected = _partition(
        items,
        lambda item: validate_comparison(db, item),
        lambda item: comparison_fingerprint(item.player_a_id, item.player_b_id, item.role_key),
    )
    if user is None:
        if not wanted:
            return MergeOutcome([], [], [], rejected)
        user = materialize()

    owner = user
    rows, added, already = _merge_rows(
        db,
        SavedComparison,
        owner,
        wanted,
        lambda item: comparison_fingerprint(item.player_a_id, item.player_b_id, item.role_key),
        lambda item: _built_comparison(owner, item),
        _COMPARISON_CONSTRAINTS,
    )
    return MergeOutcome(rows, added, already, rejected)


#: Anything a route needs, so a private endpoint reads as one import.
__all__ = [
    "CollectionFullError",
    "find_owner",
    "MergeOutcome",
    "SavedItemNotFound",
    "SavedWorkMergeConflict",
    "UpsertOutcome",
    "comparison_fingerprint",
    "comparison_record",
    "comparison_records",
    "list_comparisons",
    "list_views",
    "merge_comparisons",
    "merge_views",
    "remove_comparison",
    "remove_view",
    "rename_comparison",
    "rename_view",
    "upsert_comparison",
    "upsert_view",
    "validate_comparison",
    "validate_view_filters",
    "view_fingerprint",
    "view_record",
]
