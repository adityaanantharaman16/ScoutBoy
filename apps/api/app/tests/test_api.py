from __future__ import annotations

from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _first_att_id(client):
    r = client.get("/api/players?position_group=ATT&page_size=5")
    return r.json()["items"][0]["id"]


def _insert_profile_only_player(db_session, *, name="Profile Only Defender", birth_date=None):
    from sqlalchemy import select

    from app.models.orm import Appearance, Competition, Player, Season, Team

    season = db_session.scalar(select(Season).where(Season.is_current.is_(True)))
    team = db_session.scalar(select(Team))
    comp = db_session.scalar(select(Competition))
    player = Player(
        canonical_name=name,
        birth_date=birth_date,
        nationality="Testland",
        primary_position="CB",
        secondary_positions=[],
    )
    db_session.add(player)
    db_session.flush()
    db_session.add(
        Appearance(
            player_id=player.id,
            team_id=team.id,
            competition_id=comp.id,
            season_id=season.id,
            minutes=180,
            appearances=3,
            starts=2,
            position_group="DEF",
        )
    )
    db_session.commit()
    return player.id


def test_development_configuration_keeps_local_admin_optional():
    settings = Settings(
        _env_file=None,
        environment="development",
        admin_token="",
        web_origins="http://localhost:3000",
    )
    assert settings.admin_token == ""
    assert settings.allowed_web_origins == ["http://localhost:3000"]


def test_production_configuration_requires_admin_token():
    with pytest.raises(ValidationError, match="SCOUTBOY_ADMIN_TOKEN"):
        Settings(
            _env_file=None,
            environment="production",
            admin_token="",
            web_origins="https://scoutboy.example",
        )


def test_production_configuration_rejects_wildcard_cors():
    with pytest.raises(ValidationError, match="wildcard"):
        Settings(
            _env_file=None,
            environment="production",
            admin_token="not-a-real-secret",
            web_origins="*",
        )


def test_production_configuration_rejects_embedded_wildcard_cors():
    with pytest.raises(ValidationError, match="wildcard"):
        Settings(
            _env_file=None,
            environment="production",
            admin_token="not-a-real-secret",
            web_origins="https://*.example.test",
        )


def test_production_configuration_accepts_single_https_origin():
    settings = Settings(
        _env_file=None,
        environment="production",
        admin_token="not-a-real-secret",
        web_origins="https://app.example.com",
    )
    assert settings.allowed_web_origins == ["https://app.example.com"]


def test_production_configuration_accepts_multiple_explicit_origins():
    settings = Settings(
        _env_file=None,
        environment="production",
        admin_token="not-a-real-secret",
        web_origins="http://localhost:3000, http://127.0.0.1:3000, https://app.example.com",
    )
    assert settings.allowed_web_origins == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://app.example.com",
    ]


def test_production_configuration_requires_an_explicit_origin():
    with pytest.raises(ValidationError, match="at least one production origin"):
        Settings(
            _env_file=None,
            environment="production",
            admin_token="not-a-real-secret",
            web_origins=" , ",
        )


def test_liveness_is_small_and_database_independent(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_reports_database_success(client):
    with patch(
        "app.api.routes.health.check_database_readiness",
        return_value={"status": "ready", "database": "ready"},
    ):
        response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "ready"}


def test_readiness_hides_database_failure_details(client):
    with patch(
        "app.api.routes.health.check_database_readiness",
        side_effect=RuntimeError("postgresql://user:secret@example.invalid/database"),
    ):
        response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json() == {"detail": {"status": "not_ready", "database": "unavailable"}}


def test_search_paginated_and_deterministic(client):
    r1 = client.get("/api/players?sort=rolefit_desc&page=1&page_size=5")
    assert r1.status_code == 200
    body = r1.json()
    assert set(body) == {"items", "total", "page", "page_size", "total_pages"}
    assert body["total"] > 0
    assert len(body["items"]) <= 5
    # deterministic: same query, same order
    r2 = client.get("/api/players?sort=rolefit_desc&page=1&page_size=5")
    assert [i["id"] for i in r2.json()["items"]] == [i["id"] for i in body["items"]]
    # sorted by score desc
    scores = [i["best_role_score"] or 0 for i in body["items"]]
    assert scores == sorted(scores, reverse=True)
    assert all(i["has_rolefit_analysis"] for i in body["items"])
    assert all(i["analysis_status"] == "analyzed" for i in body["items"])


def test_search_filters_scope_and_playstyle(client):
    att = client.get("/api/players?position_group=ATT&page_size=50").json()
    assert all(i["position_group"] == "ATT" for i in att["items"])
    mid = client.get("/api/players?position_group=MID&page_size=50").json()
    assert all(i["position_group"] == "MID" for i in mid["items"])


