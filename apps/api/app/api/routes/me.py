"""The private account surface: `/api/me/*`.

Every route here derives the account being read or mutated from a verified token
and from nothing else. There is no `user_id` path parameter, no owner field in any
request body, and no header outside `Authorization` that names a person, which is
what makes cross-account access unrepresentable rather than merely forbidden. The
`client_id` a saved-work route accepts addresses a row WITHIN the caller's own
account, so a well-formed id belonging to somebody else resolves to nothing.

Three collections live here: My Favorites (Milestone 8.4A) plus saved Discovery
views and saved comparison setups (8.4B).

Nothing in this module touches the public read surface. Discovery, dossiers,
leaderboards, Compare and Methodology are unchanged and stay open to anonymous
callers.

READS DO NOT WRITE. `GET` depends on `get_optional_app_user`, which verifies the
identity exactly as the write path does but never inserts a row. A verified
identity with no account row is not an error and not a reason to create one - it
is an account that has never saved a player, and its canonical list is empty. The
row is materialized only when there is something for it to own, which is what
lets the milestone document say that signing in and browsing leaves no trace.

8.4B extends that rule to no-op MUTATIONS as well: an idempotent delete stores
nothing, a rename of a non-existent item stores nothing, and a merge with no
storable item stores nothing, so none of the three creates an account row.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from app.core.auth import (
    VerifiedIdentity,
    get_current_user,
    get_optional_app_user,
    get_verified_identity,
    resolve_app_user,
)
from app.core.db import get_db
from app.core.errors import ConflictError, NotFoundError, QueryValidationError
from app.models.orm import AppUser
from app.models.schemas import (
    FavoriteMutationResponse,
    FavoritesMergeRequest,
    FavoritesMergeResponse,
    FavoritesResponse,
    SavedComparisonInput,
    SavedComparisonMutationResponse,
    SavedComparisonsMergeRequest,
    SavedComparisonsMergeResponse,
    SavedComparisonsResponse,
    SavedLabel,
    SavedViewInput,
    SavedViewMutationResponse,
    SavedViewsMergeRequest,
    SavedViewsMergeResponse,
    SavedViewsResponse,
)
from app.models.schemas.saved_work import CLIENT_ID_MAX, CLIENT_ID_PATTERN
from app.services import favorites_service, saved_work_service

router = APIRouter(prefix="/me", tags=["account"])

#: Shared 401/503 documentation, so the contract states the boundary once.
AUTH_RESPONSES = {
    401: {"description": "Missing, malformed, expired, forged or misscoped token."},
    503: {"description": "This deployment has no identity provider configured."},
}

#: The merge additionally reports an unresolvable concurrency conflict, so a
#: client is never told a partial merge succeeded.
MERGE_RESPONSES = {
    **AUTH_RESPONSES,
    409: {"description": "A concurrent change prevented the merge from completing; retry."},
}

#: Saved-work writes additionally report a full collection.
SAVED_WRITE_RESPONSES = {
    **AUTH_RESPONSES,
    422: {"description": "Unrepresentable filters, an unknown key, or a full collection."},
}

SAVED_MERGE_RESPONSES = {**MERGE_RESPONSES, **SAVED_WRITE_RESPONSES}

#: The addressed saved item does not exist on the caller's own account.
SAVED_ITEM_RESPONSES = {
    **AUTH_RESPONSES,
    404: {"description": "No such saved item on this account."},
}


@router.get("/favorites", response_model=FavoritesResponse, responses=AUTH_RESPONSES)
def list_favorites(
    user: Optional[AppUser] = Depends(get_optional_app_user),
    db: Session = Depends(get_db),
) -> FavoritesResponse:
    """The signed-in account's canonical ordered My Favorites list.

    Performs no write. An account that has never saved anything has no row, and
    the honest answer for it is the empty list - not a freshly inserted row.
    """
    ids = [] if user is None else favorites_service.canonical_ids(db, user)
    return FavoritesResponse(player_ids=ids, count=len(ids))


@router.put(
    "/favorites/{player_id}", response_model=FavoriteMutationResponse, responses=AUTH_RESPONSES
)
def add_favorite(
    player_id: int = Path(gt=0, description="The player to save."),
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FavoriteMutationResponse:
    """Idempotently add a player.

    The player is checked before the insert, so a stale browser id becomes an
    honest 404 rather than a dangling reference that would resolve to nothing on
    the next read.
    """
    if not favorites_service.existing_player_ids(db, [player_id]):
        raise NotFoundError("Player not found")

    changed = favorites_service.add_favorite(db, user, player_id)
    ids = favorites_service.canonical_ids(db, user)
    return FavoriteMutationResponse(
        player_ids=ids, count=len(ids), player_id=player_id, changed=changed
    )


@router.delete(
    "/favorites/{player_id}", response_model=FavoriteMutationResponse, responses=AUTH_RESPONSES
)
def remove_favorite(
    player_id: int = Path(gt=0, description="The player to unsave."),
    user: Optional[AppUser] = Depends(get_optional_app_user),
    db: Session = Depends(get_db),
) -> FavoriteMutationResponse:
    """Idempotently remove a player.

    Deliberately does NOT 404 on an unknown player: the caller's goal is "this
    player is not on my list", and that is already true. Removing something a
    previous request removed is a success, so a retried delete behaves the same
    as the first attempt.

    Also deliberately does not CREATE an account row. A removal stores nothing,
    so an account with no row already satisfies the request; inserting one would
    be a write with no purpose whose only effect is to falsify "browsing writes
    nothing".
    """
    if user is None:
        return FavoriteMutationResponse(player_ids=[], count=0, player_id=player_id, changed=False)

    changed = favorites_service.remove_favorite(db, user, player_id)
    ids = favorites_service.canonical_ids(db, user)
    return FavoriteMutationResponse(
        player_ids=ids, count=len(ids), player_id=player_id, changed=changed
    )


@router.post("/favorites/merge", response_model=FavoritesMergeResponse, responses=MERGE_RESPONSES)
def merge_favorites(
    payload: FavoritesMergeRequest,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FavoritesMergeResponse:
    """Union a guest's browser-local list into the signed-in account.

    Existing account favourites keep their order; previously unseen guest IDs are
    appended in guest order. Duplicates collapse to their first occurrence and
    unresolvable IDs are reported rather than saved, so the client can retire its
    guest list on the strength of this response alone.
    """
    try:
        outcome = favorites_service.merge_favorites(db, user, payload.player_ids)
    except favorites_service.FavoritesMergeConflict as exc:
        # Deliberately NOT a 200 with a short list: the client clears its device
        # copy on success, so a partial success is how a guest list gets lost.
        raise ConflictError(
            "My Favorites could not be merged because the account changed at the "
            "same time. Nothing was lost; retry the merge."
        ) from exc
    return FavoritesMergeResponse(
        player_ids=outcome.player_ids,
        count=len(outcome.player_ids),
        added=outcome.added,
        already_present=outcome.already_present,
        unknown=outcome.unknown,
    )


# ---------------------------------------------------------------------------
# Saved work (Milestone 8.4B)
#
# Two collections with one shape. Every route below derives its owner from the
# verified token: there is no owner path parameter, no owner field in any body,
# and no header outside `Authorization` that names a person, so cross-account
# access stays unrepresentable rather than merely rejected. `client_id` addresses
# a row WITHIN the caller's own account, so a well-formed id belonging to somebody
# else resolves to nothing rather than to their data.
#
# READS AND NO-OPS DO NOT WRITE. `GET` and `DELETE` depend on
# `get_optional_app_user`, which verifies the identity exactly as the write path
# does but never inserts. The merge goes further and depends on the raw verified
# identity, materializing an account row only once it knows the request will
# actually store something - so an empty merge, or one whose every item is
# invalid, leaves no trace either.
# ---------------------------------------------------------------------------


def _views_payload(db: Session, user: Optional[AppUser]) -> dict:
    rows = saved_work_service.list_views(db, user)
    items = [saved_work_service.view_record(row) for row in rows]
    return {"items": items, "count": len(items)}


def _comparisons_payload(db: Session, user: Optional[AppUser]) -> dict:
    rows = saved_work_service.list_comparisons(db, user)
    items = saved_work_service.comparison_records(db, rows)
    return {"items": items, "count": len(items)}


def _reject(field: str, value: object, message: str) -> None:
    """A 422 in FastAPI's own validation-error shape.

    Membership checks (does this role exist? is this collection full?) are answers
    configuration and state give, not literals a route could declare, so they are
    raised here in the same body shape a natively declared 422 produces - one
    shape for every rejected value.
    """
    raise QueryValidationError(field, value, message)


# -- Saved Discovery views --------------------------------------------------


@router.get("/saved-views", response_model=SavedViewsResponse, responses=AUTH_RESPONSES)
def list_saved_views(
    user: Optional[AppUser] = Depends(get_optional_app_user),
    db: Session = Depends(get_db),
) -> SavedViewsResponse:
    """The account's canonical ordered saved Discovery views. **Never writes.**"""
    return SavedViewsResponse(**_views_payload(db, user))


