from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.schemas import CompareResponse, CompareSide, RoleRatingSummary
from app.repositories import players_repo as repo

from . import _common as C
from .players_service import build_player_card

_CONF_ORDER = {"unknown": 0, "low": 1, "medium": 2, "high": 3}

NO_SHARED_ROLE_MESSAGE = (
    "No shared rated role is available for these players. "
    "Select a role to inspect the available analysis."
)


def _select_automatic_shared_role(
    a_ratings: Optional[list[RoleRatingSummary]],
    b_ratings: Optional[list[RoleRatingSummary]],
) -> Optional[str]:
    """Pick the strongest role both players are *already* rated in.

    This is a presentation/comparison choice over stored ratings — it reads each
    side's persisted ``final_score`` and ``confidence`` as-is and never derives,
    blends, or recomputes a RoleFit rating. Only roles present for both players
    are candidates, so an automatic selection can never leave one side unrated.

    The ordering is symmetric (swapping the players cannot change the result):

    1. highest ``min(a_score, b_score)`` — maximise the weaker side's role fit;
    2. highest ``a_score + b_score`` — stronger joint fit when the floor ties;
    3. highest minimum stored confidence — tie-break only;
    4. lexicographically ascending ``role_key`` — final deterministic tie-break.

    Deliberately *not* "smallest score difference": that could pick a role both
    players fit poorly. Returns ``None`` when there is no shared rated role.
    """
    by_a = {r.role_key: r for r in (a_ratings or [])}
    by_b = {r.role_key: r for r in (b_ratings or [])}
    shared = set(by_a) & set(by_b)
    if not shared:
        return None

    def order(role_key: str) -> tuple:
        ra, rb = by_a[role_key], by_b[role_key]
        floor_conf = min(
            _CONF_ORDER.get(ra.confidence, 0),
            _CONF_ORDER.get(rb.confidence, 0),
        )
        return (
            -min(ra.final_score, rb.final_score),
            -(ra.final_score + rb.final_score),
            -floor_conf,
            role_key,
        )

    return min(shared, key=order)


def _side_from_card(card) -> CompareSide:
    return CompareSide(
        identity=card.identity,
        role_ratings=card.role_ratings,
        substats=card.substats,
        playstyles=card.playstyles,
        market=card.market,
        context=card.context,
        confidence=card.confidence,
    )


def compare_players(
    session: Session, player_a: int, player_b: int, role_key: Optional[str] = None
) -> Optional[CompareResponse]:
    card_a = build_player_card(session, player_a)
    card_b = build_player_card(session, player_b)
    if card_a is None or card_b is None:
        return None
    season = repo.get_current_season(session)

    # normalized side-by-side stat rows keyed by metric
    a_stats = {s.name: s for s in card_a.substats}
    b_stats = {s.name: s for s in card_b.substats}
    stat_rows = []
    for name in sorted(set(a_stats) | set(b_stats)):
        sa, sb = a_stats.get(name), b_stats.get(name)
        stat_rows.append(
            {
                "metric": name,
                "display": (sa or sb).display,
                "unit": (sa or sb).unit,
                "a_per90": sa.per90_value if sa else None,
                "a_percentile": sa.percentile if sa else None,
                "a_score": sa.score if sa else None,
                "b_per90": sb.per90_value if sb else None,
                "b_percentile": sb.percentile if sb else None,
                "b_score": sb.score if sb else None,
            }
        )

    # Choose the comparison role. An explicit request always wins (and may
    # honestly leave one side unrated); otherwise select symmetrically from the
    # roles both players already have a stored rating for.
    automatic = not role_key
    chosen = (
        _select_automatic_shared_role(card_a.role_ratings, card_b.role_ratings)
        if automatic
        else role_key
    )
    ra = next((r for r in card_a.role_ratings if r.role_key == chosen), None)
    rb = next((r for r in card_b.role_ratings if r.role_key == chosen), None)
    role_display = C.role_display_map().get(chosen, chosen) if chosen else None

    why, role_comparison = _why_higher(
        session, season, chosen, player_a, player_b, card_a, card_b, ra, rb, automatic=automatic
    )

    warnings = []
    # Presentation terminology only. The API fields stay `player_a` / `player_b`;
    # the warning text users read says Player 1 / Player 2.
    for card, label in [(card_a, "Player 1"), (card_b, "Player 2")]:
        if _CONF_ORDER.get(card.confidence, 0) <= 1:
            warnings.append(
                f"{label} ({card.identity.canonical_name}) has "
                f"{card.confidence} confidence - interpret with caution."
            )

    return CompareResponse(
        season=season.label if season else "",
        role_key=chosen,
        role_display=role_display,
        player_a=_side_from_card(card_a),
        player_b=_side_from_card(card_b),
        stat_rows=stat_rows,
        role_comparison=role_comparison,
        why_higher=why,
        confidence_warnings=warnings,
    )


def _why_higher(
    session, season, role_key, pid_a, pid_b, card_a, card_b, ra, rb, *, automatic: bool = False
) -> tuple[str, dict]:
    # Three distinct outcomes: (1) an automatic request with no shared rated
    # role, (2) an explicit role one side is not rated in, (3) a real shared-role
    # comparison. Only (3) produces a role_comparison payload.
    if automatic and not role_key:
        return (NO_SHARED_ROLE_MESSAGE, {})
    if not role_key or ra is None or rb is None or season is None:
        return ("Not enough data to compare in a shared role.", {})
    name_a, name_b = card_a.identity.canonical_name, card_b.identity.canonical_name
    role_display = C.role_display_map().get(role_key, role_key)

    if ra.final_score == rb.final_score:
        lead_txt = f"{name_a} and {name_b} rate equally ({ra.final_score:.1f}) as {role_display}."
    else:
        higher, lower = (ra, rb) if ra.final_score > rb.final_score else (rb, ra)
        hi_name = name_a if higher is ra else name_b
        diff_groups = _group_diffs(session, season, role_key, pid_a, pid_b, higher is ra)
        drivers = ", ".join(f"{g['group']} (+{g['delta']:.0f})" for g in diff_groups[:3])
        lead_txt = (
            f"{hi_name} rates higher as {role_display} "
            f"({higher.final_score:.1f} vs {lower.final_score:.1f})"
            + (f", driven by {drivers}." if drivers else ".")
        )

    return lead_txt, {
        "role_key": role_key,
        "role_display": role_display,
        "a": {"final_score": ra.final_score, "confidence": ra.confidence},
        "b": {"final_score": rb.final_score, "confidence": rb.confidence},
    }


def _group_diffs(session, season, role_key, pid_a, pid_b, a_is_higher) -> list[dict]:
    """Group-score deltas (in the higher player's favour) from stored audits."""

    def groups_for(pid):
        ratings = repo.ratings_for_player(session, pid, season.id)
        rr = next((r for r in ratings if r.role_key == role_key), None)
        if not rr:
            return {}
        audit = repo.audits_for_ratings(session, [rr.id]).get(rr.id)
        if not audit:
            return {}
        return {
            g["key"]: g["group_score"]
            for g in (audit.metric_breakdown_json or {}).get("groups", [])
            if g.get("group_score") is not None
        }

    ga, gb = groups_for(pid_a), groups_for(pid_b)
    hi, lo = (ga, gb) if a_is_higher else (gb, ga)
    diffs = []
    for key in set(hi) & set(lo):
        delta = hi[key] - lo[key]
        if delta > 0:
            diffs.append({"group": key.replace("_", " "), "delta": delta})
    diffs.sort(key=lambda d: -d["delta"])
    return diffs
