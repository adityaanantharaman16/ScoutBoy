"""Player search, player card, and similarity assembly."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from scoutboy_shared import MVP_UNIVERSE_KEY as UNIVERSE_KEY
from scoutboy_shared import position_group_for
from sqlalchemy.orm import Session

from app.models.orm import Player, RoleRating
from app.models.schemas import (
    DataSource,
    Paginated,
    PlayerCardResponse,
    PlayerIdentity,
    PlayerSearchCard,
    SimilarGroup,
    SimilarPlayer,
    SimilarResponse,
    StrengthConcern,
)
from app.repositories import players_repo as repo

from . import _common as C

_CONF_ORDER = {"unknown": 0, "low": 1, "medium": 2, "high": 3}


@dataclass
class _Row:
    player: Player
    club: Optional[str]
    club_slug: Optional[str]
    league_slug: Optional[str]
    league_name: Optional[str]
    minutes: int
    position_group: Optional[str]
    age: Optional[float]
    ratings: list[RoleRating]
    best: Optional[RoleRating]
    playstyle_keys: set = field(default_factory=set)
    top_playstyles: list = field(default_factory=list)
    market: object = None


def _load_rows(session: Session, season) -> list[_Row]:
    teams = repo.teams_by_id(session)
    comps = repo.competitions_by_id(session)
    appearances = repo.primary_appearances(session, season.id)
    ratings = repo.ratings_for_season(session, season.id)
    playstyles = repo.playstyles_for_season(session, season.id)
    markets = repo.markets_for_season(session, season.id)

    rows: list[_Row] = []
    for pid, appr in appearances.items():
        player = session.get(Player, pid)
        if player is None:
            continue
        team = teams.get(appr.team_id)
        comp = comps.get(appr.competition_id)
        pg = appr.position_group or position_group_for(player.primary_position or "")
        pls = playstyles.get(pid, [])
        rlist = ratings.get(pid, [])
        rows.append(
            _Row(
                player=player,
                club=team.canonical_name if team else None,
                club_slug=team.slug if team else None,
                league_slug=comp.slug if comp else None,
                league_name=comp.name if comp else None,
                minutes=appr.minutes or 0,
                position_group=pg,
                age=C.age_for(player.birth_date, season.end_date),
                ratings=rlist,
                best=C.best_rating(rlist),
                playstyle_keys={p.playstyle_key for p in pls if not p.is_concern},
                top_playstyles=C.top_playstyle_names(pls),
                market=markets.get(pid),
            )
        )
    return rows


def _to_card(row: _Row) -> PlayerSearchCard:
    m = row.market
    return PlayerSearchCard(
        id=row.player.id,
        canonical_name=row.player.canonical_name,
        age=row.age,
        club=row.club,
        league=row.league_name,
        primary_position=row.player.primary_position,
        position_group=row.position_group,
        best_role=row.best.role_key if row.best else None,
        best_role_display=C.role_display_map().get(row.best.role_key) if row.best else None,
        best_role_score=row.best.final_score if row.best else None,
        confidence=row.best.confidence if row.best else "unknown",
        top_playstyles=row.top_playstyles,
        minutes=row.minutes,
        market_label=getattr(m, "label", None),
        expected_asking_low_eur=getattr(m, "expected_asking_low_eur", None),
        expected_asking_high_eur=getattr(m, "expected_asking_high_eur", None),
    )


def search_players(
    session: Session,
    *,
    q=None,
    age_min=None,
    age_max=None,
    position_group=None,
    role=None,
    league=None,
    club=None,
    nationality=None,
    min_minutes=None,
    rolefit_min=None,
    rolefit_max=None,
    playstyle=None,
    value_min=None,
    value_max=None,
    sort="rolefit_desc",
    universe="mvp",
    page=1,
    page_size=20,
) -> Paginated[PlayerSearchCard]:
    season = repo.get_current_season(session)
    if season is None:
        return Paginated(items=[], total=0, page=page, page_size=page_size, total_pages=0)
    rows = _load_rows(session, season)

    # Default view is the materialized MVP universe (U23 attackers/midfielders in Europe
    # with enough minutes). universe="all" opts out. If the universe has not been
    # materialized yet, do not filter (avoid an empty UI before recompute runs).
    eligible_ids: Optional[set] = None
    if universe == "mvp" and repo.universe_materialized(session, season.id, UNIVERSE_KEY):
        eligible_ids = repo.eligible_universe_ids(session, season.id, UNIVERSE_KEY)

    def score_for(row: _Row) -> Optional[float]:
        if role:
            rr = next((r for r in row.ratings if r.role_key == role), None)
            return rr.final_score if rr else None
        return row.best.final_score if row.best else None

    def keep(row: _Row) -> bool:
        if eligible_ids is not None and row.player.id not in eligible_ids:
            return False
        if q:
            ql = q.lower()
            hay = " ".join(
                filter(
                    None,
                    [
                        row.player.canonical_name,
                        row.club,
                        row.league_name,
                        row.player.primary_position,
                    ],
                )
            ).lower()
            if ql not in hay:
                return False
        if position_group and row.position_group != position_group:
            return False
        if role and not any(r.role_key == role for r in row.ratings):
            return False
        if (
            league
            and league.lower()
            not in " ".join(filter(None, [row.league_slug, row.league_name])).lower()
        ):
            return False
        if club and club.lower() not in " ".join(filter(None, [row.club_slug, row.club])).lower():
            return False
        if nationality and (row.player.nationality or "").lower() != nationality.lower():
            return False
        if min_minutes is not None and row.minutes < min_minutes:
            return False
        if age_min is not None and (row.age is None or row.age < age_min):
            return False
        if age_max is not None and (row.age is None or row.age > age_max):
            return False
        s = score_for(row)
        if rolefit_min is not None and (s is None or s < rolefit_min):
            return False
        if rolefit_max is not None and (s is None or s > rolefit_max):
            return False
        if playstyle and playstyle not in row.playstyle_keys:
            return False
        if value_min is not None and (
            row.market is None or (row.market.expected_asking_high_eur or 0) < value_min
        ):
            return False
        if value_max is not None and (
            row.market is None or (row.market.expected_asking_low_eur or 0) > value_max
        ):
            return False
        return True

    filtered = [r for r in rows if keep(r)]

    # deterministic sort with explicit tie-breaks
    def sort_key(row: _Row):
        s = score_for(row) or 0.0
        conf = _CONF_ORDER.get(row.best.confidence if row.best else "unknown", 0)
        asking = row.market.expected_asking_high_eur if row.market else 0.0
        name = row.player.canonical_name.lower()
        pid = row.player.id
        primary = {
            "rolefit_desc": (-s, -conf),
            "rolefit_asc": (s, -conf),
            "age_asc": (row.age if row.age is not None else 999,),
            "age_desc": (-(row.age if row.age is not None else -1),),
            "value_desc": (-(asking or 0),),
            "value_asc": (asking or 0,),
            "name_asc": (name,),
        }.get(sort, (-s, -conf))
        return (*primary, name, pid)

    filtered.sort(key=sort_key)

    total = len(filtered)
    start = (page - 1) * page_size
    page_items = filtered[start : start + page_size]
    return Paginated(
        items=[_to_card(r) for r in page_items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if page_size else 0,
    )


def _strengths_concerns(audit) -> tuple[list[StrengthConcern], list[StrengthConcern]]:
    strengths, concerns = [], []
    if audit is None:
        return strengths, concerns
    groups = (audit.metric_breakdown_json or {}).get("groups", [])
    scored = [g for g in groups if g.get("group_score") is not None]
    for g in sorted(scored, key=lambda g: g["group_score"], reverse=True)[:3]:
        if g["group_score"] >= 65:
            strengths.append(
                StrengthConcern(
                    label=g["key"].replace("_", " ").title(),
                    detail=f"{g['group_score']:.0f}/100 in {g['key'].replace('_', ' ')} for this role.",
                    score=g["group_score"],
                )
            )
    for g in sorted(scored, key=lambda g: g["group_score"])[:2]:
        if g["group_score"] <= 35:
            concerns.append(
                StrengthConcern(
                    label=f"Weak {g['key'].replace('_', ' ')}",
                    detail=f"Only {g['group_score']:.0f}/100 in {g['key'].replace('_', ' ')}.",
                )
            )
    for p in (audit.penalties_json or {}).get("items", []):
        concerns.append(
            StrengthConcern(
                label=p["key"].replace("_", " ").title(), detail=p.get("explanation", "")
            )
        )
    return strengths, concerns


def build_player_card(session: Session, player_id: int) -> Optional[PlayerCardResponse]:
    player = repo.get_player(session, player_id)
    if player is None:
        return None
    season = repo.get_current_season(session)
    if season is None:
        return None

    appr = repo.primary_appearances(session, season.id).get(player_id)
    teams = repo.teams_by_id(session)
    comps = repo.competitions_by_id(session)
    club = league = None
    minutes = 0
    if appr:
        team = teams.get(appr.team_id)
        comp = comps.get(appr.competition_id)
        club = team.canonical_name if team else None
        league = comp.name if comp else None
        minutes = appr.minutes or 0

    normalized = repo.normalized_for_player(session, player_id, season.id)
    ratings = repo.ratings_for_player(session, player_id, season.id)
    playstyles = repo.playstyles_for_player(session, player_id, season.id)
    market = repo.market_for_player(session, player_id, season.id)
    ctx = repo.contexts_for_season(session, season.id).get(player_id)
    sources = repo.source_ids_for_player(session, player_id)
    evidence_rows = repo.evidence_for_player(session, player_id, season.id)
    primary_evidence = (
        sorted(evidence_rows, key=lambda e: (-(e.minutes or 0), e.provider_id))[0]
        if evidence_rows
        else None
    )
    providers = repo.providers_by_id(session) if evidence_rows else {}
    snapshot_ids = {
        e.source_snapshot_record_id
        for e in evidence_rows
        if e.source_snapshot_record_id is not None
    }
    snapshots = repo.source_snapshots_by_id(session, snapshot_ids)
    primary_provider = providers.get(primary_evidence.provider_id) if primary_evidence else None
    primary_snapshot = (
        snapshots.get(primary_evidence.source_snapshot_record_id)
        if primary_evidence and primary_evidence.source_snapshot_record_id
        else None
    )

    substats = C.substats_from_normalized(normalized)
    sample_conf = ctx.context_confidence if ctx else "unknown"
    face_stats = C.face_stats_from_substats(substats, sample_conf)
    role_summaries = C.role_summaries(ratings)
    best = C.best_rating(ratings)
    positives, concern_badges = C.playstyle_badges(playstyles)

    strengths, concerns_text = [], []
    if best:
        audit = repo.audits_for_ratings(session, [best.id]).get(best.id)
        strengths, concerns_text = _strengths_concerns(audit)

    identity = PlayerIdentity(
        id=player.id,
        canonical_name=player.canonical_name,
        age=C.age_for(player.birth_date, season.end_date),
        birth_date=player.birth_date.isoformat() if player.birth_date else None,
        nationality=player.nationality,
        preferred_foot=player.preferred_foot,
        height_cm=player.height_cm,
        primary_position=player.primary_position,
        secondary_positions=player.secondary_positions or [],
        position_group=(
            appr.position_group if appr else position_group_for(player.primary_position or "")
        ),
        club=club,
        league=league,
    )

    overall_conf = best.confidence if best else "unknown"
    return PlayerCardResponse(
        identity=identity,
        season=season.label,
        confidence=overall_conf,
        best_role=best.role_key if best else None,
        face_stats=face_stats,
        substats=substats,
        role_ratings=role_summaries,
        playstyles=positives,
        concerns=concern_badges,
        market=C.market_panel(market),
        strengths=strengths,
        concerns_text=concerns_text,
        context=C.context_panel(
            ctx,
            minutes,
            evidence=primary_evidence,
            provider=primary_provider,
            snapshot=primary_snapshot,
            uses_modeled_values=bool(ratings),
        ),
        data_sources=[
            DataSource(
                source_name=s.source_name,
                source_player_id=s.source_player_id,
                source_url=s.source_url,
                data_type="demo" if s.source_name == "sample" else None,
            )
            for s in sources
        ]
        + [
            DataSource(
                source_name=p.slug,
                provider_display_name=p.name,
                data_type=p.provider_type,
                last_updated=(
                    snapshots[e.source_snapshot_record_id].as_of_date.isoformat()
                    if e.source_snapshot_record_id in snapshots
                    and snapshots[e.source_snapshot_record_id].as_of_date
                    else None
                ),
                license_url=p.license_url,
                attribution=p.attribution,
            )
            for e in evidence_rows
            for p in [providers.get(e.provider_id)]
            if p is not None
        ],
        last_updated=player.updated_at.isoformat() if player.updated_at else None,
        rating_version=best.version if best else None,
    )


def find_similar(session: Session, player_id: int, limit: int = 5) -> Optional[SimilarResponse]:
    from app.models.orm import SimilarityVector

    season = repo.get_current_season(session)
    if season is None or repo.get_player(session, player_id) is None:
        return None
    vectors = {
        (v.player_id, v.vector_type): v.vector_json
        for v in session.query(SimilarityVector).filter(SimilarityVector.season_id == season.id)
    }
    style_target = vectors.get((player_id, "style"))
    if not style_target:
        return SimilarResponse(player_id=player_id, season=season.label, groups=[])

    rows = {r.player.id: r for r in _load_rows(session, season)}
    target = rows.get(player_id)
    target_pg = target.position_group if target else None

    def cosine(a: dict, b: dict) -> float:
        keys = set(a) & set(b)
        if not keys:
            return 0.0
        dot = sum(a[k] * b[k] for k in keys)
        na = math.sqrt(sum(v * v for v in a.values()))
        nb = math.sqrt(sum(v * v for v in b.values()))
        return dot / (na * nb) if na and nb else 0.0

    scored = []
    for pid, row in rows.items():
        if pid == player_id or row.position_group != target_pg:
            continue
        vec = vectors.get((pid, "style"))
        if not vec:
            continue
        scored.append((cosine(style_target, vec), row))
    scored.sort(key=lambda x: (-x[0], x[1].player.canonical_name.lower(), x[1].player.id))

    def sp(sim, row, reason):
        m = row.market
        return SimilarPlayer(
            player_id=row.player.id,
            canonical_name=row.player.canonical_name,
            club=row.club,
            league=row.league_name,
            age=row.age,
            best_role=row.best.role_key if row.best else None,
            best_role_score=row.best.final_score if row.best else None,
            similarity=round(sim, 3),
            expected_asking_low_eur=getattr(m, "expected_asking_low_eur", None),
            expected_asking_high_eur=getattr(m, "expected_asking_high_eur", None),
            reason=reason,
        )

    style_comps = [sp(s, r, "Similar statistical profile") for s, r in scored[:limit]]

    target_score = target.best.final_score if target and target.best else 0.0
    target_ask = target.market.expected_asking_high_eur if target and target.market else None
    quality = sorted(
        [(s, r) for s, r in scored if s >= 0.5],
        key=lambda x: (-(x[1].best.final_score if x[1].best else 0), x[1].player.id),
    )
    quality_comps = [sp(s, r, "Similar profile, comparable quality") for s, r in quality[:limit]]
    cheaper = [
        sp(s, r, "Similar profile, lower expected asking price")
        for s, r in scored
        if r.market and target_ask and (r.market.expected_asking_high_eur or 0) < target_ask
    ][:limit]
    upside = [
        sp(s, r, "Similar profile, higher RoleFit upside")
        for s, r in scored
        if r.best and r.best.final_score > target_score
    ][:limit]

    return SimilarResponse(
        player_id=player_id,
        season=season.label,
        groups=[
            SimilarGroup(
                key="style",
                label="Style comps",
                description="Closest statistical style within the same position group.",
                players=style_comps,
            ),
            SimilarGroup(
                key="quality",
                label="Quality comps",
                description="Stylistically similar and of comparable rated quality.",
                players=quality_comps,
            ),
            SimilarGroup(
                key="cheaper",
                label="Similar but cheaper",
                description="Similar style at a lower expected asking price.",
                players=cheaper,
            ),
            SimilarGroup(
                key="upside",
                label="Higher upside",
                description="Similar style with a higher RoleFit score.",
                players=upside,
            ),
        ],
    )
