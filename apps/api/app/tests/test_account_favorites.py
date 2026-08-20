"""Milestone 8.4A: the authentication boundary and durable favourites.

The suite is deliberately structured as "prove the gate, then prove the list":
if the gate leaks, nothing about the list matters.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.core.auth import (
    CachedJwksResolver,
    VerifiedIdentity,
    get_token_verifier,
    resolve_app_user,
)
from app.core.config import Settings
from app.core.errors import AuthenticationError
from app.main import app
from app.models.orm import AppUser, Player, UserFavorite
from app.models.schemas import MAX_MERGE_PLAYER_IDS
from app.services import favorites_service
from app.tests.account_auth import (
    AUTHORIZED_PARTY,
    ISSUER,
    IdentityHarness,
    auth_header,
    build_test_verifier,
)

# A player id that cannot exist in the sample fixture, used wherever a stale
# browser entry has to be represented.
STALE_PLAYER_ID = 9_876_543


@pytest.fixture(scope="module")
def harness() -> IdentityHarness:
    return IdentityHarness()


@pytest.fixture()
def auth_client(_seeded, harness):
    """A client whose verifier is anchored to the harness's local key set.

    Overriding `get_token_verifier` — not `get_current_user` — is the point: the
    request still has to carry a token that passes every signature and claim
    check before a user is resolved.
    """
    app.dependency_overrides[get_token_verifier] = lambda: build_test_verifier(harness)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_token_verifier, None)


@pytest.fixture(autouse=True)
def _clean_accounts(_seeded):
    """Each test starts from an empty account table, so ordering assertions are real."""
    from app.core.db import SessionLocal

    with SessionLocal() as session:
        session.execute(delete(UserFavorite))
        session.execute(delete(AppUser))
        session.commit()
    yield


def _player_ids(client, count: int) -> list:
    items = client.get(f"/api/players?page_size={count}").json()["items"]
    ids = [item["id"] for item in items]
    assert len(ids) == count, "sample fixture is too small for this test"
    return ids


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------


def test_private_endpoints_reject_missing_authentication(auth_client):
    for method, path in (
        ("get", "/api/me/favorites"),
        ("put", "/api/me/favorites/1"),
        ("delete", "/api/me/favorites/1"),
    ):
        response = getattr(auth_client, method)(path)
        assert response.status_code == 401, path
        assert response.headers.get("WWW-Authenticate") == "Bearer"

    merged = auth_client.post("/api/me/favorites/merge", json={"player_ids": [1]})
    assert merged.status_code == 401


def test_malformed_authorization_headers_are_rejected(auth_client, harness):
    valid = harness.token("user_malformed")
    for header in (
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer   "},
        {"Authorization": "not-a-scheme abc"},
        {"Authorization": f"Basic {valid}"},
        {"Authorization": "Bearer not.a.jwt.at.all"},
        {"Authorization": "Bearer onlyonesegment"},
    ):
        response = auth_client.get("/api/me/favorites", headers=header)
        assert response.status_code == 401, header


def test_token_signed_by_an_unpublished_key_is_rejected(auth_client, harness):
    """A forged token: correct shape, correct claims, wrong signer."""
    forged = harness.token("user_forged", key=harness.attacker_key)
    response = auth_client.get("/api/me/favorites", headers=auth_header(forged))
    assert response.status_code == 401


def test_token_with_an_unknown_key_id_is_rejected(auth_client, harness):
    response = auth_client.get(
        "/api/me/favorites", headers=auth_header(harness.token("user_kid", kid="rotated-away"))
    )
    assert response.status_code == 401


def test_unsigned_token_is_rejected(auth_client, harness):
    """`alg: none` must never be honoured, whatever the header claims."""
    unsigned = harness.token("user_none", key="", algorithm="none")
    response = auth_client.get("/api/me/favorites", headers=auth_header(unsigned))
    assert response.status_code == 401


def test_expired_token_is_rejected(auth_client, harness):
    expired = harness.token("user_expired", expires_in=-30)
    response = auth_client.get("/api/me/favorites", headers=auth_header(expired))
    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()


def test_not_yet_valid_token_is_rejected(auth_client, harness):
    premature = harness.token("user_early", not_before=600)
    assert auth_client.get("/api/me/favorites", headers=auth_header(premature)).status_code == 401


def test_token_from_another_issuer_is_rejected(auth_client, harness):
    other = harness.token("user_other", issuer="https://someone-else.clerk.accounts.dev")
    assert auth_client.get("/api/me/favorites", headers=auth_header(other)).status_code == 401


def test_token_scoped_to_another_authorized_party_is_rejected(auth_client, harness):
    """Clerk's documented CSRF defence: a token minted for another front end."""
    wrong_party = harness.token("user_azp", azp="https://evil.example")
    assert auth_client.get("/api/me/favorites", headers=auth_header(wrong_party)).status_code == 401

    missing_party = harness.token("user_no_azp", azp=None)
    assert (
        auth_client.get("/api/me/favorites", headers=auth_header(missing_party)).status_code == 401
    )