@router.post(
    "/saved-views/merge", response_model=SavedViewsMergeResponse, responses=SAVED_MERGE_RESPONSES
)
def merge_saved_views(
    payload: SavedViewsMergeRequest,
    identity: VerifiedIdentity = Depends(get_verified_identity),
    db: Session = Depends(get_db),
) -> SavedViewsMergeResponse:
    """Union a guest's device saved views into the signed-in account.

    Existing account views keep their order AND their labels; previously unseen
    device views are appended in device order. Items whose filters no longer
    validate are reported in `rejected` rather than stored, so a stale device
    artifact can never write an unrepresentable filter into the account.
    """
    user = saved_work_service.find_owner(db, identity)
    try:
        outcome = saved_work_service.merge_views(
            db, user, payload.items, lambda: resolve_app_user(db, identity)
        )
    except saved_work_service.SavedWorkMergeConflict as exc:
        raise ConflictError(
            "Saved views could not be merged because the account changed at the "
            "same time. Nothing was lost; retry the merge."
        ) from exc
    except saved_work_service.CollectionFullError as exc:
        _reject("items", len(payload.items), str(exc))

    items = [saved_work_service.view_record(row) for row in outcome.rows]
    return SavedViewsMergeResponse(
        items=items,
        count=len(items),
        added=outcome.added,
        already_present=outcome.already_present,
        rejected=outcome.rejected,
    )


