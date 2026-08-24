"""Milestone 8.4B: saved Discovery views and saved comparison setups.

Structured the same way the 8.4A favourites suite is: prove the gate, then prove
the collection. Every test here mints a real RS256 token against an in-process key
pair (see `account_auth`), so signature, expiry, issuer and authorized-party
checks are genuinely exercised rather than stubbed out - there is no path in this
file that skips verification.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, inspect, select

from app.core.auth import get_token_verifier
from app.main import app
from app.models.orm import AppUser, Player, SavedComparison, SavedDiscoveryView, UserFavorite
from app.models.schemas.saved_work import MAX_COLLECTION_ITEMS, MAX_MERGE_ITEMS
from app.services import saved_work_service
from app.tests.account_auth import IdentityHarness, auth_header, build_test_verifier

VIEWS = "/api/me/saved-views"
COMPARISONS = "/api/me/saved-comparisons"

#: Strings that must be storable as inert text and must never become markup.
XSS_LABELS = [
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
    "javascript:alert(1)",
    '"><svg/onload=alert(1)>',
]


def cid() -> str:
    """A fresh client id, in the canonical hyphenated form the contract requires."""
    return str(uuid.uuid4())


@pytest.fixture(scope="module")
def harness() -> IdentityHarness:
    return IdentityHarness()


@pytest.fixture()
def auth_client(_seeded, harness):
    """A client whose verifier is anchored to the harness's local key set.

    Overriding `get_token_verifier` - not `get_current_user` - is the point: a
    request still has to carry a token that passes every signature and claim check
    before an account is resolved.
    """
    app.dependency_overrides[get_token_verifier] = lambda: build_test_verifier(harness)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_token_verifier, None)


@pytest.fixture(autouse=True)
def _clean_accounts(_seeded):
    """Each test starts from empty account tables, so ordering assertions are real."""
    from app.core.db import SessionLocal

    with SessionLocal() as session:
        session.execute(delete(SavedComparison))
        session.execute(delete(SavedDiscoveryView))
        session.execute(delete(UserFavorite))
        session.execute(delete(AppUser))
        session.commit()
    yield


def _session():
    from app.core.db import SessionLocal

    return SessionLocal()


def _account_count() -> int:
    with _session() as session:
        return len(list(session.scalars(select(AppUser.id))))


def _player_ids(client, count: int) -> list:
    items = client.get(f"/api/players?page_size={count}").json()["items"]
    ids = [item["id"] for item in items]
    assert len(ids) == count, "sample fixture is too small for this test"
    return ids


def _save_view(client, token, *, label="Cohort", filters=None, client_id=None):
    return client.post(
        VIEWS,
        headers=auth_header(token),
        json={"client_id": client_id or cid(), "label": label, "filters": filters or {}},
    )


def _save_comparison(client, token, a, b, *, label="Duel", role=None, client_id=None):
    return client.post(
        COMPARISONS,
        headers=auth_header(token),
        json={
            "client_id": client_id or cid(),
            "label": label,
            "player_a_id": a,
            "player_b_id": b,
            "player_a_label": f"Player {a}",
            "player_b_label": f"Player {b}",
            "role_key": role,
        },
    )


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------


def test_saved_work_endpoints_reject_missing_authentication(auth_client):
    unauthenticated = [
        ("get", VIEWS, None),
        ("post", VIEWS, {"client_id": cid(), "label": "x", "filters": {}}),
        ("patch", f"{VIEWS}/{cid()}", {"label": "x"}),
        ("delete", f"{VIEWS}/{cid()}", None),
        ("post", f"{VIEWS}/merge", {"items": []}),
        ("get", COMPARISONS, None),
        (
            "post",
            COMPARISONS,
            {
                "client_id": cid(),
                "label": "x",
                "player_a_id": 1,
                "player_b_id": 2,
                "player_a_label": "A",
                "player_b_label": "B",
            },
        ),
        ("patch", f"{COMPARISONS}/{cid()}", {"label": "x"}),
        ("delete", f"{COMPARISONS}/{cid()}", None),
        ("post", f"{COMPARISONS}/merge", {"items": []}),
    ]
    for method, path, body in unauthenticated:
        response = getattr(auth_client, method)(path, **({"json": body} if body else {}))
        assert response.status_code == 401, f"{method.upper()} {path}"
        assert response.headers.get("WWW-Authenticate") == "Bearer"


def test_a_forged_token_cannot_reach_saved_work(auth_client, harness):
    """Correct shape, correct claims, wrong signer."""
    forged = harness.token("user_forged", key=harness.attacker_key)
    assert auth_client.get(VIEWS, headers=auth_header(forged)).status_code == 401
    assert auth_client.get(COMPARISONS, headers=auth_header(forged)).status_code == 401


def test_an_expired_token_cannot_reach_saved_work(auth_client, harness):
    expired = harness.token("user_expired", expires_in=-30)
    assert auth_client.get(VIEWS, headers=auth_header(expired)).status_code == 401


def test_a_token_for_another_front_end_is_not_honoured(auth_client, harness):
    """`azp` is Clerk's documented CSRF defence and is required, not optional."""
    other = harness.token("user_azp", azp="https://someone-elses-app.example")
    assert auth_client.get(VIEWS, headers=auth_header(other)).status_code == 401