def test_token_without_a_subject_is_rejected(harness):
    verifier = build_test_verifier(harness)
    with pytest.raises(AuthenticationError):
        verifier.verify(harness.token("ignored", omit_subject=True))


def test_audience_is_enforced_only_when_configured(harness):
    """A default Clerk session token has no `aud`, so demanding one would break it."""
    lenient = build_test_verifier(harness)
    assert lenient.verify(harness.token("user_aud")).subject == "user_aud"

    strict = build_test_verifier(harness, audience="scoutboy-api")
    assert strict.verify(harness.token("user_aud", audience="scoutboy-api")).subject == "user_aud"
    with pytest.raises(AuthenticationError):
        strict.verify(harness.token("user_aud", audience="another-api"))
    with pytest.raises(AuthenticationError):
        strict.verify(harness.token("user_aud"))


def test_reading_favorites_verifies_the_identity_without_writing_anything(auth_client, harness):
    """Browsing signed-in leaves no trace. Reads never insert.

    An identity with no row is not an error: it is an account that has never
    saved a player, and the honest answer for it is the empty list. Creating a row
    just to answer a GET would make the milestone document's "browsing performs no
    write" untrue, so it does not happen.
    """
    from app.core.db import SessionLocal

    token = auth_header(harness.token("user_reader"))
    for _ in range(3):
        response = auth_client.get("/api/me/favorites", headers=token)
        assert response.status_code == 200
        assert response.json() == {"player_ids": [], "count": 0}

    # A removal stores nothing either, so it creates nothing.
    removal = auth_client.delete("/api/me/favorites/1", headers=token)
    assert removal.status_code == 200
    assert removal.json()["changed"] is False

    with SessionLocal() as session:
        assert session.scalars(select(AppUser)).all() == []


def test_the_first_mutation_lazily_creates_exactly_one_account(auth_client, harness):
    from app.core.db import SessionLocal

    token = auth_header(harness.token("user_lazy"))
    player_id = _player_ids(auth_client, 1)[0]

    with SessionLocal() as session:
        assert session.scalars(select(AppUser)).all() == []

    assert auth_client.put(f"/api/me/favorites/{player_id}", headers=token).status_code == 200

    with SessionLocal() as session:
        users = session.scalars(select(AppUser)).all()
        assert len(users) == 1
        assert users[0].external_subject == "user_lazy"
        assert users[0].auth_issuer == ISSUER
        assert users[0].auth_provider == "clerk"

    # Every later request reuses that row, never creating another.
    auth_client.get("/api/me/favorites", headers=token)
    auth_client.put(f"/api/me/favorites/{player_id}", headers=token)
    auth_client.delete(f"/api/me/favorites/{player_id}", headers=token)
    auth_client.post("/api/me/favorites/merge", json={"player_ids": [player_id]}, headers=token)

    with SessionLocal() as session:
        assert len(session.scalars(select(AppUser)).all()) == 1


def test_a_merge_lazily_creates_the_account_it_needs(auth_client, harness):
    from app.core.db import SessionLocal

    token = auth_header(harness.token("user_merge_creates"))
    player_ids = _player_ids(auth_client, 2)

    with SessionLocal() as session:
        assert session.scalars(select(AppUser)).all() == []

    body = auth_client.post(
        "/api/me/favorites/merge", json={"player_ids": player_ids}, headers=token
    ).json()
    assert body["player_ids"] == player_ids

    with SessionLocal() as session:
        assert len(session.scalars(select(AppUser)).all()) == 1


def test_reads_and_writes_share_one_verification_path(auth_client, harness):
    """The read dependency is not a weaker gate - only a non-writing one."""
    for header in (
        {"Authorization": "Bearer nonsense"},
        auth_header(harness.token("user_expired_read", expires_in=-30)),
        auth_header(harness.token("user_azp_read", azp="https://evil.example")),
        auth_header(harness.token("user_iss_read", issuer="https://other.clerk.accounts.dev")),
        auth_header(harness.token("user_forged_read", key=harness.attacker_key)),
    ):
        assert auth_client.get("/api/me/favorites", headers=header).status_code == 401, header
    assert auth_client.get("/api/me/favorites").status_code == 401


