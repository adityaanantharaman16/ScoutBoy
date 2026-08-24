"""Request and response shapes for saved Discovery views and comparison setups.

Everything a client may send about saved work passes through this module first.
Two properties matter more than any other here:

1. **No arbitrary string reaches storage.** A saved Discovery view is a fixed set
   of named, individually bounded fields - never a URL, a query string, a redirect
   target or a free-form blob. There is no field a caller could use to smuggle a
   `javascript:` URL, a data URL or an unbounded body past this boundary, because
   there is no field that accepts one.
2. **No owner is nameable.** Nothing here carries a user id, account id or external
   subject. Ownership comes from the verified token and from nothing else, so
   cross-account access stays unrepresentable rather than merely rejected.

Labels are user-authored PLAIN TEXT. They are trimmed, length-bounded and
stripped of nothing: a label containing `<script>alert(1)</script>` is stored
verbatim as those 24 characters, because React renders it as text and it is never
interpolated into markup, a URL or a SQL string. Sanitising it here would corrupt
legitimate labels ("Wingers < EUR 5M") while defending nothing that is not already
defended at the point of rendering.
"""

from __future__ import annotations

import unicodedata
from typing import Annotated, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.orm.saved_work import (
    CLIENT_ID_MAX,
    KEY_MAX,
    LABEL_MAX,
    PLAYER_LABEL_MAX,
    TEXT_FILTER_MAX,
)

#: The largest device collection a single merge will accept, per artifact type.
#:
#: Saved views and comparisons are created one deliberate press at a time from a
#: naming dialog; a scout with fifty of either has an unusually rich workspace.
#: 200 is far clear of real use while bounding the work one authenticated request
#: can ask of the database. Exceeding it is a 422 rather than a silent truncation,
#: for the same reason the favourites merge refuses to drop the tail of a list.
MAX_MERGE_ITEMS = 200

#: The largest saved collection an account may hold, per artifact type. Enforced
#: server-side so a client cannot grow an unbounded table one create at a time.
MAX_COLLECTION_ITEMS = 200

#: The five career-stage age stops the Discovery age control can express.
#:
#: Mirrors `AGE_STOPS` in `apps/web/src/lib/filters/index.ts`. The control is a
#: `min=19 max=31 step=3` range input, and every hydration path snaps an
#: off-stop URL bound to the nearest stop before it becomes filter state - so a
#: canonical Discovery view can only ever carry one of these, on exactly one side.
#: Accepting anything else here would mean accepting a view the rail cannot
#: display, which is precisely the drift this contract exists to prevent.
AGE_STOPS = (19, 22, 25, 28, 31)

#: Inclusive bounds mirroring the public `/api/players` contract, so a saved view
#: can never hold a value that surface would reject.
MIN_MINUTES_CEILING = 10_000
ROLEFIT_SCALE_MAX = 99
PAGE_SIZE_CEILING = 100
#: EUR 1 trillion. Not a market judgement - a storage bound, so an absurd
#: hand-crafted asking bound is a 422 rather than a silent integer overflow.
ASKING_EUR_CEILING = 1_000_000_000_000

#: Control characters a plain-text label may not contain: C0, DEL, C1, and the
#: Unicode line/paragraph separators. None of them are typeable content, and each
#: is a way to make one stored label render or log as though it were several.
_FORBIDDEN_CODEPOINTS = set(range(0x00, 0x20)) | {0x7F} | set(range(0x80, 0xA0)) | {0x2028, 0x2029}


def _reject_control_characters(value: str, field: str) -> str:
    if any(ord(ch) in _FORBIDDEN_CODEPOINTS for ch in value):
        raise ValueError(f"{field} may not contain control characters")
    return value


#: A canonical lower-case hyphenated UUID, and nothing else.
#:
#: Strict because this value ADDRESSES A ROW, and it arrives both in a request
#: body and in a URL path. Declared once here and applied to both, so the two can
#: never drift into accepting different things - the first version constrained
#: only the body, and the path parameter silently accepted `1 OR 1=1`. Ownership
#: is enforced separately: a well-formed id belonging to another account simply
#: resolves to nothing.
CLIENT_ID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

CLIENT_ID_DESCRIPTION = "A client-generated UUID, so a retried create cannot duplicate a row."

ClientId = Annotated[
    str,
    Field(
        min_length=1,
        max_length=CLIENT_ID_MAX,
        pattern=CLIENT_ID_PATTERN,
        description=CLIENT_ID_DESCRIPTION,
    ),
]