def test_scope_filters_and_legacy_universe_aliases(client, db_session):
    _insert_profile_only_player(db_session)
    default = client.get("/api/players?page_size=100").json()
    all_records = client.get("/api/players?scope=all_records&page_size=100").json()
    high = client.get("/api/players?scope=high_coverage_u23&page_size=100").json()
    legacy_mvp = client.get("/api/players?universe=mvp&page_size=100").json()
    legacy_all = client.get("/api/players?universe=all&page_size=100").json()

    assert default["total"] < all_records["total"]
    assert all(i["has_rolefit_analysis"] for i in default["items"])
    assert any(not i["has_rolefit_analysis"] for i in all_records["items"])
    assert [i["id"] for i in legacy_mvp["items"]] == [i["id"] for i in high["items"]]
    assert legacy_all["total"] == all_records["total"]


def test_age_bands_and_unknown_age_handling(client, db_session):
    from datetime import date

    unknown_id = _insert_profile_only_player(db_session, name="Unknown Age Keeper")
    _insert_profile_only_player(db_session, name="Known U23 Defender", birth_date=date(2002, 1, 1))
    all_records = client.get("/api/players?scope=all_records&q=Unknown Age Keeper").json()
    u23 = client.get("/api/players?scope=all_records&age_band=u23&q=Unknown Age Keeper").json()
    known_u23 = client.get(
        "/api/players?scope=all_records&age_band=u23&q=Known U23 Defender"
    ).json()

    assert all_records["items"][0]["id"] == unknown_id
    assert all_records["items"][0]["age"] is None
    assert u23["total"] == 0
    assert known_u23["total"] == 1


def test_role_filter_excludes_profile_only_players(client, db_session):
    _insert_profile_only_player(db_session, name="Unrated Role Filter")
    body = client.get("/api/players?scope=all_records&role=touchline_winger&page_size=100").json()
    assert body["items"]
    assert all(i["has_rolefit_analysis"] and i["best_role"] for i in body["items"])


def test_rolefit_sort_places_unrated_after_rated(client, db_session):
    _insert_profile_only_player(db_session, name="Unrated Sort Tail")
    body = client.get("/api/players?scope=all_records&sort=rolefit_desc&page_size=100").json()
    flags = [i["has_rolefit_analysis"] for i in body["items"]]
    assert flags == sorted(flags, reverse=True)


def test_profile_only_player_card_renders_without_rating(client, db_session):
    pid = _insert_profile_only_player(db_session, name="Profile Only Detail")
    card = client.get(f"/api/players/{pid}").json()
    assert card["identity"]["canonical_name"] == "Profile Only Detail"
    assert card["has_rolefit_analysis"] is False
    assert card["analysis_status"] == "profile_only"
    assert card["evidence_status"] == "profile_only"
    assert card["role_ratings"] == []
    assert card["context"]["minutes"] == 180


def test_player_profile_has_all_required_sections(client):
    pid = _first_att_id(client)
    card = client.get(f"/api/players/{pid}").json()
    for key in (
        "identity",
        "season",
        "confidence",
        "face_stats",
        "substats",
        "role_ratings",
        "playstyles",
        "concerns",
        "market",
        "strengths",
        "concerns_text",
        "context",
        "data_sources",
        "rating_version",
    ):
        assert key in card, f"missing {key}"
    assert card["identity"]["canonical_name"]
    assert card["role_ratings"]
    assert any(r["is_best"] for r in card["role_ratings"])
    # face stats cover the documented categories
    groups = {f["group_key"] for f in card["face_stats"]}
    assert {"attack", "creation", "progression", "dribbling", "defending"}.issubset(groups)


def test_missing_data_is_not_zeroed(client):
    """Face-stat groups with no data are None/unknown, never a zero score."""
    pid = _first_att_id(client)
    card = client.get(f"/api/players/{pid}").json()
    for f in card["face_stats"]:
        if f["score"] is None:
            assert f["confidence"] == "unknown"
        else:
            assert f["score"] > 0  # present groups have a real, non-zero score


def test_player_ratings_include_audit_breakdowns(client):
    pid = _first_att_id(client)
    detail = client.get(f"/api/players/{pid}/ratings").json()
    assert detail["ratings"] and detail["audits"]
    a = detail["audits"][0]
    assert a["metric_breakdown"] and a["context_breakdown"]
    assert a["confidence_breakdown"] and a["explanation_text"]


def test_playstyles_have_why_applied(client):
    pid = _first_att_id(client)
    body = client.get(f"/api/players/{pid}/playstyles").json()
    assert "playstyles" in body and "concerns" in body
    for badge in body["playstyles"]:
        assert badge["why_applied"].get("text")


def test_market_keeps_three_values_separate(client):
    pid = _first_att_id(client)
    m = client.get(f"/api/players/{pid}/market").json()
    assert m["label"] in {"undervalued", "fair", "inflated", "high-risk", "unknown"}
    assert m["model_value_low_eur"] <= m["model_value_high_eur"]
    assert m["expected_asking_low_eur"] <= m["expected_asking_high_eur"]