def test_account_row_stores_no_personal_data(auth_client, harness):
    """The schema itself is the privacy guarantee, so assert its shape."""
    from app.core.db import SessionLocal

    # A mutation, because a read deliberately creates nothing to inspect.
    token = auth_header(harness.token("user_private"))
    player_id = _player_ids(auth_client, 1)[0]
    assert auth_client.put(f"/api/me/favorites/{player_id}", headers=token).status_code == 200
    with SessionLocal() as session:
        user = session.scalars(select(AppUser)).one()
        columns = set(user.__table__.columns.keys())
    assert columns == {
        "id",
        "auth_provider",
        "auth_issuer",
        "external_subject",
        "created_at",
        "updated_at",
    }


def test_same_subject_from_a_different_issuer_is_a_different_account(_seeded):
    """A subject is only unique within its issuing tenant."""
    from app.core.db import SessionLocal

    with SessionLocal() as session:
        first = resolve_app_user(session, VerifiedIdentity(issuer=ISSUER, subject="user_shared"))
        second = resolve_app_user(
            session,
            VerifiedIdentity(
                issuer="https://other-tenant.clerk.accounts.dev", subject="user_shared"
            ),
        )
        assert first.id != second.id


def test_lazy_creation_recovers_from_a_concurrent_insert(_seeded, monkeypatch):
    """The unique constraint decides the race; the loser re-reads the winner's row.

    Genuinely raced rather than asserted in the abstract: this session's SELECT
    misses, a second session inserts the row, and only then does the first
    session's INSERT hit the constraint.
    """
    from app.core.db import SessionLocal

    identity = VerifiedIdentity(issuer=ISSUER, subject="user_race")

    with SessionLocal() as loser:
        raced = {"done": False}
        real_commit = loser.commit

        def racing_commit():
            if not raced["done"]:
                raced["done"] = True
                with SessionLocal() as winner:
                    winner.add(
                        AppUser(
                            auth_provider="clerk",
                            auth_issuer=ISSUER,
                            external_subject="user_race",
                        )
                    )
                    winner.commit()
                raise IntegrityError("INSERT", {}, Exception("duplicate key"))
            return real_commit()

        monkeypatch.setattr(loser, "commit", racing_commit)
        resolved = resolve_app_user(loser, identity)
        assert raced["done"] is True
        assert resolved.external_subject == "user_race"

    with SessionLocal() as verify:
        assert len(verify.scalars(select(AppUser)).all()) == 1


def _raise_integrity(session):
    """A `commit` that fails once with the error a unique violation produces."""
    calls = {"n": 0}
    real = session.commit

    def commit():
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("INSERT", {}, Exception("duplicate key"))
        return real()

    return commit


def test_adding_a_favourite_survives_a_concurrent_duplicate_insert(_seeded, monkeypatch):
    """`uq_user_favorite` decides; the loser reports "already saved", not an error."""
    from app.core.db import SessionLocal

    with SessionLocal() as session:
        user = resolve_app_user(session, VerifiedIdentity(issuer=ISSUER, subject="user_dup_add"))
        player_id = session.scalars(select(Player.id).limit(1)).one()
        monkeypatch.setattr(session, "commit", _raise_integrity(session))
        assert favorites_service.add_favorite(session, user, player_id) is False

    with SessionLocal() as verify:
        assert verify.scalars(select(UserFavorite.player_id)).all() == []


def test_private_routes_report_a_disabled_deployment_honestly(client):
    """Auth is off by default, so the anonymous product answers 503, never 401.

    401 would invite the caller to authenticate against a provider that does not
    exist on this deployment.
    """
    response = client.get("/api/me/favorites")
    assert response.status_code == 503
    assert "not enabled" in response.json()["detail"].lower()


def test_public_endpoints_stay_open_while_accounts_exist(client):
    for path in (
        "/api/players?page_size=1",
        "/api/methodology",
        "/api/health",
    ):
        assert client.get(path).status_code == 200, path


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def test_disabled_auth_needs_no_clerk_configuration():
    settings = Settings(environment="development", auth_enabled=False)
    assert settings.auth_enabled is False
    assert settings.clerk_issuer_url == ""


@pytest.mark.parametrize(
    "overrides",
    [
        {},  # enabled with nothing configured
        {"clerk_issuer": "http://insecure.example"},
        {"clerk_issuer": ISSUER},  # no authorized parties
        {
            "clerk_issuer": ISSUER,
            "clerk_authorized_parties": AUTHORIZED_PARTY,
            "clerk_jwks_url": "http://insecure.example/jwks",
        },
        {
            "clerk_issuer": ISSUER,
            "clerk_authorized_parties": AUTHORIZED_PARTY,
            "clerk_jwks_cache_seconds": 0,
        },
        {
            "clerk_issuer": ISSUER,
            "clerk_authorized_parties": AUTHORIZED_PARTY,
            "clerk_jwks_max_keys": 0,
        },
        {
            "clerk_issuer": ISSUER,
            "clerk_authorized_parties": AUTHORIZED_PARTY,
            "clerk_leeway_seconds": -1,
        },
    ],
)
def test_incomplete_auth_configuration_fails_loudly(overrides):
    with pytest.raises(ValidationError):
        Settings(environment="development", auth_enabled=True, **overrides)