@router.post(
    "/saved-views", response_model=SavedViewMutationResponse, responses=SAVED_WRITE_RESPONSES
)
def save_view(
    payload: SavedViewInput,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SavedViewMutationResponse:
    """Idempotently store one saved Discovery view.

    Idempotent on two independent identities: the canonical fingerprint of the
    filter state (so saving the same configuration again renames the existing view
    rather than duplicating it) and the client-generated id (so a create whose
    response was lost is retried onto the same row).
    """
    reason = saved_work_service.validate_view_filters(db, payload.filters)
    if reason is not None:
        _reject("filters", reason, f"This Discovery view cannot be saved: {reason}.")
    try:
        outcome = saved_work_service.upsert_view(db, user, payload)
    except saved_work_service.CollectionFullError as exc:
        _reject("items", None, str(exc))

    return SavedViewMutationResponse(
        **_views_payload(db, user),
        item=saved_work_service.view_record(outcome.row),
        disposition=outcome.disposition,
    )


@router.patch(
    "/saved-views/{client_id}",
    response_model=SavedViewMutationResponse,
    responses=SAVED_ITEM_RESPONSES,
)
def rename_saved_view(
    payload: SavedLabel,
    client_id: str = Path(
        pattern=CLIENT_ID_PATTERN,
        max_length=CLIENT_ID_MAX,
        description="The saved view to rename.",
    ),
    user: Optional[AppUser] = Depends(get_optional_app_user),
    db: Session = Depends(get_db),
) -> SavedViewMutationResponse:
    """Rename one saved view. 404 when this account has no such item.

    Deliberately on the read dependency: renaming something that does not exist
    stores nothing, so it must not be the request that creates an account row.
    """
    if user is None:
        raise NotFoundError("No such saved view")
    try:
        row = saved_work_service.rename_view(db, user, client_id, payload.label)
    except saved_work_service.SavedItemNotFound as exc:
        raise NotFoundError("No such saved view") from exc
    return SavedViewMutationResponse(
        **_views_payload(db, user),
        item=saved_work_service.view_record(row),
        disposition="updated",
    )


@router.delete(
    "/saved-views/{client_id}", response_model=SavedViewMutationResponse, responses=AUTH_RESPONSES
)
def remove_saved_view(
    client_id: str = Path(
        pattern=CLIENT_ID_PATTERN,
        max_length=CLIENT_ID_MAX,
        description="The saved view to remove.",
    ),
    user: Optional[AppUser] = Depends(get_optional_app_user),
    db: Session = Depends(get_db),
) -> SavedViewMutationResponse:
    """Idempotently remove one saved view.

    Never 404s: the caller's goal is "this view is not on my list", and for an id
    that is not there that is already true, so a retried delete behaves exactly
    like the first attempt. Creates no account row for the same reason a removal
    stores nothing.
    """
    if user is None:
        return SavedViewMutationResponse(items=[], count=0, item=None, disposition="unchanged")
    changed = saved_work_service.remove_view(db, user, client_id)
    return SavedViewMutationResponse(
        **_views_payload(db, user), item=None, disposition="removed" if changed else "unchanged"
    )


# -- Saved comparison setups ------------------------------------------------


@router.get("/saved-comparisons", response_model=SavedComparisonsResponse, responses=AUTH_RESPONSES)
def list_saved_comparisons(
    user: Optional[AppUser] = Depends(get_optional_app_user),
    db: Session = Depends(get_db),
) -> SavedComparisonsResponse:
    """The account's canonical ordered saved comparison setups. **Never writes.**

    A side whose player has since been removed is reported with `player_id: null`,
    `available: false` and the name it was saved under - never as a player that
    still exists, and never by silently dropping the saved setup.
    """
    return SavedComparisonsResponse(**_comparisons_payload(db, user))


@router.post(
    "/saved-comparisons/merge",
    response_model=SavedComparisonsMergeResponse,
    responses=SAVED_MERGE_RESPONSES,
)
def merge_saved_comparisons(
    payload: SavedComparisonsMergeRequest,
    identity: VerifiedIdentity = Depends(get_verified_identity),
    db: Session = Depends(get_db),
) -> SavedComparisonsMergeResponse:
    """Union a guest's device comparison setups into the signed-in account."""
    user = saved_work_service.find_owner(db, identity)
    try:
        outcome = saved_work_service.merge_comparisons(
            db, user, payload.items, lambda: resolve_app_user(db, identity)
        )
    except saved_work_service.SavedWorkMergeConflict as exc:
        raise ConflictError(
            "Saved comparisons could not be merged because the account changed at "
            "the same time. Nothing was lost; retry the merge."
        ) from exc
    except saved_work_service.CollectionFullError as exc:
        _reject("items", len(payload.items), str(exc))

    items = saved_work_service.comparison_records(db, outcome.rows)
    return SavedComparisonsMergeResponse(
        items=items,
        count=len(items),
        added=outcome.added,
        already_present=outcome.already_present,
        rejected=outcome.rejected,
    )


@router.post(
    "/saved-comparisons",
    response_model=SavedComparisonMutationResponse,
    responses=SAVED_WRITE_RESPONSES,
)
def save_comparison(
    payload: SavedComparisonInput,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SavedComparisonMutationResponse:
    """Idempotently store one saved comparison setup.

    Both players must exist at the moment the setup is first saved, so a stale
    device artifact cannot manufacture the "player unavailable" state. A player
    removed AFTERWARDS is a different thing entirely, and the saved setup survives
    it.
    """
    reason = saved_work_service.validate_comparison(db, payload)
    if reason is not None:
        _reject("player", reason, f"This comparison cannot be saved: {reason}.")
    try:
        outcome = saved_work_service.upsert_comparison(db, user, payload)
    except saved_work_service.CollectionFullError as exc:
        _reject("items", None, str(exc))

    return SavedComparisonMutationResponse(
        **_comparisons_payload(db, user),
        item=saved_work_service.comparison_records(db, [outcome.row])[0],
        disposition=outcome.disposition,
    )


@router.patch(
    "/saved-comparisons/{client_id}",
    response_model=SavedComparisonMutationResponse,
    responses=SAVED_ITEM_RESPONSES,
)
def rename_saved_comparison(
    payload: SavedLabel,
    client_id: str = Path(
        pattern=CLIENT_ID_PATTERN,
        max_length=CLIENT_ID_MAX,
        description="The saved comparison to rename.",
    ),
    user: Optional[AppUser] = Depends(get_optional_app_user),
    db: Session = Depends(get_db),
) -> SavedComparisonMutationResponse:
    """Rename one saved comparison. 404 when this account has no such item."""
    if user is None:
        raise NotFoundError("No such saved comparison")
    try:
        row = saved_work_service.rename_comparison(db, user, client_id, payload.label)
    except saved_work_service.SavedItemNotFound as exc:
        raise NotFoundError("No such saved comparison") from exc
    return SavedComparisonMutationResponse(
        **_comparisons_payload(db, user),
        item=saved_work_service.comparison_records(db, [row])[0],
        disposition="updated",
    )


@router.delete(
    "/saved-comparisons/{client_id}",
    response_model=SavedComparisonMutationResponse,
    responses=AUTH_RESPONSES,
)
def remove_saved_comparison(
    client_id: str = Path(
        pattern=CLIENT_ID_PATTERN,
        max_length=CLIENT_ID_MAX,
        description="The saved comparison to remove.",
    ),
    user: Optional[AppUser] = Depends(get_optional_app_user),
    db: Session = Depends(get_db),
) -> SavedComparisonMutationResponse:
    """Idempotently remove one saved comparison. Never 404s, and creates no row."""
    if user is None:
        return SavedComparisonMutationResponse(
            items=[], count=0, item=None, disposition="unchanged"
        )
    changed = saved_work_service.remove_comparison(db, user, client_id)
    return SavedComparisonMutationResponse(
        **_comparisons_payload(db, user),
        item=None,
        disposition="removed" if changed else "unchanged",
    )