def test_role_leaderboard_sorted_with_tiebreaks(client):
    lb = client.get("/api/roles/touchline_winger/rankings?limit=20").json()
    assert lb["role_key"] == "touchline_winger"
    ranks = [r["rank"] for r in lb["rows"]]
    assert ranks == list(range(1, len(ranks) + 1))
    scores = [r["final_score"] for r in lb["rows"]]
    assert scores == sorted(scores, reverse=True)


def test_leaderboard_unknown_role_404(client):
    assert client.get("/api/roles/not_a_role/rankings").status_code == 404


def test_compare_two_players(client):
    ids = [
        i["id"] for i in client.get("/api/players?position_group=ATT&page_size=2").json()["items"]
    ]
    r = client.get(f"/api/compare?player_a={ids[0]}&player_b={ids[1]}&role_key=touchline_winger")
    assert r.status_code == 200
    body = r.json()
    assert body["player_a"]["identity"]["id"] == ids[0]
    assert body["stat_rows"]
    assert body["why_higher"]


def test_compare_same_player_400(client):
    pid = _first_att_id(client)
    assert client.get(f"/api/compare?player_a={pid}&player_b={pid}").status_code == 400


def test_similar_players(client):
    pid = _first_att_id(client)
    body = client.get(f"/api/players/{pid}/similar").json()
    keys = {g["key"] for g in body["groups"]}
    assert {"style", "quality", "cheaper", "upside"}.issubset(keys)


def test_methodology(client):
    m = client.get("/api/methodology").json()
    assert m["rating_version"] and m["formula"]
    assert len(m["roles"]) == 9
    assert m["limitations"]
    # Milestone 6: calibration/evidence surface
    cal = m["calibration"]
    assert cal is not None
    assert cal["suite_id"] == "rolefit_calibration"
    assert cal["status"] in ("pass", "warn", "fail", "inconclusive")
    assert cal["benchmarks"]["total"] >= 9
    assert cal["scenarios"]["total"] >= 1
    assert "Leverkusen" in cal["pilot_coverage_limitation"]
    assert cal["config_hash"]
    assert cal["rating_version"]  # present when available


def test_methodology_calibration_unavailable_fallback(client, monkeypatch):
    """When fixture calibration can't run, Methodology still succeeds with an honest
    inconclusive/unavailable calibration block — no fabricated totals, hashes, or versions."""
    from app.services import methodology_service

    def _boom(*args, **kwargs):
        raise RuntimeError("forced calibration failure")

    # get_methodology() is lru_cached: clear before injecting the fault, and restore after so the
    # cached unavailable result cannot contaminate other tests.
    methodology_service.get_methodology.cache_clear()
    monkeypatch.setattr("evaluation.evaluator.evaluate_fixtures", _boom)
    try:
        m = client.get("/api/methodology").json()
        # the page/endpoint stays operational
        assert m["rating_version"] and len(m["roles"]) == 9
        cal = m["calibration"]
        assert cal["available"] is False
        assert cal["status"] == "inconclusive"
        assert cal["benchmarks"]["total"] == 0
        assert cal["scenarios"]["total"] == 0
        # nothing fabricated
        assert cal["config_hash"] is None
        assert cal["suite_id"] is None
        assert cal["suite_version"] is None
        assert cal["rating_version"] is None
        # honest disclosure retained
        assert "unavailable" in cal["methodology_note"].lower()
        assert "Leverkusen" in cal["pilot_coverage_limitation"]
    finally:
        monkeypatch.undo()
        methodology_service.get_methodology.cache_clear()


def test_admin_recompute_creates_a_run(client):
    before = len(client.get("/api/admin/rating-runs").json())
    r = client.post("/api/admin/recompute-ratings")
    assert r.status_code == 200
    assert r.json()["affected"] > 0
    after = client.get("/api/admin/rating-runs").json()
    assert len(after) == before + 1
    assert after[0]["run_type"] == "recompute"
    assert after[0]["status"] == "completed"


def test_admin_data_operations_reads_are_available(client):
    providers = client.get("/api/admin/providers")
    assert providers.status_code == 200
    assert any(row["provider_id"] == "mock_commercial_provider" for row in providers.json())

    runs = client.get("/api/admin/ingestion-runs")
    assert runs.status_code == 200
    assert runs.json() and all(row["run_type"] == "ingest" for row in runs.json())
    detail = client.get(f"/api/admin/ingestion-runs/{runs.json()[0]['id']}")
    assert detail.status_code == 200

    quarantine = client.get("/api/admin/quarantine")
    assert quarantine.status_code == 200
    assert isinstance(quarantine.json(), list)
    assert client.get("/api/admin/freshness").status_code == 200
    coverage = client.get("/api/admin/coverage")
    assert coverage.status_code == 200
    assert coverage.json()["snapshots"]


def test_player_not_found_404(client):
    assert client.get("/api/players/999999").status_code == 404