def test_complete_auth_configuration_derives_the_jwks_location():
    settings = Settings(
        environment="development",
        auth_enabled=True,
        clerk_issuer=f"{ISSUER}/",
        clerk_authorized_parties=f"{AUTHORIZED_PARTY}/, https://scoutboy.example",
    )
    assert settings.clerk_issuer_url == ISSUER
    assert settings.clerk_jwks_uri == f"{ISSUER}/.well-known/jwks.json"
    assert settings.clerk_authorized_party_list == [AUTHORIZED_PARTY, "https://scoutboy.example"]
    assert settings.clerk_expected_audience is None


# ---------------------------------------------------------------------------
# The list
# ---------------------------------------------------------------------------


def test_add_and_remove_are_idempotent(auth_client, harness):
    headers = auth_header(harness.token("user_idempotent"))
    player_id = _player_ids(auth_client, 1)[0]

    first = auth_client.put(f"/api/me/favorites/{player_id}", headers=headers).json()
    assert first["changed"] is True
    assert first["player_ids"] == [player_id]

    second = auth_client.put(f"/api/me/favorites/{player_id}", headers=headers).json()
    assert second["changed"] is False
    assert second["player_ids"] == [player_id]

    removed = auth_client.delete(f"/api/me/favorites/{player_id}", headers=headers).json()
    assert removed["changed"] is True
    assert removed["player_ids"] == []

    again = auth_client.delete(f"/api/me/favorites/{player_id}", headers=headers).json()
    assert again["changed"] is False
    assert again["player_ids"] == []


def test_adding_a_stale_player_id_is_a_clean_404(auth_client, harness):
    headers = auth_header(harness.token("user_stale"))
    response = auth_client.put(f"/api/me/favorites/{STALE_PLAYER_ID}", headers=headers)
    assert response.status_code == 404
    assert auth_client.get("/api/me/favorites", headers=headers).json()["player_ids"] == []


def test_removing_an_unknown_player_id_succeeds_without_changing_anything(auth_client, harness):
    """The caller's goal is "not on my list", which is already true."""
    headers = auth_header(harness.token("user_stale_delete"))
    response = auth_client.delete(f"/api/me/favorites/{STALE_PLAYER_ID}", headers=headers)
    assert response.status_code == 200
    assert response.json()["changed"] is False


def test_non_positive_player_ids_are_rejected_by_the_contract(auth_client, harness):
    headers = auth_header(harness.token("user_bad_id"))
    assert auth_client.put("/api/me/favorites/0", headers=headers).status_code == 422
    assert auth_client.put("/api/me/favorites/-4", headers=headers).status_code == 422
    merged = auth_client.post("/api/me/favorites/merge", json={"player_ids": [0]}, headers=headers)
    assert merged.status_code == 422


def test_favourites_keep_deterministic_save_order(auth_client, harness):
    headers = auth_header(harness.token("user_order"))
    ids = _player_ids(auth_client, 4)
    # Saved in an order that is deliberately not ascending by id.
    for player_id in (ids[2], ids[0], ids[3], ids[1]):
        auth_client.put(f"/api/me/favorites/{player_id}", headers=headers)

    expected = [ids[2], ids[0], ids[3], ids[1]]
    for _ in range(3):
        assert (
            auth_client.get("/api/me/favorites", headers=headers).json()["player_ids"] == expected
        )


def test_removing_and_re_adding_moves_a_player_to_the_end(auth_client, harness):
    headers = auth_header(harness.token("user_reorder"))
    ids = _player_ids(auth_client, 3)
    for player_id in ids:
        auth_client.put(f"/api/me/favorites/{player_id}", headers=headers)

    auth_client.delete(f"/api/me/favorites/{ids[0]}", headers=headers)
    auth_client.put(f"/api/me/favorites/{ids[0]}", headers=headers)
    assert auth_client.get("/api/me/favorites", headers=headers).json()["player_ids"] == [
        ids[1],
        ids[2],
        ids[0],
    ]


# ---------------------------------------------------------------------------
# Isolation between accounts
# ---------------------------------------------------------------------------


