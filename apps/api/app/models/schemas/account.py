"""Request and response shapes for the private `/api/me/*` surface."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field

#: A player ID as the API will accept it. Non-positive values are a contract
#: violation (422), not a stale reference; a stale-but-plausible ID is positive,
#: resolves to nothing, and is reported in `unknown` instead.
PlayerId = Annotated[int, Field(gt=0)]

#: The largest guest list a single merge will accept.
#:
#: A guest shortlist is assembled by hand, one player at a time, from a ledger
#: that shows a page at a time; a few dozen is a heavy real list. 500 is well
#: clear of that while still bounding the work a single authenticated request can
#: ask the database to do, so an oversized body is rejected by the schema before
#: any query runs. Exceeding it is a 422 rather than a silent truncation, because
#: quietly dropping the tail of somebody's saved players is worse than saying no.
MAX_MERGE_PLAYER_IDS = 500


class FavoritesResponse(BaseModel):
    """The authenticated account's canonical, ordered favourite player IDs.

    Every field is REQUIRED. A Pydantic `default_factory` would publish these as
    optional in the OpenAPI contract, which would be a lie about a response the
    server always sends in full - and would force every consumer to write a
    `?? []` that can never actually fire.
    """

    player_ids: list[int] = Field(
        description=(
            "Player IDs in canonical order: oldest saved first, with the stable "
            "row id breaking ties inside a single merge."
        ),
    )
    count: int = Field(description="Number of players on the account's list.")


class FavoriteMutationResponse(FavoritesResponse):
    """The canonical list after a single add or remove, plus what changed.

    `changed` is false when the request was a no-op — favouriting a player that
    was already saved, or removing one that was not. Both are successes: the
    endpoints are idempotent, so the caller can retry a dropped request without
    reasoning about whether the first attempt landed.
    """

    player_id: int = Field(description="The player the request addressed.")
    changed: bool = Field(
        description="True when this request altered the list, false when it was already in that state."
    )


class FavoritesMergeRequest(BaseModel):
    """A guest's browser-local list, offered to the account it just signed in to."""

    player_ids: list[PlayerId] = Field(
        default_factory=list,
        max_length=MAX_MERGE_PLAYER_IDS,
        description=(
            "Ordered guest favourite player IDs. Duplicates are collapsed to their "
            "first occurrence; IDs that do not resolve to a player are reported "
            "back rather than saved."
        ),
    )


class FavoritesMergeResponse(FavoritesResponse):
    """The canonical list after a merge, and an honest account of each input ID.

    The three disposition lists are disjoint and together cover every distinct ID
    the request offered, so a client can tell exactly what happened to a guest
    list rather than inferring it from a length change.
    """

    added: list[int] = Field(
        description="Guest IDs that were not on the account and have now been appended, in guest order.",
    )
    already_present: list[int] = Field(
        description="Guest IDs the account had already saved. Their existing position is unchanged.",
    )
    unknown: list[int] = Field(
        description="Guest IDs that resolve to no player. Nothing was saved for these.",
    )
