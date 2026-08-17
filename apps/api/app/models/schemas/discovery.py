"""The Discovery response and its ranking explanation.

Phase 8.3. Discovery already retrieved, filtered, ordered, counted and paged
deterministically; what it could not do was say which ordering it had applied. These
schemas carry that answer as STRUCTURED fields with bounded, deterministic display
text — never an opaque paragraph a client would have to parse, and never generated
prose.

It is deliberately a PAGE-LEVEL explanation: the active mode, its exact ordered key
sequence, the role context, how unknown values are placed, the final tie-breakers and
one limitation. It describes the ordering the query applied, not individual players,
and it compares no two rows.

Everything reported here is derived from the one backend-owned sort specification in
``repositories.discovery_sort``, which is also what builds the SQL ``ORDER BY``. The
frontend renders these fields; it does not re-implement any ordering rule.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from .player import PlayerSearchCard


class RankingKey(BaseModel):
    """One ordering key, in the exact position the ``ORDER BY`` applies it."""

    #: 1-based position within the active mode's key sequence.
    position: int
    #: Stable machine identity, e.g. "result_role_score". Never displayed alone.
    key: str
    label: str
    #: "ascending" or "descending", of the value this key orders by.
    direction: str
    #: How that direction reads: "Highest first", "Known first", "A to Z", ...
    direction_label: str
    #: "placement" (known before unknown), "measure", or "tie_breaker".
    role: str
    #: What the ordered values are measured in: "rolefit_score", "confidence",
    #: "age_years", "eur", "name", "player_id", "rating_status", "price_status".
    unit: str
    #: One deterministic sentence stating the rule.
    rule: str


class RankingRoleContext(BaseModel):
    """Which stored rating supplies the RoleFit shown on every result.

    ``selected_role`` when the request carries ``role=<key>``: every result's
    ``result_role*`` group is that role. ``best_role`` otherwise: each player's own
    stored best role, which may differ from row to row.

    Whether that rating also *ordered* the page depends on the active sort, and
    ``detail`` says which of the two it is. Under the RoleFit modes the applicable
    score and confidence are ordering keys; under Age, Expected Asking and Name they
    are displayed context and the named sort does the ordering.
    """

    source: str
    #: The selected role key, or None under the best-role context.
    role_key: Optional[str] = None
    role_display: Optional[str] = None
    label: str
    detail: str


class RankingExplanation(BaseModel):
    """Which ordering this page is in.

    Ordering only. It does not describe recruitment quality, suitability or
    priority, and no filter appears here as a reason for rank: filters decide
    inclusion, and only the keys below decide order.
    """

    sort: str
    sort_label: str
    direction: str
    direction_label: str
    #: The one-line statement of the active order, e.g. "Ordered by RoleFit,
    #: highest first."
    summary: str

    #: The exact ordered key sequence the database applied, first key first.
    keys: list[RankingKey] = []
    role_context: RankingRoleContext
    #: How this mode places values it does not know.
    missing_values: str
    #: The trailing keys that only ever resolve rows the rest left equal. Derived
    #: from `keys`, never listed independently of it.
    tie_breakers: list[RankingKey] = []
    limitation: str


class DiscoverySearchResponse(BaseModel):
    """One page of Discovery results, plus which ordering produced them.

    The five pagination fields are exactly the ones ``Paginated`` has always
    carried, in the same shape, so every existing client keeps working unchanged.
    ``ranking`` is additive.
    """

    items: list[PlayerSearchCard]
    total: int
    page: int
    page_size: int
    total_pages: int
    ranking: RankingExplanation