def test_one_account_cannot_read_or_infer_another_accounts_favourites(auth_client, harness):
    ids = _player_ids(auth_client, 2)
    alice = auth_header(harness.token("user_alice"))
    bob = auth_header(harness.token("user_bob"))

    auth_client.put(f"/api/me/favorites/{ids[0]}", headers=alice)
    auth_client.put(f"/api/me/favorites/{ids[1]}", headers=alice)

    assert auth_client.get("/api/me/favorites", headers=bob).json() == {
        "player_ids": [],
        "count": 0,
    }
    # Bob removing Alice's player must not touch her list, and must not reveal
    # through its response that she has it.
    removal = auth_client.delete(f"/api/me/favorites/{ids[0]}", headers=bob).json()
    assert removal["changed"] is False
    assert removal["player_ids"] == []
    assert auth_client.get("/api/me/favorites", headers=alice).json()["player_ids"] == ids


def test_two_accounts_may_independently_favourite_the_same_player(auth_client, harness):
    player_id = _player_ids(auth_client, 1)[0]
    alice = auth_header(harness.token("user_alice_2"))
    bob = auth_header(harness.token("user_bob_2"))

    assert (
        auth_client.put(f"/api/me/favorites/{player_id}", headers=alice).json()["changed"] is True
    )
    assert auth_client.put(f"/api/me/favorites/{player_id}", headers=bob).json()["changed"] is True

    # …and one removing it leaves the other's list intact.
    auth_client.delete(f"/api/me/favorites/{player_id}", headers=alice)
    assert auth_client.get("/api/me/favorites", headers=alice).json()["player_ids"] == []
    assert auth_client.get("/api/me/favorites", headers=bob).json()["player_ids"] == [player_id]


def test_a_merge_cannot_reach_another_account(auth_client, harness):
    ids = _player_ids(auth_client, 3)
    alice = auth_header(harness.token("user_alice_3"))
    bob = auth_header(harness.token("user_bob_3"))

    auth_client.put(f"/api/me/favorites/{ids[0]}", headers=alice)
    auth_client.post("/api/me/favorites/merge", json={"player_ids": ids}, headers=bob)

    assert auth_client.get("/api/me/favorites", headers=alice).json()["player_ids"] == [ids[0]]
    assert auth_client.get("/api/me/favorites", headers=bob).json()["player_ids"] == ids


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------


def test_merge_keeps_server_order_and_appends_new_guest_ids_in_guest_order(auth_client, harness):
    headers = auth_header(harness.token("user_merge"))
    ids = _player_ids(auth_client, 5)
    server_first, server_second = ids[3], ids[1]
    auth_client.put(f"/api/me/favorites/{server_first}", headers=headers)
    auth_client.put(f"/api/me/favorites/{server_second}", headers=headers)

    guest = [ids[4], server_second, ids[0], ids[2]]
    body = auth_client.post(
        "/api/me/favorites/merge", json={"player_ids": guest}, headers=headers
    ).json()

    assert body["player_ids"] == [server_first, server_second, ids[4], ids[0], ids[2]]
    assert body["added"] == [ids[4], ids[0], ids[2]]
    assert body["already_present"] == [server_second]
    assert body["unknown"] == []
    assert body["count"] == 5


def test_merge_collapses_duplicate_guest_ids_to_their_first_occurrence(auth_client, harness):
    headers = auth_header(harness.token("user_merge_dupes"))
    ids = _player_ids(auth_client, 3)
    guest = [ids[2], ids[0], ids[2], ids[1], ids[0], ids[2]]

    body = auth_client.post(
        "/api/me/favorites/merge", json={"player_ids": guest}, headers=headers
    ).json()
    assert body["player_ids"] == [ids[2], ids[0], ids[1]]
    assert body["added"] == [ids[2], ids[0], ids[1]]


def test_merge_reports_stale_guest_ids_without_saving_them(auth_client, harness):
    headers = auth_header(harness.token("user_merge_stale"))
    ids = _player_ids(auth_client, 2)

    body = auth_client.post(
        "/api/me/favorites/merge",
        json={"player_ids": [ids[0], STALE_PLAYER_ID, ids[1], STALE_PLAYER_ID + 1]},
        headers=headers,
    ).json()

    assert body["player_ids"] == ids
    assert body["added"] == ids
    assert body["unknown"] == [STALE_PLAYER_ID, STALE_PLAYER_ID + 1]

    from app.core.db import SessionLocal

    with SessionLocal() as session:
        saved = session.scalars(select(UserFavorite.player_id)).all()
    assert STALE_PLAYER_ID not in saved