# ---------------------------------------------------------------------------
# Reads and no-ops write nothing
# ---------------------------------------------------------------------------


def test_reading_saved_work_verifies_the_identity_without_writing_anything(auth_client, harness):
    token = harness.token("user_reader")
    for path in (VIEWS, COMPARISONS):
        response = auth_client.get(path, headers=auth_header(token))
        assert response.status_code == 200
        assert response.json() == {"items": [], "count": 0}
    assert _account_count() == 0, "a read must not materialize an account row"


def test_a_no_op_delete_creates_no_account_row(auth_client, harness):
    token = harness.token("user_deleter")
    for path in (VIEWS, COMPARISONS):
        response = auth_client.delete(f"{path}/{cid()}", headers=auth_header(token))
        assert response.status_code == 200
        assert response.json()["disposition"] == "unchanged"
        assert response.json()["items"] == []
    assert _account_count() == 0


def test_renaming_a_nonexistent_item_404s_and_creates_no_account_row(auth_client, harness):
    token = harness.token("user_renamer")
    for path in (VIEWS, COMPARISONS):
        response = auth_client.patch(
            f"{path}/{cid()}", headers=auth_header(token), json={"label": "New name"}
        )
        assert response.status_code == 404
    assert _account_count() == 0


def test_an_empty_merge_creates_no_account_row(auth_client, harness):
    token = harness.token("user_empty_merge")
    for path in (VIEWS, COMPARISONS):
        response = auth_client.post(f"{path}/merge", headers=auth_header(token), json={"items": []})
        assert response.status_code == 200
        assert response.json() == {
            "items": [],
            "count": 0,
            "added": [],
            "already_present": [],
            "rejected": [],
        }
    assert _account_count() == 0


def test_a_merge_whose_every_item_is_invalid_creates_no_account_row(auth_client, harness):
    """Rejected-only is still a merge that stores nothing, so it must leave no trace."""
    token = harness.token("user_all_invalid")
    response = auth_client.post(
        f"{VIEWS}/merge",
        headers=auth_header(token),
        json={
            "items": [{"client_id": cid(), "label": "Stale", "filters": {"role": "retired_role"}}]
        },
    )
    assert response.status_code == 200
    assert response.json()["added"] == []
    assert [r["reason"] for r in response.json()["rejected"]] == ["unknown role"]
    assert _account_count() == 0


def test_the_first_actual_save_lazily_creates_exactly_one_account(auth_client, harness):
    token = harness.token("user_first_save")
    assert _account_count() == 0
    assert _save_view(auth_client, token).status_code == 200
    assert _account_count() == 1
    # A second save reuses it rather than racing a duplicate into existence.
    assert (
        _save_view(auth_client, token, label="Another", filters={"role": "advanced_8"}).status_code
        == 200
    )
    assert _account_count() == 1