#: An enumerated key as every ScoutBoy config writes them: lowercase, digits and
#: underscores. Whether the key actually EXISTS is checked in the service layer
#: against the live configuration, exactly as `/api/players` already does for
#: `role`, `sort` and `position_group`.
SlugKey = Annotated[str, Field(min_length=1, max_length=KEY_MAX, pattern=r"^[a-z0-9_]+$")]

#: A position group, which the domain writes in upper case ("ATT", "MID").
PositionGroupKey = Annotated[str, Field(min_length=1, max_length=16, pattern=r"^[A-Z]+$")]


class SavedLabel(BaseModel):
    """The one label rule, shared by both artifact types and by rename."""

    label: str = Field(
        min_length=1,
        max_length=LABEL_MAX,
        description=(
            "User-authored plain text. Outer whitespace is trimmed; control "
            "characters are rejected; the value is never interpreted as markup, "
            "a URL or a redirect target."
        ),
    )

    @field_validator("label", mode="before")
    @classmethod
    def _trim(cls, value: object) -> object:
        # Trimming BEFORE the length check, so 80 characters of content plus a
        # trailing newline is a valid label rather than an off-by-one rejection.
        return value.strip() if isinstance(value, str) else value

    @field_validator("label")
    @classmethod
    def _plain_text(cls, value: str) -> str:
        return _reject_control_characters(value, "label")


class DiscoveryViewFilters(BaseModel):
    """The representable Discovery state, as typed fields.

    Absent (`None`) means "this criterion is not part of the view", which is the
    same thing omitting the parameter from the URL means. There is no sentinel and
    no empty string standing in for absence - `model_config` forbids unknown keys,
    so a stale or hand-crafted body carrying `scope`, `universe`, `age_band` or
    `page` is a 422 rather than a silently ignored extra.

    Two parameters are deliberately unrepresentable:

    * `scope` / `universe` - Analysis Scope was retired from Discovery in Phase
      8.1A. A legacy URL still loads, but nothing may persist it.
    * `page` - opening a saved view always starts on page 1, so the page number is
      not part of what a view means.
    """

    model_config = {"extra": "forbid"}

    q: Optional[str] = Field(default=None, max_length=TEXT_FILTER_MAX)
    position_group: Optional[PositionGroupKey] = None
    role: Optional[SlugKey] = None
    league: Optional[str] = Field(default=None, max_length=TEXT_FILTER_MAX)
    club: Optional[str] = Field(default=None, max_length=TEXT_FILTER_MAX)
    nationality: Optional[str] = Field(default=None, max_length=TEXT_FILTER_MAX)
    playstyle: Optional[SlugKey] = None
    age_min: Optional[int] = None
    age_max: Optional[int] = None
    min_minutes: Optional[int] = Field(default=None, ge=0, le=MIN_MINUTES_CEILING)
    rolefit_min: Optional[int] = Field(default=None, ge=0, le=ROLEFIT_SCALE_MAX)
    rolefit_max: Optional[int] = Field(default=None, ge=0, le=ROLEFIT_SCALE_MAX)
    value_min: Optional[int] = Field(default=None, ge=0, le=ASKING_EUR_CEILING)
    value_max: Optional[int] = Field(default=None, ge=0, le=ASKING_EUR_CEILING)
    sort: Optional[SlugKey] = None
    page_size: Optional[int] = Field(default=None, ge=1, le=PAGE_SIZE_CEILING)

    @field_validator("q", "league", "club", "nationality", mode="before")
    @classmethod
    def _trim_text(cls, value: object) -> object:
        """Outer whitespace only, then NFC.

        Internal spacing is content: a trailing space reaches SQL as a literal
        substring no stored value can contain, so `club=Paris ` silently returns
        nothing - the same failure the Discovery rail's own parser was corrected
        for. Whitespace-only input is "no predicate", identical to omitting the
        field.

        NFC matters because these fields carry the view's IDENTITY. "Köln" typed
        on macOS arrives decomposed (NFD) and pasted from elsewhere arrives
        composed (NFC); the two are visually identical, compare unequal, and would
        otherwise produce two saved views a scout cannot tell apart. Normalizing
        once here means the stored value, the fingerprint derived from it and the
        frontend's own canonical form all agree. The frontend applies the same
        normalization before it compares.
        """
        if not isinstance(value, str):
            return value
        trimmed = unicodedata.normalize("NFC", value.strip())
        return trimmed or None

    @field_validator("q", "league", "club", "nationality")
    @classmethod
    def _plain_text(cls, value: Optional[str]) -> Optional[str]:
        return None if value is None else _reject_control_characters(value, "filter")

    @model_validator(mode="after")
    def _canonical_form(self) -> DiscoveryViewFilters:
        """Rejects anything the Discovery rail could not itself have produced.

        Three invariants, each of which the live surface already guarantees:

        * **One age side, on a stop.** The age control is a single-direction
          threshold over five career-stage stops, and every hydration path snaps an
          off-stop URL bound before it becomes filter state. Both sides set, or a
          value between stops, describes a cohort the rail cannot display.
        * **Coherent inclusive pairs.** `min > max` returns nothing for RoleFit and
          is a documented 422 on the asking-price bounds, so a view that would
          store one is refused rather than saved as a cohort that can never match.
        """
        if self.age_min is not None and self.age_max is not None:
            raise ValueError("a saved view carries at most one age bound")
        for field in ("age_min", "age_max"):
            bound = getattr(self, field)
            if bound is not None and bound not in AGE_STOPS:
                raise ValueError(
                    f"{field} must be one of the age stops {', '.join(map(str, AGE_STOPS))}"
                )
        for low, high in (("rolefit_min", "rolefit_max"), ("value_min", "value_max")):
            lo, hi = getattr(self, low), getattr(self, high)
            if lo is not None and hi is not None and lo > hi:
                raise ValueError(f"{low} may not exceed {high}")
        return self