def test_merge_is_idempotent(auth_client, harness):
    headers = auth_header(harness.token("user_merge_twice"))
    ids = _player_ids(auth_client, 3)

    first = auth_client.post(
        "/api/me/favorites/merge", json={"player_ids": ids}, headers=headers
    ).json()
    second = auth_client.post(
        "/api/me/favorites/merge", json={"player_ids": ids}, headers=headers
    ).json()

    assert first["player_ids"] == second["player_ids"] == ids
    assert second["added"] == []
    assert second["already_present"] == ids


def test_merging_an_empty_guest_list_never_clears_the_account(auth_client, harness):
    """The client-initialization hazard, asserted at the API boundary."""
    headers = auth_header(harness.token("user_merge_empty"))
    ids = _player_ids(auth_client, 2)
    auth_client.post("/api/me/favorites/merge", json={"player_ids": ids}, headers=headers)

    body = auth_client.post(
        "/api/me/favorites/merge", json={"player_ids": []}, headers=headers
    ).json()
    assert body["player_ids"] == ids
    assert body["added"] == []


def test_merge_input_is_bounded(auth_client, harness):
    headers = auth_header(harness.token("user_merge_limit"))
    oversized = list(range(1, MAX_MERGE_PLAYER_IDS + 2))
    response = auth_client.post(
        "/api/me/favorites/merge", json={"player_ids": oversized}, headers=headers
    )
    assert response.status_code == 422

    at_limit = auth_client.post(
        "/api/me/favorites/merge",
        json={"player_ids": list(range(1, MAX_MERGE_PLAYER_IDS + 1))},
        headers=headers,
    )
    assert at_limit.status_code == 200


def test_merge_rolls_back_completely_when_the_commit_fails(_seeded, harness, monkeypatch):
    """An unexpected commit failure leaves the account exactly as it was.

    A recognised uniqueness race is retried to completion (covered separately);
    anything else is a real fault. Either way the account must never be left
    half-appended, which is what this asserts: the error propagates, and not one
    row of the attempted block survives.
    """
    from app.core.db import SessionLocal

    with SessionLocal() as session:
        user = resolve_app_user(session, VerifiedIdentity(issuer=ISSUER, subject="user_rollback"))
        player_ids = list(session.scalars(select(Player.id).limit(4)))
        favorites_service.add_favorite(session, user, player_ids[0])

        monkeypatch.setattr(session, "commit", _raise_integrity(session))
        with pytest.raises(IntegrityError):
            favorites_service.merge_favorites(session, user, player_ids[1:])

    with SessionLocal() as verify:
        rows = verify.scalars(select(UserFavorite.player_id).order_by(UserFavorite.id.asc())).all()
    assert rows == [player_ids[0]], "a failed merge left rows behind"


def test_service_layer_never_takes_a_user_id_as_data():
    """Structural guarantee: the only way to name an account is an `AppUser` object."""
    import inspect

    for name in ("canonical_ids", "add_favorite", "remove_favorite", "merge_favorites"):
        signature = inspect.signature(getattr(favorites_service, name))
        assert list(signature.parameters)[1] == "user"
        assert signature.parameters["user"].annotation == "AppUser"


def test_account_schema_is_present_on_the_configured_engine():
    """Constraints and indexes exist on the real engine, not just in the model file.

    Runs against SQLite in the default suite and against PostgreSQL in the smoke
    leg, so a dialect that silently declined a constraint would fail one of them.
    """
    from sqlalchemy import inspect as sa_inspect

    from app.core.db import engine

    inspector = sa_inspect(engine)
    tables = set(inspector.get_table_names())
    assert {"app_users", "user_favorites"} <= tables

    user_uniques = {c["name"] for c in inspector.get_unique_constraints("app_users")}
    assert "uq_app_user_identity" in user_uniques

    favorite_uniques = {c["name"] for c in inspector.get_unique_constraints("user_favorites")}
    assert "uq_user_favorite" in favorite_uniques

    indexes = {i["name"] for i in inspector.get_indexes("user_favorites")}
    assert "ix_user_favorites_user_order" in indexes

    targets = {fk["referred_table"] for fk in inspector.get_foreign_keys("user_favorites")}
    assert targets == {"app_users", "players"}


# ---------------------------------------------------------------------------
# Remote key retrieval
# ---------------------------------------------------------------------------


class _StubJwkClient:
    built = 0

    def __init__(self, uri, **kwargs):
        # Counted on the base class, so a subclass below shares the tally.
        _StubJwkClient.built += 1
        self.uri = uri
        self.kwargs = kwargs

    def get_signing_key_from_jwt(self, token):
        return f"key-for-{token}"


