"""The one Discovery ordering specification: SQL and explanation from one source.

Phase 8.3. Discovery's ordering used to exist in exactly one form — a dict of
SQLAlchemy ``ORDER BY`` fragments inside ``_Candidates.order_by``. Telling a scout
*why* a page is in the order it is in needs the same information in a second form: a
named, ordered, describable key sequence. A second hand-written description map
beside the SQL would be free to drift from it the moment anyone edited either one,
and a stale ranking explanation is worse than none — it is a confident lie about what
the database did.

So the sequence is declared once, here. Each :class:`SortKey` carries, together and
inseparably, the ``ORDER BY`` element the database sorts by and the identity, label,
direction and one deterministic sentence of rule that describe it.

``discovery_repo._Candidates.order_by`` builds SQL by walking a mode's key tuple; the
explanation in ``services/discovery_explanation.py`` walks the identical tuple.
Adding, removing or reordering a key therefore moves both at once — there is no second
list to forget. This is held structurally rather than by convention:
``test_discovery_ranking.py`` compiles the real ``ORDER BY`` and asserts it is exactly
the declared sequence, and mutates a specification to prove both consumers move with
it.

**Nothing here is generative and nothing here scores.** Every rule sentence is a fixed
string about a stored value the query already ordered by. There is no new composite
score, no recommendation, and no claim that a filter contributed to rank — only the
active sort keys order anything.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from sqlalchemy import case, func
from sqlalchemy.sql import ColumnElement

#: Confidence ordering. Higher wins the RoleFit tie-break in BOTH directions, and an
#: absent rating ranks as "unknown".
CONFIDENCE_RANK = {"unknown": 0, "low": 1, "medium": 2, "high": 3}

#: Sentinel ages for a record with no birth date, mirroring the previous Python sort
#: key so unknown ages stay last in both age directions without relying on the
#: database's default NULL placement.
UNKNOWN_AGE_ASC_SENTINEL = 999.0
UNKNOWN_AGE_DESC_SENTINEL = -1.0

#: The one sentence that bounds what any of this means. Stated on every response.
ORDERING_LIMITATION = (
    "This explains ordering, not recruitment suitability. It reports the stored "
    "values the database sorted by; it does not rate, rank or recommend a signing."
)


# ---------------------------------------------------------------------------
# what a key is given
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class SortContext:
    """The SQL expressions one request's ordering keys are built from.

    Supplied by ``discovery_repo``, which owns the joins these come from. Keeping
    them as parameters rather than importing the repository is what lets this module
    stay the ordering *definition* without depending on the query that uses it.
    """

    #: The applicable role context's stored final score (selected role, else best).
    score: ColumnElement
    #: That same rating's stored confidence.
    confidence: ColumnElement
    #: The displayed rounded age, or a typed NULL when it cannot be known.
    age: ColumnElement
    #: The expected-asking LOW endpoint. Never the high endpoint, never a midpoint.
    asking_low: ColumnElement
    #: The canonical name, lowercased and collated to code-point order.
    name_key: ColumnElement
    player_id: ColumnElement


def confidence_rank_expr(confidence: ColumnElement) -> ColumnElement:
    """Stored confidence as an orderable rank: unknown < low < medium < high."""
    return case(
        *[(confidence == level, rank) for level, rank in sorted(CONFIDENCE_RANK.items())],
        else_=CONFIDENCE_RANK["unknown"],
    )


# ---------------------------------------------------------------------------
# the key
# ---------------------------------------------------------------------------
#: A key that places known values before unknown ones and orders nothing else.
ROLE_PLACEMENT = "placement"
#: A key that orders by a stored measurement.
ROLE_MEASURE = "measure"
#: A key that only ever resolves rows the earlier keys left equal.
ROLE_TIE_BREAKER = "tie_breaker"


@dataclass(frozen=True)
class SortKey:
    """One ordering key: what the database does, and how to say what it does."""

    #: Stable machine identity. Never displayed on its own.
    key: str
    label: str
    #: "ascending" or "descending", of the value this key orders by.
    direction: str
    #: How that direction reads to a scout ("Highest first", "Known first", ...).
    direction_label: str
    role: str
    #: What the compared values are measured in.
    unit: str
    #: One deterministic sentence stating the rule.
    rule: str
    #: The ORDER BY element. The database sorts by exactly this.
    order: Callable[[SortContext], ColumnElement]


RATED_FIRST = SortKey(
    key="rated_first",
    label="Rated Before Unrated",
    direction="ascending",
    direction_label="Known first",
    role=ROLE_PLACEMENT,
    unit="rating_status",
    rule=(
        "Players with a stored RoleFit rating for this role context are placed before "
        "players without one, in both RoleFit directions. A missing score is never "
        "read as zero."
    ),
    order=lambda c: case((c.score.is_(None), 1), else_=0).asc(),
)

ROLEFIT_SCORE_DESC = SortKey(
    key="result_role_score",
    label="RoleFit Score",
    direction="descending",
    direction_label="Highest first",
    role=ROLE_MEASURE,
    unit="rolefit_score",
    rule="The applicable role context's stored RoleFit score, highest first.",
    order=lambda c: func.coalesce(c.score, 0.0).desc(),
)

ROLEFIT_SCORE_ASC = SortKey(
    key="result_role_score",
    label="RoleFit Score",
    direction="ascending",
    direction_label="Lowest first",
    role=ROLE_MEASURE,
    unit="rolefit_score",
    rule="The applicable role context's stored RoleFit score, lowest first.",
    order=lambda c: func.coalesce(c.score, 0.0).asc(),
)

ROLEFIT_CONFIDENCE = SortKey(
    key="result_role_confidence",
    label="RoleFit Confidence",
    direction="descending",
    direction_label="Highest first",
    role=ROLE_MEASURE,
    unit="confidence",
    rule=(
        "Only on an equal score: High Confidence, then Medium, then Low, then "
        "Unknown. Descending in both RoleFit directions."
    ),
    order=lambda c: confidence_rank_expr(c.confidence).desc(),
)

AGE_ASC = SortKey(
    key="age",
    label="Age",
    direction="ascending",
    direction_label="Youngest first",
    role=ROLE_MEASURE,
    unit="age_years",
    rule="The displayed rounded age, lowest first; unknown ages are placed last.",
    order=lambda c: func.coalesce(c.age, UNKNOWN_AGE_ASC_SENTINEL).asc(),
)

AGE_DESC = SortKey(
    key="age",
    label="Age",
    direction="descending",
    direction_label="Oldest first",
    role=ROLE_MEASURE,
    unit="age_years",
    rule="The displayed rounded age, highest first; unknown ages are placed last.",
    order=lambda c: (-func.coalesce(c.age, UNKNOWN_AGE_DESC_SENTINEL)).asc(),
)

PRICED_FIRST = SortKey(
    key="asking_low_known_first",
    label="Expected Asking Known First",
    direction="ascending",
    direction_label="Known first",
    role=ROLE_PLACEMENT,
    unit="price_status",
    rule=(
        "Players with a known expected-asking LOW endpoint are placed before players "
        "without one, in both directions. A missing endpoint is never read as €0."
    ),
    order=lambda c: case((c.asking_low.is_(None), 1), else_=0).asc(),
)

ASKING_LOW_DESC = SortKey(
    key="expected_asking_low_eur",
    label="Expected Asking (Lower Endpoint)",
    direction="descending",
    direction_label="Highest first",
    role=ROLE_MEASURE,
    unit="eur",
    rule=(
        "The stored expected-asking LOW endpoint, highest first. Never the high "
        "endpoint and never a midpoint of the two."
    ),
    order=lambda c: func.coalesce(c.asking_low, 0.0).desc(),
)

ASKING_LOW_ASC = SortKey(
    key="expected_asking_low_eur",
    label="Expected Asking (Lower Endpoint)",
    direction="ascending",
    direction_label="Lowest first",
    role=ROLE_MEASURE,
    unit="eur",
    rule=(
        "The stored expected-asking LOW endpoint, lowest first. Never the high "
        "endpoint and never a midpoint of the two."
    ),
    order=lambda c: func.coalesce(c.asking_low, 0.0).asc(),
)

_NAME_RULE = (
    "The canonical name, lowercased the way Python's str.lower() does it and "
    "compared by Unicode code point, A to Z."
)

NAME_PRIMARY = SortKey(
    key="canonical_name",
    label="Canonical Name",
    direction="ascending",
    direction_label="A to Z",
    role=ROLE_MEASURE,
    unit="name",
    rule=_NAME_RULE,
    order=lambda c: c.name_key.asc(),
)

NAME_TIE_BREAK = SortKey(
    key="canonical_name",
    label="Canonical Name",
    direction="ascending",
    direction_label="A to Z",
    role=ROLE_TIE_BREAKER,
    unit="name",
    rule=_NAME_RULE,
    order=lambda c: c.name_key.asc(),
)

PLAYER_ID = SortKey(
    key="player_id",
    label="Player ID",
    direction="ascending",
    direction_label="Lowest first",
    role=ROLE_TIE_BREAKER,
    unit="player_id",
    rule="The stable player ID, ascending, decides anything still equal.",
    order=lambda c: c.player_id.asc(),
)


# ---------------------------------------------------------------------------
# the modes
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class SortSpec:
    """One sort mode: its identity, how it reads, and its exact key sequence."""

    sort: str
    #: What is being ordered by, as a scout would name it.
    label: str
    direction: str
    #: How the direction reads ("highest first", "youngest first", ...).
    direction_label: str
    #: The one-line statement of the active order.
    summary: str
    #: How this mode places values it does not know.
    missing_values: str
    keys: tuple

    @property
    def tie_breakers(self) -> tuple:
        """The trailing keys that only ever resolve rows the rest left equal.

        Derived from `keys`, never listed separately, so the reported tie-breakers
        cannot describe a sequence the SQL does not have.
        """
        return tuple(key for key in self.keys if key.role == ROLE_TIE_BREAKER)

    @property
    def orders_by_rolefit(self) -> bool:
        """Whether a stored RoleFit score is one of this mode's ordering keys.

        Derived from the key sequence rather than declared beside it, so the role
        context cannot claim RoleFit ordered a page that RoleFit had no part in.
        Age, Expected Asking and Name order by something else entirely, and the
        applicable role rating is then displayed context rather than the ordering.
        """
        return any(key.unit == "rolefit_score" for key in self.keys)


_ROLEFIT_MISSING = (
    "A player with no stored rating for this role context is placed after every "
    "rated player, in both directions, and never receives a placeholder score."
)
_AGE_MISSING = (
    "A player with no known birth date has an unknown age and is placed after every "
    "known age, in both directions."
)
_ASKING_MISSING = (
    "A player whose expected-asking LOW endpoint is unknown is placed after every "
    "priced player, in both directions, and is never read as €0."
)
_NAME_MISSING = "Every player has a canonical name, so this ordering places no unknown value."


SORT_SPECS = {
    "rolefit_desc": SortSpec(
        sort="rolefit_desc",
        label="RoleFit",
        direction="descending",
        direction_label="highest first",
        summary="Ordered by RoleFit, highest first.",
        missing_values=_ROLEFIT_MISSING,
        keys=(
            RATED_FIRST,
            ROLEFIT_SCORE_DESC,
            ROLEFIT_CONFIDENCE,
            NAME_TIE_BREAK,
            PLAYER_ID,
        ),
    ),
    "rolefit_asc": SortSpec(
        sort="rolefit_asc",
        label="RoleFit",
        direction="ascending",
        direction_label="lowest first",
        summary="Ordered by RoleFit, lowest first.",
        missing_values=_ROLEFIT_MISSING,
        keys=(
            RATED_FIRST,
            ROLEFIT_SCORE_ASC,
            ROLEFIT_CONFIDENCE,
            NAME_TIE_BREAK,
            PLAYER_ID,
        ),
    ),
    "age_asc": SortSpec(
        sort="age_asc",
        label="Age",
        direction="ascending",
        direction_label="youngest first",
        summary="Ordered by age, youngest first.",
        missing_values=_AGE_MISSING,
        keys=(AGE_ASC, NAME_TIE_BREAK, PLAYER_ID),
    ),
    "age_desc": SortSpec(
        sort="age_desc",
        label="Age",
        direction="descending",
        direction_label="oldest first",
        summary="Ordered by age, oldest first.",
        missing_values=_AGE_MISSING,
        keys=(AGE_DESC, NAME_TIE_BREAK, PLAYER_ID),
    ),
    "value_desc": SortSpec(
        sort="value_desc",
        label="Expected Asking",
        direction="descending",
        direction_label="highest first",
        summary="Ordered by Expected Asking, highest first.",
        missing_values=_ASKING_MISSING,
        keys=(PRICED_FIRST, ASKING_LOW_DESC, NAME_TIE_BREAK, PLAYER_ID),
    ),
    "value_asc": SortSpec(
        sort="value_asc",
        label="Expected Asking",
        direction="ascending",
        direction_label="lowest first",
        summary="Ordered by Expected Asking, lowest first.",
        missing_values=_ASKING_MISSING,
        keys=(PRICED_FIRST, ASKING_LOW_ASC, NAME_TIE_BREAK, PLAYER_ID),
    ),
    "name_asc": SortSpec(
        sort="name_asc",
        label="Name",
        direction="ascending",
        direction_label="A to Z",
        summary="Ordered by name, A to Z.",
        missing_values=_NAME_MISSING,
        keys=(NAME_PRIMARY, PLAYER_ID),
    ),
}


def spec_for(sort: str) -> SortSpec:
    """The specification for one validated sort mode.

    The service validates `sort` against its own enumeration before anything reaches
    here, so a `KeyError` would be a programming error rather than a bad request.
    """
    return SORT_SPECS[sort]


def order_by(sort: str, context: SortContext) -> list:
    """The ``ORDER BY`` elements for one mode, straight off its key sequence."""
    return [key.order(context) for key in spec_for(sort).keys]