class SavedViewInput(SavedLabel):
    """One saved Discovery view, as a client offers it."""

    client_id: ClientId
    filters: DiscoveryViewFilters = Field(
        default_factory=DiscoveryViewFilters,
        description="The representable Discovery state. An empty object is the unfiltered view.",
    )


class SavedViewRecord(BaseModel):
    """One saved Discovery view, as the server reports it.

    `fingerprint` is included so a client can recognise its own logical duplicate
    without re-deriving the rule. It is computed server-side from the stored,
    validated fields, so two clients cannot disagree about what a view means and
    no client can split one logical view into two by sending its own digest.
    """

    client_id: str = Field(description="The stable id this view is addressed by.")
    label: str = Field(description="The user-authored plain-text name.")
    filters: DiscoveryViewFilters = Field(description="The representable Discovery state.")
    fingerprint: str = Field(description="Server-computed canonical identity of the filter state.")
    created_at: str = Field(description="ISO-8601 UTC timestamp of first save.")
    updated_at: str = Field(description="ISO-8601 UTC timestamp of the last change.")


class SavedViewsResponse(BaseModel):
    """The account's canonical, ordered saved views.

    Every field is REQUIRED, for the reason `FavoritesResponse` documents: the
    server always sends them in full, and publishing them as optional would be a
    lie the whole frontend then has to write `?? []` around.
    """

    items: list[SavedViewRecord] = Field(
        description="Oldest saved first, with the stable row id breaking ties inside one merge."
    )
    count: int = Field(description="Number of saved views on the account.")


class SavedViewMutationResponse(SavedViewsResponse):
    """The canonical list after one create, upsert or rename, plus what happened."""

    item: Optional[SavedViewRecord] = Field(
        description="The affected view, or null when a removal left nothing to report."
    )
    disposition: str = Field(
        description=(
            "'created' when a new view was stored, 'updated' when an existing "
            "logical view was renamed or refreshed, 'removed' after a delete, and "
            "'unchanged' when the request was already satisfied."
        )
    )


class SavedViewsMergeRequest(BaseModel):
    """A guest's device collection, offered to the account it just signed in to."""

    items: list[SavedViewInput] = Field(
        default_factory=list,
        max_length=MAX_MERGE_ITEMS,
        description=(
            "Ordered device saved views. Items already present by canonical "
            "identity keep the account's existing label and position; items that "
            "fail validation are reported back rather than stored."
        ),
    )


class MergeRejection(BaseModel):
    """One device item the server refused, and why.

    A rejection is reported rather than silently dropped, so the device can show
    the scout exactly which saved item could not travel and let them fix or delete
    it - the alternative is a merge that quietly loses work and reports success.
    """

    client_id: str = Field(description="The device item this concerns.")
    reason: str = Field(
        description="A short, non-echoing explanation, e.g. 'unknown role' or 'player not found'."
    )