def test_jwks_retrieval_is_cached_and_bounded(monkeypatch):
    """One fetch per TTL window, with the key count bounded."""
    _StubJwkClient.built = 0
    monkeypatch.setattr("app.core.auth.jwt.PyJWKClient", _StubJwkClient)
    clock = {"now": 1000.0}
    monkeypatch.setattr("app.core.auth.time.monotonic", lambda: clock["now"])

    resolver = CachedJwksResolver("https://tenant.example/.well-known/jwks.json", 300, 4)
    assert resolver.get_signing_key_from_jwt("a") == "key-for-a"
    assert resolver.get_signing_key_from_jwt("b") == "key-for-b"
    assert _StubJwkClient.built == 1

    clock["now"] += 301  # past the TTL: rotation has to be picked up
    resolver.get_signing_key_from_jwt("c")
    assert _StubJwkClient.built == 2


def test_jwks_retrieval_falls_back_when_lifespan_is_unsupported(monkeypatch):
    """Older PyJWT builds reject `lifespan`; the TTL above is the guarantee either way."""

    class _NoLifespanClient(_StubJwkClient):
        def __init__(self, uri, **kwargs):
            if "lifespan" in kwargs:
                raise TypeError("unexpected keyword argument 'lifespan'")
            super().__init__(uri, **kwargs)

    _StubJwkClient.built = 0
    monkeypatch.setattr("app.core.auth.jwt.PyJWKClient", _NoLifespanClient)
    resolver = CachedJwksResolver("https://tenant.example/.well-known/jwks.json", 300, 4)
    assert resolver.get_signing_key_from_jwt("a") == "key-for-a"
    assert _StubJwkClient.built == 1


