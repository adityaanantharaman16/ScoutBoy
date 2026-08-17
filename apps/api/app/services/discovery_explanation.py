"""Assemble the Discovery ranking explanation from the active sort specification.

Phase 8.3. Every fact here is read from the one backend-owned sort specification in
``repositories.discovery_sort`` — the same specification the SQL ``ORDER BY`` is built
from. The ordered key sequence IS that specification's key tuple, and the reported
tie-breakers are derived from it rather than listed beside it.

It is page-level metadata about the ordering, so it needs **no rows at all**: it does
not read the returned page, does not compare players, and issues **no query of its
own**. A Discovery request costs the same four statements it did before Phase 8.3.

What it deliberately does NOT do:

* invent evidence, or describe anything the query did not order by;
* attribute rank to a filter — filters decide inclusion, keys decide order;
* produce a recommendation, suitability, priority or "best signing" label;
* claim RoleFit ordered a page that RoleFit had no part in ordering. Under Age,
  Expected Asking and Name the applicable role rating is displayed context and the
  named sort does the ordering, and the role-context sentence says so;
* generate prose. Every sentence is a fixed template over the specification.
"""

from __future__ import annotations

from typing import Optional

from app.models.schemas import RankingExplanation, RankingKey, RankingRoleContext
from app.repositories import discovery_sort

#: Which context `result_role*` describes. Mirrors `players_service`'s constants,
#: which are the values actually serialized onto each card.
RESULT_ROLE_BEST = "best_role"
RESULT_ROLE_SELECTED = "selected_role"

_SELECTED_ROLE_BASIS = (
    "{display} is selected, so every result is judged by its stored {display} rating, "
    "and no other role's rating is read."
)
_BEST_ROLE_BASIS = (
    "No role is selected, so the RoleFit on each result is that player's own stored "
    "best role, which may differ from row to row."
)
#: Said when the applicable rating is genuinely one of the ordering keys.
_ORDERS_THE_PAGE = (
    " That rating's stored score and confidence are two of the ordering keys below, "
    "and are what this page is ordered by."
)


def _displayed_not_ordered(spec: discovery_sort.SortSpec) -> str:
    """Said when the page is ordered by something other than RoleFit.

    Naming the sort here is the whole point: without it the role context reads as
    though RoleFit ranked an age-sorted or price-sorted ledger, which is false.
    """
    return (
        f" That rating is what each result DISPLAYS. It did not order this page: "
        f"the ordering comes from the {spec.label} sort ({spec.direction_label}), "
        f"as the keys below state."
    )


def role_context(
    role_key: Optional[str],
    role_display_map: dict,
    spec: discovery_sort.SortSpec,
) -> RankingRoleContext:
    """Which stored rating every result shows, and whether it also ordered the page.

    Two independent facts, deliberately reported together because conflating them is
    exactly the mistake this text exists to avoid:

    1. **Which rating.** A selected role means `result_role*` IS that role for every
       row; without one it is each player's stored best-role context, which is why
       the sentence says so rather than naming a single role the page does not have.
       `best_role*` is never read when a role is selected.
    2. **Whether it ordered anything.** Only the RoleFit modes order by that rating.
       Age, Expected Asking and Name order by something else entirely, and saying
       otherwise would be a plain falsehood about what the database did.
    """
    basis_suffix = _ORDERS_THE_PAGE if spec.orders_by_rolefit else _displayed_not_ordered(spec)
    if role_key:
        display = role_display_map.get(role_key, role_key)
        return RankingRoleContext(
            source=RESULT_ROLE_SELECTED,
            role_key=role_key,
            role_display=display,
            label=f"Selected role: {display}",
            detail=_SELECTED_ROLE_BASIS.format(display=display) + basis_suffix,
        )
    return RankingRoleContext(
        source=RESULT_ROLE_BEST,
        role_key=None,
        role_display=None,
        label="Best role for each player",
        detail=_BEST_ROLE_BASIS + basis_suffix,
    )


def _key(position: int, key: discovery_sort.SortKey) -> RankingKey:
    return RankingKey(
        position=position,
        key=key.key,
        label=key.label,
        direction=key.direction,
        direction_label=key.direction_label,
        role=key.role,
        unit=key.unit,
        rule=key.rule,
    )


def build(
    *,
    sort: str,
    role_key: Optional[str],
    role_display_map: dict,
) -> RankingExplanation:
    """The page-level explanation of one request's ordering.

    Depends only on the active sort and the role context, so it is identical for
    every page of the same query and is well-defined even when the result set is
    empty — a request still HAS an active ordering, and "what ranking mode is this?"
    is still the honest answer to give.
    """
    spec = discovery_sort.spec_for(sort)
    keys = [_key(position, key) for position, key in enumerate(spec.keys, start=1)]
    # The reported tie-breakers are DERIVED from the same sequence, through
    # `SortSpec.tie_breakers`, rather than listed independently of it — so they
    # cannot describe a trailing order the SQL does not have.
    trailing = {id(key) for key in spec.tie_breakers}
    tie_breakers = [model for model, key in zip(keys, spec.keys) if id(key) in trailing]

    return RankingExplanation(
        sort=spec.sort,
        sort_label=spec.label,
        direction=spec.direction,
        direction_label=spec.direction_label,
        summary=spec.summary,
        keys=keys,
        role_context=role_context(role_key, role_display_map, spec),
        missing_values=spec.missing_values,
        tie_breakers=tie_breakers,
        limitation=discovery_sort.ORDERING_LIMITATION,
    )
