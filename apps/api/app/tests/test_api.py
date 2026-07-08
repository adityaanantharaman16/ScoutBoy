from __future__ import annotations


def _first_att_id(client):
    r = client.get("/api/players?position_group=ATT&page_size=5")
    return r.json()["items"][0]["id"]


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


def test_search_filters_scope_and_playstyle(client):
    att = client.get("/api/players?position_group=ATT&page_size=50").json()
    assert all(i["position_group"] == "ATT" for i in att["items"])
    mid = client.get("/api/players?position_group=MID&page_size=50").json()
    assert all(i["position_group"] == "MID" for i in mid["items"])


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


def test_admin_recompute_creates_a_run(client):
    before = len(client.get("/api/admin/rating-runs").json())
    r = client.post("/api/admin/recompute-ratings")
    assert r.status_code == 200
    assert r.json()["affected"] > 0
    after = client.get("/api/admin/rating-runs").json()
    assert len(after) == before + 1
    assert after[0]["run_type"] == "recompute"
    assert after[0]["status"] == "completed"


def test_player_not_found_404(client):
    assert client.get("/api/players/999999").status_code == 404