def test_a_merge_with_something_to_store_creates_the_account_it_needs(auth_client, harness):
    token = harness.token("user_merge_creates")
    response = auth_client.post(
        f"{VIEWS}/merge",
        headers=auth_header(token),
        json={"items": [{"client_id": cid(), "label": "From device", "filters": {"age_max": 22}}]},
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert _account_count() == 1


# ---------------------------------------------------------------------------
# Saved Discovery views
# ---------------------------------------------------------------------------


def test_a_saved_view_round_trips_every_representable_filter(auth_client, harness):
    token = harness.token("user_full_filters")
    filters = {
        "q": "Anton",
        "position_group": "ATT",
        "role": "touchline_winger",
        "league": "Bundesliga",
        "club": "Stuttgart",
        "nationality": "Germany",
        "playstyle": "technical_carrier",
        "age_max": 22,
        "min_minutes": 900,
        "rolefit_min": 60,
        "rolefit_max": 95,
        "value_min": 1_000_000,
        "value_max": 25_000_000,
        "sort": "rolefit_asc",
        "page_size": 24,
    }
    saved = _save_view(auth_client, token, label="Full cohort", filters=filters)
    assert saved.status_code == 200, saved.text
    assert saved.json()["disposition"] == "created"
    assert saved.json()["item"]["filters"] == {**filters, "age_min": None}

    listed = auth_client.get(VIEWS, headers=auth_header(token)).json()
    assert listed["count"] == 1
    assert listed["items"][0]["filters"]["club"] == "Stuttgart"


def test_absent_criteria_are_stored_as_absent_not_as_empty_strings(auth_client, harness):
    token = harness.token("user_defaults")
    saved = _save_view(auth_client, token, label="Everything", filters={})
    stored = saved.json()["item"]["filters"]
    assert set(stored.values()) == {None}, "an unfiltered view stores no criterion at all"


@pytest.mark.parametrize(
    "filters,reason",
    [
        ({"role": "no_such_role"}, "unknown role"),
        ({"sort": "no_such_sort"}, "unknown sort"),
        ({"playstyle": "no_such_playstyle"}, "unknown playstyle"),
        ({"position_group": "XYZ"}, "unknown position group"),
    ],
)
def test_an_unrepresentable_key_is_refused_rather_than_stored(
    auth_client, harness, filters, reason
):
    token = harness.token("user_bad_keys")
    response = _save_view(auth_client, token, filters=filters)
    assert response.status_code == 422
    assert reason in response.text


@pytest.mark.parametrize(
    "filters",
    [
        {"scope": "analyzed"},
        {"universe": "mvp"},
        {"age_band": "u23"},
        {"page": 3},
        {"rolefit_min": 80, "rolefit_max": 20},
        {"age_min": 19, "age_max": 25},
        {"age_max": 24},
        {"min_minutes": 99_999},
        {"rolefit_min": 500},
    ],
)
def test_a_filter_state_the_rail_cannot_produce_is_rejected(auth_client, harness, filters):
    """Retired parameters, pagination, incoherent pairs and off-stop age bounds."""
    token = harness.token("user_canonical_form")
    assert _save_view(auth_client, token, filters=filters).status_code == 422


def test_saving_the_same_configuration_again_updates_instead_of_duplicating(auth_client, harness):
    token = harness.token("user_dupe_view")
    filters = {"role": "advanced_8", "age_max": 25}

    first = _save_view(auth_client, token, label="Young 8s", filters=filters)
    assert first.json()["disposition"] == "created"
    original_id = first.json()["item"]["client_id"]

    # Same cohort, different client id and a new name: one view, renamed.
    again = _save_view(auth_client, token, label="Young 8s (revised)", filters=filters)
    assert again.json()["disposition"] == "updated"
    assert again.json()["count"] == 1
    assert again.json()["item"]["client_id"] == original_id, "the account keeps its own id"
    assert again.json()["item"]["label"] == "Young 8s (revised)"

    # Byte-identical repeat: nothing changed, and it says so.
    third = _save_view(auth_client, token, label="Young 8s (revised)", filters=filters)
    assert third.json()["disposition"] == "unchanged"
    assert third.json()["count"] == 1


def test_field_order_does_not_change_a_views_identity(auth_client, harness):
    token = harness.token("user_field_order")
    _save_view(auth_client, token, filters={"role": "advanced_8", "age_max": 25})
    second = _save_view(auth_client, token, filters={"age_max": 25, "role": "advanced_8"})
    assert second.json()["count"] == 1


def test_retrying_a_create_with_the_same_client_id_does_not_duplicate(auth_client, harness):
    token = harness.token("user_retry_view")
    stable = cid()
    _save_view(auth_client, token, label="First", filters={"club": "Stuttgart"}, client_id=stable)
    # A retry that also revises the filters lands on the same row.
    retried = _save_view(
        auth_client, token, label="First", filters={"club": "Bayern"}, client_id=stable
    )
    assert retried.json()["count"] == 1
    assert retried.json()["item"]["filters"]["club"] == "Bayern"


def test_views_are_renamed_and_removed_by_client_id(auth_client, harness):
    token = harness.token("user_crud_view")
    stable = cid()
    _save_view(auth_client, token, label="Before", client_id=stable, filters={"club": "Ajax"})

    renamed = auth_client.patch(
        f"{VIEWS}/{stable}", headers=auth_header(token), json={"label": "  After  "}
    )
    assert renamed.status_code == 200
    assert renamed.json()["item"]["label"] == "After", "the label is trimmed"

    removed = auth_client.delete(f"{VIEWS}/{stable}", headers=auth_header(token))
    assert removed.json()["disposition"] == "removed"
    assert removed.json()["count"] == 0

    # Idempotent: removing it again is a success that changed nothing.
    again = auth_client.delete(f"{VIEWS}/{stable}", headers=auth_header(token))
    assert again.json()["disposition"] == "unchanged"


def test_saved_views_keep_a_deterministic_order(auth_client, harness):
    token = harness.token("user_view_order")
    labels = ["First", "Second", "Third", "Fourth"]
    for index, label in enumerate(labels):
        _save_view(auth_client, token, label=label, filters={"rolefit_min": 50 + index})

    listed = auth_client.get(VIEWS, headers=auth_header(token)).json()
    assert [item["label"] for item in listed["items"]] == labels
    # Stable across repeated reads, which is what the (created_at, id) index buys.
    repeat = auth_client.get(VIEWS, headers=auth_header(token)).json()
    assert repeat["items"] == listed["items"]


# ---------------------------------------------------------------------------
# Saved comparison setups
# ---------------------------------------------------------------------------


def test_a_comparison_setup_stores_participants_and_role_but_no_analysis(auth_client, harness):
    token = harness.token("user_comparison")
    a, b = _player_ids(auth_client, 2)

    saved = _save_comparison(auth_client, token, a, b, label="Wing duel", role="touchline_winger")
    assert saved.status_code == 200, saved.text
    item = saved.json()["item"]
    assert item["player_a"] == {"player_id": a, "label": f"Player {a}", "available": True}
    assert item["player_b"] == {"player_id": b, "label": f"Player {b}", "available": True}
    assert item["role_key"] == "touchline_winger"
    # Nothing analytical is persisted: no score, conclusion, confidence or evidence.
    assert not {"score", "conclusion", "confidence", "evidence"} & set(item)


def test_automatic_role_is_stored_as_null_not_a_sentinel(auth_client, harness):
    token = harness.token("user_auto_role")
    a, b = _player_ids(auth_client, 2)
    saved = _save_comparison(auth_client, token, a, b, label="Auto")
    assert saved.json()["item"]["role_key"] is None


def test_side_order_is_part_of_a_comparisons_identity(auth_client, harness):
    """`a=7&b=5` is not silently rewritten as `a=5&b=7`."""
    token = harness.token("user_side_order")
    a, b = _player_ids(auth_client, 2)

    _save_comparison(auth_client, token, a, b, label="A then B")
    flipped = _save_comparison(auth_client, token, b, a, label="B then A")
    assert flipped.json()["disposition"] == "created"
    assert flipped.json()["count"] == 2, "the reversed pair is a different saved setup"


def test_the_selected_role_is_part_of_a_comparisons_identity(auth_client, harness):
    token = harness.token("user_role_identity")
    a, b = _player_ids(auth_client, 2)
    _save_comparison(auth_client, token, a, b, label="Automatic")
    with_role = _save_comparison(auth_client, token, a, b, label="In role", role="advanced_8")
    assert with_role.json()["count"] == 2


def test_saving_the_same_setup_again_updates_instead_of_duplicating(auth_client, harness):
    token = harness.token("user_dupe_comparison")
    a, b = _player_ids(auth_client, 2)
    first = _save_comparison(auth_client, token, a, b, label="Duel", role="advanced_8")
    again = _save_comparison(auth_client, token, a, b, label="Duel, revised", role="advanced_8")
    assert again.json()["disposition"] == "updated"
    assert again.json()["count"] == 1
    assert again.json()["item"]["client_id"] == first.json()["item"]["client_id"]


@pytest.mark.parametrize(
    "payload_patch",
    [
        {"player_a_id": 0},
        {"player_a_id": -3},
        {"role_key": "no_such_role"},
    ],
)
def test_an_invalid_comparison_setup_is_refused(auth_client, harness, payload_patch):
    token = harness.token("user_bad_comparison")
    a, b = _player_ids(auth_client, 2)
    body = {
        "client_id": cid(),
        "label": "Bad",
        "player_a_id": a,
        "player_b_id": b,
        "player_a_label": "A",
        "player_b_label": "B",
        **payload_patch,
    }
    assert auth_client.post(COMPARISONS, headers=auth_header(token), json=body).status_code == 422


def test_two_of_the_same_player_is_refused(auth_client, harness):
    token = harness.token("user_same_player")
    (a,) = _player_ids(auth_client, 1)
    assert _save_comparison(auth_client, token, a, a).status_code == 422


def test_a_player_that_does_not_exist_is_refused_at_save_time(auth_client, harness):
    """A stale device artifact must not manufacture the unavailable state."""
    token = harness.token("user_stale_player")
    (a,) = _player_ids(auth_client, 1)
    response = _save_comparison(auth_client, token, a, 9_876_543)
    assert response.status_code == 422
    assert "player not found" in response.text


def test_a_player_removed_afterwards_leaves_the_setup_visible_and_honest(auth_client, harness):
    """The saved work survives; the missing side is named, never fabricated."""
    token = harness.token("user_deleted_player")
    a, b = _player_ids(auth_client, 2)
    _save_comparison(auth_client, token, a, b, label="Duel")

    with _session() as session:
        session.execute(delete(Player).where(Player.id == b))
        session.commit()

    try:
        listed = auth_client.get(COMPARISONS, headers=auth_header(token)).json()
        assert listed["count"] == 1, "the saved setup is not silently deleted"
        item = listed["items"][0]
        assert item["player_a"]["available"] is True
        assert item["player_b"] == {
            "player_id": None,
            "label": f"Player {b}",
            "available": False,
        }, "the unavailable side keeps the name it was saved under, with no id"

        # It stays renameable and removable while unavailable.
        renamed = auth_client.patch(
            f"{COMPARISONS}/{item['client_id']}",
            headers=auth_header(token),
            json={"label": "Duel (one side gone)"},
        )
        assert renamed.status_code == 200
        assert renamed.json()["item"]["player_b"]["available"] is False
    finally:
        # The fixture DB is session-scoped, so put the player back for other tests.
        with _session() as session:
            session.execute(delete(SavedComparison))
            session.commit()


# ---------------------------------------------------------------------------
# Ownership isolation
# ---------------------------------------------------------------------------


def test_one_account_never_sees_anothers_saved_work(auth_client, harness):
    alice = harness.token("user_alice")
    bob = harness.token("user_bob")
    a, b = _player_ids(auth_client, 2)

    _save_view(auth_client, alice, label="Alice cohort", filters={"club": "Ajax"})
    _save_comparison(auth_client, alice, a, b, label="Alice duel")

    assert auth_client.get(VIEWS, headers=auth_header(bob)).json() == {"items": [], "count": 0}
    assert auth_client.get(COMPARISONS, headers=auth_header(bob)).json() == {
        "items": [],
        "count": 0,
    }


def test_one_account_cannot_address_anothers_item_by_client_id(auth_client, harness):
    """A well-formed id belonging to somebody else resolves to nothing, not to their row."""
    alice = harness.token("user_alice_owner")
    bob = harness.token("user_bob_intruder")
    stable = cid()
    _save_view(auth_client, alice, label="Private", client_id=stable, filters={"club": "Ajax"})

    stolen_rename = auth_client.patch(
        f"{VIEWS}/{stable}", headers=auth_header(bob), json={"label": "Owned"}
    )
    assert stolen_rename.status_code == 404

    stolen_delete = auth_client.delete(f"{VIEWS}/{stable}", headers=auth_header(bob))
    assert stolen_delete.status_code == 200
    assert stolen_delete.json()["disposition"] == "unchanged"

    # Alice's view is untouched, under its original name.
    alice_list = auth_client.get(VIEWS, headers=auth_header(alice)).json()
    assert alice_list["count"] == 1
    assert alice_list["items"][0]["label"] == "Private"


def test_the_same_subject_from_a_different_issuer_is_a_different_account(auth_client, harness):
    """A subject is only unique within its issuing tenant."""
    from app.core.auth import VerifiedIdentity as VI
    from app.core.auth import find_app_user

    token = harness.token("user_shared_subject")
    _save_view(auth_client, token, label="Tenant A", filters={"club": "Ajax"})

    with _session() as session:
        other_tenant = find_app_user(
            session,
            VI(issuer="https://other-tenant.clerk.accounts.dev", subject="user_shared_subject"),
        )
    assert other_tenant is None


def test_the_service_layer_takes_an_account_object_never_an_id():
    """Cross-account access is unrepresentable, not merely forbidden."""
    import inspect as _inspect

    for name in (
        "list_views",
        "upsert_view",
        "rename_view",
        "remove_view",
        "merge_views",
        "list_comparisons",
        "upsert_comparison",
        "rename_comparison",
        "remove_comparison",
        "merge_comparisons",
    ):
        signature = _inspect.signature(getattr(saved_work_service, name))
        assert "user" in signature.parameters, name
        annotation = str(signature.parameters["user"].annotation)
        assert "AppUser" in annotation, f"{name} must take the account object, not an id"
        assert not any(
            param in signature.parameters
            for param in ("user_id", "owner_id", "subject", "external_subject")
        ), f"{name} must not accept an owner as data"


# ---------------------------------------------------------------------------
# Merge semantics
# ---------------------------------------------------------------------------


def test_a_merge_appends_new_device_views_and_leaves_account_labels_alone(auth_client, harness):
    token = harness.token("user_merge_views")
    account_id = cid()
    _save_view(
        auth_client, token, label="Account name", client_id=account_id, filters={"club": "Ajax"}
    )

    device_same = cid()
    device_new = cid()
    merged = auth_client.post(
        f"{VIEWS}/merge",
        headers=auth_header(token),
        json={
            "items": [
                # Same cohort as the account already holds, under a different name.
                {"client_id": device_same, "label": "Device name", "filters": {"club": "Ajax"}},
                {"client_id": device_new, "label": "Device only", "filters": {"club": "Bayern"}},
            ]
        },
    )
    body = merged.json()
    assert body["already_present"] == [device_same]
    assert body["added"] == [device_new]
    assert body["rejected"] == []
    assert [item["label"] for item in body["items"]] == [
        "Account name",
        "Device only",
    ], "the account keeps its established order AND its own labels"


def test_a_merge_is_idempotent(auth_client, harness):
    token = harness.token("user_merge_twice")
    items = [
        {"client_id": cid(), "label": "One", "filters": {"club": "Ajax"}},
        {"client_id": cid(), "label": "Two", "filters": {"club": "Bayern"}},
    ]
    first = auth_client.post(f"{VIEWS}/merge", headers=auth_header(token), json={"items": items})
    assert first.json()["added"] == [item["client_id"] for item in items]

    second = auth_client.post(f"{VIEWS}/merge", headers=auth_header(token), json={"items": items})
    assert second.json()["added"] == []
    assert second.json()["already_present"] == [item["client_id"] for item in items]
    assert second.json()["count"] == 2


def test_merge_dispositions_are_disjoint_and_exhaustive(auth_client, harness):
    token = harness.token("user_merge_dispositions")
    _save_view(auth_client, token, label="Held", filters={"club": "Ajax"})

    present, fresh, invalid, dupe_a, dupe_b = (cid() for _ in range(5))
    merged = auth_client.post(
        f"{VIEWS}/merge",
        headers=auth_header(token),
        json={
            "items": [
                {"client_id": present, "label": "Held on device", "filters": {"club": "Ajax"}},
                {"client_id": fresh, "label": "New", "filters": {"club": "Bayern"}},
                {"client_id": invalid, "label": "Stale", "filters": {"role": "gone_role"}},
                {"client_id": dupe_a, "label": "Dup 1", "filters": {"club": "Milan"}},
                {"client_id": dupe_b, "label": "Dup 2", "filters": {"club": "Milan"}},
            ]
        },
    )
    body = merged.json()
    added, already = set(body["added"]), set(body["already_present"])
    rejected = {r["client_id"] for r in body["rejected"]}

    assert added & already == set() and added & rejected == set() and already & rejected == set()
    assert added | already | rejected == {present, fresh, invalid, dupe_a, dupe_b}
    assert already == {present}
    assert added == {fresh, dupe_a}, "a device duplicate collapses to its FIRST occurrence"
    assert rejected == {invalid, dupe_b}


def test_a_merge_rejects_a_comparison_whose_player_has_gone(auth_client, harness):
    token = harness.token("user_merge_stale_comparison")
    a, b = _player_ids(auth_client, 2)
    stale = cid()
    good = cid()
    merged = auth_client.post(
        f"{COMPARISONS}/merge",
        headers=auth_header(token),
        json={
            "items": [
                {
                    "client_id": stale,
                    "label": "Gone",
                    "player_a_id": a,
                    "player_b_id": 9_876_543,
                    "player_a_label": "A",
                    "player_b_label": "Ghost",
                },
                {
                    "client_id": good,
                    "label": "Fine",
                    "player_a_id": a,
                    "player_b_id": b,
                    "player_a_label": "A",
                    "player_b_label": "B",
                },
            ]
        },
    )
    body = merged.json()
    assert body["added"] == [good]
    assert body["rejected"] == [{"client_id": stale, "reason": "player not found"}]
    assert body["count"] == 1, "one bad item does not drop the rest of the batch"


def test_an_oversized_merge_is_refused_rather_than_truncated(auth_client, harness):
    token = harness.token("user_big_merge")
    items = [
        {"client_id": cid(), "label": f"View {i}", "filters": {"rolefit_min": i % 100}}
        for i in range(MAX_MERGE_ITEMS + 1)
    ]
    response = auth_client.post(f"{VIEWS}/merge", headers=auth_header(token), json={"items": items})
    assert response.status_code == 422


def test_a_full_collection_refuses_further_saves(auth_client, harness):
    token = harness.token("user_full_collection")
    items = [
        {"client_id": cid(), "label": f"View {i}", "filters": {"min_minutes": i}}
        for i in range(MAX_COLLECTION_ITEMS)
    ]
    filled = auth_client.post(f"{VIEWS}/merge", headers=auth_header(token), json={"items": items})
    assert filled.json()["count"] == MAX_COLLECTION_ITEMS

    overflow = _save_view(auth_client, token, filters={"min_minutes": MAX_COLLECTION_ITEMS + 1})
    assert overflow.status_code == 422
    assert "at most" in overflow.text


# ---------------------------------------------------------------------------
# Concurrency
# ---------------------------------------------------------------------------


def test_concurrent_identical_creates_converge_on_one_item(auth_client, harness, monkeypatch):
    """Two simultaneous saves of one cohort: the database decides, not application logic.

    The race is made deterministic by inserting the competing row inside the
    loser's own lookup, so its INSERT is genuinely rejected by
    `uq_saved_view_fingerprint` rather than by a check that happened to run first.
    """
    token = harness.token("user_concurrent_create")
    filters = {"club": "Ajax", "role": "advanced_8"}

    # Establish the account row first, so the race is about the view alone.
    _save_view(auth_client, token, label="Seed", filters={"club": "Seed FC"})

    real_find = saved_work_service._find_by_fingerprint
    fired = {"done": False}

    def racing_find(db, model, user, fingerprint):
        found = real_find(db, model, user, fingerprint)
        if found is None and model is SavedDiscoveryView and not fired["done"]:
            fired["done"] = True
            # A concurrent writer lands the same cohort between our lookup and
            # our insert.
            competitor = SavedDiscoveryView(
                user_id=user.id, client_id=cid(), label="Competitor", fingerprint=fingerprint
            )
            for field, value in filters.items():
                setattr(competitor, field, value)
            db.add(competitor)
            db.commit()
        return found

    monkeypatch.setattr(saved_work_service, "_find_by_fingerprint", racing_find)
    response = _save_view(auth_client, token, label="Mine", filters=filters)

    assert response.status_code == 200
    assert response.json()["disposition"] == "updated", "the loser adopts the winner's row"
    labels = [item["label"] for item in response.json()["items"]]
    assert labels.count("Competitor") == 1
    assert "Mine" not in labels
    assert response.json()["count"] == 2, "seed + the single converged view"


def test_a_non_uniqueness_integrity_error_is_not_swallowed_as_a_race():
    """Swallowing every IntegrityError would turn real bugs into silently short lists."""
    from sqlalchemy.exc import IntegrityError

    not_null = IntegrityError(
        "stmt", {}, Exception("NOT NULL constraint failed: saved_views.label")
    )
    assert not saved_work_service._is_unique_violation(not_null, "uq_saved_view_fingerprint")

    unique = IntegrityError(
        "stmt", {}, Exception("UNIQUE constraint failed: uq_saved_view_fingerprint")
    )
    assert saved_work_service._is_unique_violation(unique, "uq_saved_view_fingerprint")

    postgres = IntegrityError("stmt", {}, type("E", (Exception,), {"sqlstate": "23505"})())
    assert saved_work_service._is_unique_violation(postgres, "uq_saved_view_fingerprint")


def test_an_unresolvable_merge_conflict_is_reported_rather_than_returned_short(
    auth_client, harness, monkeypatch
):
    """A partial merge must never be reported as complete success."""
    token = harness.token("user_merge_conflict")

    def never_lands(db, model, user):
        return []

    monkeypatch.setattr(saved_work_service, "_canonical_rows", never_lands)
    response = auth_client.post(
        f"{VIEWS}/merge",
        headers=auth_header(token),
        json={"items": [{"client_id": cid(), "label": "Lost", "filters": {"club": "Ajax"}}]},
    )
    assert response.status_code == 409
    assert "retry" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Labels are inert plain text
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("label", XSS_LABELS)
def test_a_script_shaped_label_is_stored_as_harmless_text(auth_client, harness, label):
    """Storage is verbatim. Nothing is escaped here because nothing interpolates it."""
    token = harness.token("user_xss_label")
    saved = _save_view(auth_client, token, label=label, filters={"club": label[:40]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["item"]["label"] == label

    listed = auth_client.get(VIEWS, headers=auth_header(token)).json()
    assert listed["items"][0]["label"] == label
    assert listed["items"][0]["filters"]["club"] == label[:40]


@pytest.mark.parametrize("bad", ["", "   ", "a" * 81])
def test_an_empty_or_oversized_label_is_refused(auth_client, harness, bad):
    token = harness.token("user_bad_label")
    assert _save_view(auth_client, token, label=bad).status_code == 422


@pytest.mark.parametrize("codepoint", [0x00, 0x07, 0x0A, 0x0D, 0x1B, 0x7F, 0x2028])
def test_a_label_containing_a_control_character_is_refused(auth_client, harness, codepoint):
    token = harness.token("user_control_label")
    label = f"Cohort{chr(codepoint)}injected"
    assert _save_view(auth_client, token, label=label).status_code == 422


def test_a_malformed_client_id_cannot_address_a_row(auth_client, harness):
    """The path parameter is a canonical UUID and nothing looser.

    Two safe outcomes, depending on how far the request gets: a value that is not
    a UUID is a 422 from the path validator, and one containing path separators
    never matches the route at all and is a 404. What matters is the property both
    share - no such request reaches a row, and none of them mutates anything.
    """
    token = harness.token("user_bad_client_id")
    stable = cid()
    _save_view(auth_client, token, label="Untouched", client_id=stable, filters={"club": "Ajax"})

    for bad in [
        "../../etc/passwd",
        "1 OR 1=1",
        "not-a-uuid",
        "%2e%2e%2f",
        "a" * 200,
        f"{stable}' OR '1'='1",
        f"{stable.upper()}",  # the canonical form is lower case
    ]:
        removed = auth_client.delete(f"{VIEWS}/{bad}", headers=auth_header(token))
        assert removed.status_code in (404, 422), bad
        renamed = auth_client.patch(
            f"{VIEWS}/{bad}", headers=auth_header(token), json={"label": "Owned"}
        )
        assert renamed.status_code in (404, 422), bad

    surviving = auth_client.get(VIEWS, headers=auth_header(token)).json()
    assert surviving["count"] == 1
    assert surviving["items"][0]["label"] == "Untouched"


def test_unicode_club_names_have_one_canonical_identity(auth_client, harness):
    """NFC vs NFD must not produce two saved views a scout cannot tell apart."""
    token = harness.token("user_unicode")
    composed = "Köln"  # o with diaeresis, single codepoint
    decomposed = "Köln"  # o + combining diaeresis
    assert composed != decomposed

    _save_view(auth_client, token, label="Composed", filters={"club": composed})
    second = _save_view(auth_client, token, label="Decomposed", filters={"club": decomposed})
    assert second.json()["count"] == 1
    assert second.json()["items"][0]["filters"]["club"] == composed


# ---------------------------------------------------------------------------
# Schema parity: the migration and the ORM describe the same tables
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def migrated_schema(tmp_path_factory):
    """A database built the way a DEPLOYMENT builds one: `alembic upgrade head`.

    In a subprocess with its own `DATABASE_URL`, because `db/migrations/env.py`
    resolves the URL from settings and settings are memoized for the life of the
    process - so an in-process `command.upgrade` would migrate the pytest
    database, not this one.
    """
    import os
    import subprocess
    import sys

    from sqlalchemy import create_engine

    path = tmp_path_factory.mktemp("parity") / "migrated.db"
    environment = {**os.environ, "DATABASE_URL": f"sqlite:///{path}"}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env=environment,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    engine = create_engine(f"sqlite:///{path}")
    try:
        yield inspect(engine)
    finally:
        engine.dispose()


@pytest.mark.parametrize("table", ["saved_discovery_views", "saved_comparisons"])
def test_the_migration_and_the_orm_agree_on_the_saved_work_tables(migrated_schema, table):
    """The test suite creates tables from metadata; deployments run the migration.

    Nothing checks that those two produce the same schema unless something does,
    and a column that exists in only one of them is a production-only failure that
    every green suite would miss.
    """
    from app.models.orm import Base

    assert table in migrated_schema.get_table_names()

    migrated_columns = {c["name"]: c for c in migrated_schema.get_columns(table)}
    orm_columns = {c.name: c for c in Base.metadata.tables[table].columns}
    assert set(migrated_columns) == set(orm_columns), f"{table} column drift"

    for name, column in orm_columns.items():
        assert migrated_columns[name]["nullable"] == column.nullable, f"{table}.{name} nullability"

    orm_unique = {
        tuple(sorted(c.columns.keys()))
        for c in Base.metadata.tables[table].constraints
        if c.__class__.__name__ == "UniqueConstraint"
    }
    migrated_unique = {
        tuple(sorted(u["column_names"])) for u in migrated_schema.get_unique_constraints(table)
    }
    assert orm_unique == migrated_unique, f"{table} unique-constraint drift"


def test_the_migration_carries_the_documented_foreign_key_actions(migrated_schema):
    """CASCADE from the account; SET NULL from a player.

    The difference is deliberate and load-bearing: cascading a player deletion
    would silently destroy a scout's saved comparison as a side effect of a data
    refresh, which is exactly what the unavailable-side design exists to avoid.
    """
    actions = {
        (fk["referred_table"], tuple(fk["constrained_columns"])): fk["options"].get("ondelete")
        for fk in migrated_schema.get_foreign_keys("saved_comparisons")
    }
    assert actions[("app_users", ("user_id",))] == "CASCADE"
    assert actions[("players", ("player_a_id",))] == "SET NULL"
    assert actions[("players", ("player_b_id",))] == "SET NULL"

    view_actions = {
        (fk["referred_table"], tuple(fk["constrained_columns"])): fk["options"].get("ondelete")
        for fk in migrated_schema.get_foreign_keys("saved_discovery_views")
    }
    assert view_actions[("app_users", ("user_id",))] == "CASCADE"


def test_the_migration_leaves_the_8_4a_tables_alone(migrated_schema):
    """8.4B is additive: an existing 8.4A deployment keeps every favourite it holds."""
    tables = set(migrated_schema.get_table_names())
    assert {"app_users", "user_favorites"} <= tables
    favorites = {c["name"] for c in migrated_schema.get_columns("user_favorites")}
    assert favorites == {"id", "user_id", "player_id", "created_at"}