def test_unreachable_jwks_is_a_401_not_a_500(auth_client, harness, monkeypatch):
    """A key-server outage must not surface as an unhandled server error."""

    class _Broken:
        def get_signing_key_from_jwt(self, token):
            raise ConnectionError("jwks unreachable")

    from app.core.auth import ClerkTokenVerifier

    broken = ClerkTokenVerifier(
        issuer=ISSUER, authorized_parties=[AUTHORIZED_PARTY], resolver=_Broken()
    )
    app.dependency_overrides[get_token_verifier] = lambda: broken
    response = auth_client.get(
        "/api/me/favorites", headers=auth_header(harness.token("user_outage"))
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Concurrent merges stay exhaustive
# ---------------------------------------------------------------------------


def _disposition_union(outcome) -> set:
    return set(outcome.added) | set(outcome.already_present) | set(outcome.unknown)


def test_merge_dispositions_are_disjoint_and_exhaustive(_seeded):
    """The union of the three lists is every distinct requested ID. Always."""
    from app.core.db import SessionLocal

    with SessionLocal() as session:
        user = resolve_app_user(session, VerifiedIdentity(issuer=ISSUER, subject="user_union"))
        ids = list(session.scalars(select(Player.id).order_by(Player.id).limit(3)))
        favorites_service.add_favorite(session, user, ids[0])

        requested = [ids[1], ids[0], STALE_PLAYER_ID, ids[1], ids[2]]
        outcome = favorites_service.merge_favorites(session, user, requested)

        distinct = {ids[0], ids[1], ids[2], STALE_PLAYER_ID}
        assert _disposition_union(outcome) == distinct
        assert not (set(outcome.added) & set(outcome.already_present))
        assert not (set(outcome.added) & set(outcome.unknown))
        assert not (set(outcome.already_present) & set(outcome.unknown))


def test_a_concurrent_insert_does_not_drop_the_rest_of_the_batch(_seeded, monkeypatch):
    """The bug this exists for: one racing ID used to take the whole batch down.

    Previously the first `IntegrityError` rolled the entire local batch back and
    returned immediately, so the OTHER valid players in the same merge were
    neither persisted nor mentioned in any disposition list - a silent partial
    loss. The merge now re-reads canonical state and finishes the remainder.
    """
    from app.core.db import SessionLocal

    with SessionLocal() as session:
        user = resolve_app_user(session, VerifiedIdentity(issuer=ISSUER, subject="user_race_merge"))
        ids = list(session.scalars(select(Player.id).order_by(Player.id).limit(4)))
        contested, others = ids[0], ids[1:]

        raced = {"done": False}
        real_commit = session.commit

        def racing_commit():
            if not raced["done"]:
                raced["done"] = True
                # Another session inserts ONE of the requested players first.
                with SessionLocal() as rival:
                    rival.add(UserFavorite(user_id=user.id, player_id=contested))
                    rival.commit()
                raise IntegrityError(
                    "INSERT INTO user_favorites",
                    {},
                    Exception(
                        "UNIQUE constraint failed: user_favorites.user_id, "
                        "user_favorites.player_id"
                    ),
                )
            return real_commit()

        monkeypatch.setattr(session, "commit", racing_commit)
        outcome = favorites_service.merge_favorites(session, user, [contested, *others])

        assert raced["done"] is True
        # Every requested player is accounted for, and every one is persisted.
        assert _disposition_union(outcome) == {contested, *others}
        assert set(outcome.player_ids) == {contested, *others}
        for player_id in others:
            assert player_id in outcome.player_ids, "a valid ID was silently dropped"

    with SessionLocal() as verify:
        stored = verify.scalars(
            select(UserFavorite.player_id).order_by(UserFavorite.id.asc())
        ).all()
    assert set(stored) == {contested, *others}


def test_merge_after_a_race_is_idempotent_and_stably_ordered(_seeded, monkeypatch):
    """Re-running the same merge changes nothing and returns the same order."""
    from app.core.db import SessionLocal

    with SessionLocal() as session:
        user = resolve_app_user(session, VerifiedIdentity(issuer=ISSUER, subject="user_race_idem"))
        ids = list(session.scalars(select(Player.id).order_by(Player.id).limit(3)))

        raced = {"done": False}
        real_commit = session.commit

        def racing_commit():
            if not raced["done"]:
                raced["done"] = True
                with SessionLocal() as rival:
                    rival.add(UserFavorite(user_id=user.id, player_id=ids[1]))
                    rival.commit()
                raise IntegrityError(
                    "INSERT", {}, Exception("UNIQUE constraint failed: user_favorites.user_id")
                )
            return real_commit()

        monkeypatch.setattr(session, "commit", racing_commit)
        first = favorites_service.merge_favorites(session, user, ids)

        session.commit = real_commit
        second = favorites_service.merge_favorites(session, user, ids)
        third = favorites_service.merge_favorites(session, user, ids)

    assert second.player_ids == first.player_ids
    assert third.player_ids == first.player_ids
    assert second.added == [] and third.added == []
    assert set(second.already_present) == set(ids)
    assert _disposition_union(second) == set(ids)


def test_an_unrelated_integrity_error_is_not_swallowed_as_a_race(_seeded, monkeypatch):
    """A NOT NULL breach is a real fault, not "somebody beat me to it"."""
    from app.core.db import SessionLocal

    with SessionLocal() as session:
        user = resolve_app_user(session, VerifiedIdentity(issuer=ISSUER, subject="user_bad_int"))
        ids = list(session.scalars(select(Player.id).order_by(Player.id).limit(2)))

        def failing_commit():
            raise IntegrityError(
                "INSERT", {}, Exception("NOT NULL constraint failed: user_favorites.user_id")
            )

        monkeypatch.setattr(session, "commit", failing_commit)
        with pytest.raises(IntegrityError):
            favorites_service.merge_favorites(session, user, ids)


def test_an_unresolvable_conflict_is_reported_rather_than_returned_short(_seeded, monkeypatch):
    """Bounded retry, then an honest conflict instead of a plausible short list."""
    from app.core.db import SessionLocal

    with SessionLocal() as session:
        user = resolve_app_user(session, VerifiedIdentity(issuer=ISSUER, subject="user_stuck"))
        ids = list(session.scalars(select(Player.id).order_by(Player.id).limit(2)))

        attempts = {"n": 0}

        def always_conflicting_commit():
            attempts["n"] += 1
            session.rollback()
            raise IntegrityError(
                "INSERT", {}, Exception("UNIQUE constraint failed: user_favorites.player_id")
            )

        monkeypatch.setattr(session, "commit", always_conflicting_commit)
        with pytest.raises(favorites_service.FavoritesMergeConflict) as caught:
            favorites_service.merge_favorites(session, user, ids)

        # Bounded: it does not spin forever.
        assert attempts["n"] == favorites_service.MERGE_MAX_ATTEMPTS
        assert set(caught.value.missing) == set(ids)


def test_merge_conflict_surfaces_as_409_so_the_client_keeps_its_device_copy(
    auth_client, harness, monkeypatch
):
    """A 200 with a short list would be how a guest list gets lost."""
    headers = auth_header(harness.token("user_conflict_api"))
    player_ids = _player_ids(auth_client, 2)

    def raise_conflict(db, user, guest_ids):
        raise favorites_service.FavoritesMergeConflict(list(guest_ids))

    monkeypatch.setattr(favorites_service, "merge_favorites", raise_conflict)
    response = auth_client.post(
        "/api/me/favorites/merge", json={"player_ids": player_ids}, headers=headers
    )
    assert response.status_code == 409
    assert "retry" in response.json()["detail"].lower()
