"""The private account surface: `/api/me/*`.

Every route here depends on `get_current_user`, so the account being read or
mutated is derived from a verified token and from nothing else. There is no
`user_id` path parameter, no owner field in any request body, and no header
outside `Authorization` that names a person, which is what makes cross-account
access unrepresentable rather than merely forbidden.

Nothing in this module touches the public read surface. Discovery, dossiers,
leaderboards, Compare and Methodology are unchanged and stay open to anonymous
callers.

READS DO NOT WRITE. `GET` depends on `get_optional_app_user`, which verifies the
identity exactly as the write path does but never inserts a row. A verified
identity with no account row is not an error and not a reason to create one - it
is an account that has never saved a player, and its canonical list is empty. The
row is materialized only when there is something for it to own, which is what
lets the milestone document say that signing in and browsing leaves no trace.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, get_optional_app_user
from app.core.db import get_db
from app.core.errors import ConflictError, NotFoundError
from app.models.orm import AppUser
from app.models.schemas import (
    FavoriteMutationResponse,
    FavoritesMergeRequest,
    FavoritesMergeResponse,
    FavoritesResponse,
)
from app.services import favorites_service

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