class SavedViewsMergeResponse(SavedViewsResponse):
    """The canonical list after a merge, and an honest account of each input item.

    The three disposition lists are disjoint and together cover every distinct
    `client_id` the request offered, so a client can tell exactly what happened to
    its device collection rather than inferring it from a length change.
    """

    added: list[str] = Field(
        description="Device client_ids appended to the account, in device order."
    )
    already_present: list[str] = Field(
        description="Device client_ids whose canonical identity the account already held."
    )
    rejected: list[MergeRejection] = Field(
        description="Device items that failed validation. Nothing was stored for these."
    )


# ---------------------------------------------------------------------------
# Saved comparison setups
# ---------------------------------------------------------------------------


class SavedComparisonInput(SavedLabel):
    """One saved comparison setup, as a client offers it.

    A SETUP, not a result: two ordered player ids and an optional role. There is
    deliberately no field for a score, conclusion, confidence value or evidence
    summary, so a stale analytical number cannot be persisted and later shown as
    though it were current.
    """

    client_id: ClientId
    player_a_id: int = Field(gt=0, description="Player 1 - a meaningful screen position.")
    player_b_id: int = Field(gt=0, description="Player 2 - a meaningful screen position.")
    player_a_label: str = Field(
        min_length=1,
        max_length=PLAYER_LABEL_MAX,
        description="Player 1's display name at save time, so a later deletion can be explained.",
    )
    player_b_label: str = Field(
        min_length=1,
        max_length=PLAYER_LABEL_MAX,
        description="Player 2's display name at save time.",
    )
    role_key: Optional[SlugKey] = Field(
        default=None,
        description="The explicitly selected role. Automatic Role is canonically null.",
    )

    @field_validator("player_a_label", "player_b_label", mode="before")
    @classmethod
    def _trim(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("player_a_label", "player_b_label")
    @classmethod
    def _plain_text(cls, value: str) -> str:
        return _reject_control_characters(value, "player label")

    @model_validator(mode="after")
    def _two_different_players(self) -> SavedComparisonInput:
        # The comparison surface reports this as an error rather than a result, so
        # a setup that can only ever produce that error is not worth storing.
        if self.player_a_id == self.player_b_id:
            raise ValueError("a comparison needs two different players")
        return self


class SavedComparisonSide(BaseModel):
    """One participant, reported honestly whether or not the player still exists."""

    player_id: Optional[int] = Field(
        description="The player, or null once that player is no longer available."
    )
    label: str = Field(description="The display name saved with the setup.")
    available: bool = Field(
        description="False when the player has been removed since the setup was saved."
    )


class SavedComparisonRecord(BaseModel):
    """One saved comparison setup, as the server reports it."""

    client_id: str = Field(description="The stable id this setup is addressed by.")
    label: str = Field(description="The user-authored plain-text name.")
    player_a: SavedComparisonSide = Field(description="Player 1.")
    player_b: SavedComparisonSide = Field(description="Player 2.")
    role_key: Optional[str] = Field(description="The saved role, or null for Automatic Role.")
    fingerprint: str = Field(
        description="Server-computed canonical identity of the ordered pair and role."
    )
    created_at: str = Field(description="ISO-8601 UTC timestamp of first save.")
    updated_at: str = Field(description="ISO-8601 UTC timestamp of the last change.")


class SavedComparisonsResponse(BaseModel):
    """The account's canonical, ordered saved comparison setups."""

    items: list[SavedComparisonRecord] = Field(description="Oldest saved first.")
    count: int = Field(description="Number of saved comparisons on the account.")


class SavedComparisonMutationResponse(SavedComparisonsResponse):
    """The canonical list after one create, upsert or rename, plus what happened."""

    item: Optional[SavedComparisonRecord] = Field(
        description="The affected setup, or null when a removal left nothing to report."
    )
    disposition: str = Field(
        description="'created', 'updated', 'removed' or 'unchanged'.",
    )


class SavedComparisonsMergeRequest(BaseModel):
    """A guest's device comparison setups, offered to the account."""

    items: list[SavedComparisonInput] = Field(
        default_factory=list,
        max_length=MAX_MERGE_ITEMS,
        description="Ordered device saved comparisons.",
    )


class SavedComparisonsMergeResponse(SavedComparisonsResponse):
    """The canonical list after a merge, and what happened to each input item."""

    added: list[str] = Field(description="Device client_ids appended, in device order.")
    already_present: list[str] = Field(
        description="Device client_ids whose canonical identity the account already held."
    )
    rejected: list[MergeRejection] = Field(
        description="Device items that failed validation. Nothing was stored for these."
    )
