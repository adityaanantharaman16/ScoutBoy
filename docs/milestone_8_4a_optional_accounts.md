# Milestone 8.4A - Optional Accounts and Durable Favorites

## 1. The product contract

ScoutBoy has one promise about accounts, and it is short:

- **No account:** your favourites are saved on this device.
- **Signed in:** your favourites are saved to your account.

An account adds continuity. It does not unlock ScoutBoy.

Every scouting surface stays public and unauthenticated: Discovery, player
dossiers, role leaderboards, Compare, and Methodology. A guest may favourite and
unfavourite players exactly as before. There is no authentication wall, no forced
redirect, no blocking modal, and no feature that becomes unavailable because
somebody chose not to sign up. The only thing an account changes is *where the
favourites list lives*.

The name does not change either. It is **My Favorites** in both modes. Nothing in
this phase renames it, and nothing calls it "likes".

### Why anonymous use stays first-class

A scout evaluating this tool for the first time should be able to run a full
search, open three dossiers, compare two players and save a shortlist without
telling us who they are. Requiring an account before that point converts a
prototype people can assess into a prototype people bounce off. The account is
offered *after* the first save, when it has something concrete to preserve, and
it is offered once.

### Deliberate scope change

The earlier roadmap recorded Milestone 8.4 as device-local only. **That
constraint was changed by product direction for this phase**, and 8.4A supersedes
it: favourites for signed-in users are now stored server-side in ScoutBoy's own
PostgreSQL/SQLAlchemy layer. Everything else the roadmap said about 8.4 stands.
The comparison queue is explicitly NOT part of the change; it remains device
local, and its tray still says so.

## 2. Clerk's responsibility versus ScoutBoy's

| Clerk owns | ScoutBoy owns |
| --- | --- |
| Sign-up, sign-in, sign-out flows | Whether an account is required (it is not) |
| Passwords, resets, email verification | The favourites list and its ordering |
| Session lifetime, refresh, revocation | Verifying the token on every private request |
| Signing keys and their rotation | Mapping a verified subject to an internal user id |
| The user's email, name, avatar | Storing *none* of those |

ScoutBoy implements **no** identity primitives. There is no password hashing, no
session cookie of our own, no reset token, no email delivery, and no
"remember me". If Clerk is not configured, none of that absence matters, because
there is nothing to be absent from.

### What ScoutBoy stores about a person

Two columns: an opaque external subject, and the issuer that vouched for it.
That is the entire identity footprint. No email address, display name, avatar
URL, phone number, password material, OAuth access token, or any other profile
field is copied out of Clerk, even though the SDK would happily hand them over.
A full compromise of the ScoutBoy database therefore leaks a list of opaque
subject strings and which players each one saved - and nothing that identifies a
human being.

## 3. Database model

Migration `0007_optional_accounts` (revises `0006_discovery_query_indexes`).

### `app_users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | Internal identity, used everywhere inside ScoutBoy |
| `auth_provider` | varchar(50) | `"clerk"` today; recorded so a second provider is a data question |
| `auth_issuer` | varchar(255), indexed | The verified `iss` claim |
| `external_subject` | varchar(255), indexed | The verified `sub` claim, opaque by design |
| `created_at` / `updated_at` | timestamptz | |

`UNIQUE (auth_issuer, external_subject)` - **not** subject alone. A subject is
only unique within its issuing tenant, so two Clerk instances (staging and
production, or a future second provider) can legitimately mint the same
`user_...` string. Keying on the subject by itself would silently join two
different people's favourites onto one list.

Rows are created **lazily and idempotently on the first MUTATION**, not on the
first authenticated request. Signing in and browsing writes nothing, and that is
enforced by the dependency graph rather than promised in prose:

| Endpoint | Dependency | Creates a row? |
| --- | --- | --- |
| `GET /api/me/favorites` | `get_optional_app_user` | No |
| `DELETE /api/me/favorites/{id}` | `get_optional_app_user` | No |
| `PUT /api/me/favorites/{id}` | `get_current_user` | Yes |
| `POST /api/me/favorites/merge` | `get_current_user` | Yes |

`get_optional_app_user` performs the SAME verification as the write path - same
signature, expiry, issuer and authorized-party checks, same 401s - and simply does
not insert. A verified identity with no row is not an error: it is an account that
has never saved a player, whose canonical list is empty, and that is what is
returned.

`DELETE` is on the read side deliberately. A removal stores nothing, so an account
with no row already satisfies the request; inserting one would be a write whose
only effect is to make "browsing writes nothing" untrue. An earlier version had
every endpoint create the row, which contradicted this document - the contradiction
is resolved in favour of the behaviour, not the prose.

### `user_favorites`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | Also the deterministic ordering tie-break |
| `user_id` | FK to `app_users.id` ON DELETE CASCADE, indexed | |
| `player_id` | FK to `players.id` ON DELETE CASCADE, indexed | |
| `created_at` | timestamptz | The saved timestamp |

- `UNIQUE (user_id, player_id)` - this is what makes `PUT` idempotent, and what
  decides a race between two concurrent adds.
- `INDEX (user_id, created_at, id)` - serves the one query every endpoint ends
  with: this user's rows, in canonical order.

**Ordering is `(created_at, id)`, never `created_at` alone.** A merge inserts
several rows inside one transaction and the timestamp default can hand them all
the same value; the autoincrement key is a total order by construction, so
appending it as the final term is what makes the canonical list reproducible on
SQLite and PostgreSQL alike.

## 4. API contract

All four routes live under `/api/me/` and require a verified token. They are
registered unconditionally, so the tracked OpenAPI contract is a property of the
code rather than of whichever environment exported it.

| Method | Path | Behaviour |
| --- | --- | --- |
| `GET` | `/api/me/favorites` | The canonical ordered player ids. **Never writes** |
| `PUT` | `/api/me/favorites/{player_id}` | Idempotent add. 404 if the player does not exist |
| `DELETE` | `/api/me/favorites/{player_id}` | Idempotent remove. Never 404s: "not on my list" is already true |
| `POST` | `/api/me/favorites/merge` | Union a guest list into the account |

Responses always carry the full canonical list plus what changed, so a client
never has to infer a disposition from a length comparison. `FavoritesResponse`
fields are **required**, not optional-with-default: the server always sends them
in full, and publishing them as optional would be a lie the whole frontend then
has to write `?? []` around.

Status codes:

- **401** - missing, malformed, expired, not-yet-valid, forged, wrongly-issued or
  wrongly-scoped token. Carries `WWW-Authenticate: Bearer`.
- **404** - `PUT` for a player id that does not exist.
- **409** - merge only. A concurrent change prevented the merge from completing
  within its bounded retry, so the caller is told to retry rather than handed a
  200 that omits players.
- **422** - non-positive player id, or a merge body over the limit.
- **503** - this deployment has no identity provider configured. Deliberately not
  401 (no credential would help) and not 404 (the route exists; this is a
  configuration state).

### Merge limit

`MAX_MERGE_PLAYER_IDS = 500`. A guest shortlist is assembled by hand, one player
at a time, from a ledger that shows a page at a time; a few dozen is a heavy real
list. 500 is well clear of that while bounding the work a single authenticated
request can ask of the database. Exceeding it is a 422 rather than a silent
truncation, because quietly dropping the tail of somebody's saved players is
worse than saying no.

## 5. Guest / account state machine

The frontend distinguishes seven favourites modes, and copy is derived from them
so no surface can claim something untrue.

| Mode | When | Counter copy |
| --- | --- | --- |
| `guest` | No provider, signed out, or the provider never answered | `My Favorites N · saved on this device` |
| `resolving` | Provider present, session not yet known | `My Favorites · checking your account` |
| `account-loading` | Signed in, first canonical list not yet available | `My Favorites · syncing with your account` |
| `account` | Signed in, list is the server's canonical list | `My Favorites N · saved to your account` |
| `account-saving` | Signed in and canonical, with a write in flight | `My Favorites N · saving to your account` |
| `account-unconfirmed` | Signed in, a merge failed, RETAINED device list on screen | `My Favorites N · saved on this device, not in your account yet` |
| `account-desynced` | Signed in, last operation failed | `My Favorites N · not saved to your account yet` |

Six account-relevant states rather than three, because collapsing any two of them
produces a claim that is not true at the moment it is shown.

**The number is withheld whenever it is genuinely unknown** - while the session
resolves, and while an account's list has not arrived. Reporting 0 in either case
would show a returning account holder "My Favorites 0 · saved to your account"
before their real list appeared: a confident statement about an empty account
that is not empty. This is why `count` is `number | null`.

**The last thing the user asked for is the thing that happens.** Each intent
carries a monotonic revision, and a settling request may retire only the intent it
started for. If the user changed their mind while the request was in flight, the
newer intent survives and is reconciled immediately afterwards. Before this,
a completing request deleted whatever intent it found - including a newer one -
and the queued follow-up then found nothing to do and exited, so the user's final
action was silently dropped on both Add->Remove and Remove->Add. Serialization is
unchanged: one request per player at a time, and one follow-up reconciliation
rather than one request per press.

Intent is recorded SYNCHRONOUSLY in the event handler, never inside a `setState`
updater. Recording it in an updater made it depend on React's render timing: the
chain's first microtask could run before the updater and find no intent at all,
so the request was never sent and the player stayed pending forever.

**Durability copy never runs ahead of the server.** The favourite control is
optimistic - the heart flips in the frame it was pressed, because that is
feedback the scout needs immediately - but the scope phrase is driven by the set
of in-flight writes, so it reads "saving to your account" until the server
confirms. With two concurrent writes, the first completion does not imply the
second landed: the mode stays `account-saving` until the pending set empties. A
canonical response is adopted for ordering, and any write still in flight has its
optimistic effect replayed on top, so the first of two adds cannot erase the
second.

**Resolution is bounded, once, for every surface.** Withholding the count is
right for the few hundred milliseconds a healthy Clerk load takes and wrong
forever. If the provider is unreachable - an outage, or a content blocker eating
its script - `isLoaded` never flips, and the counter would sit on "checking your
account" indefinitely while a favourite the scout had just saved sat in browser
storage, uncounted and unexplained.

The timer lives in ONE place: `AuthSessionValueProvider` publishes
`effectiveStatus`, which is the raw status until `RESOLVE_TIMEOUT_MS` (5s) of
`resolving`, and `unavailable` afterwards. The favourites counter, the navigation
account entry, the account-suggestion eligibility check and the retry
presentation all read that single value.

That unification is itself a fix. Previously the favourites provider ran its own
timer while the header and the suggestion read the raw status, so a stalled
provider left the header on "Checking account" indefinitely while the counter had
already, correctly, fallen back to device-local wording - two timers, two
opinions, one contradiction on screen.

In the `unavailable` state: favourites read as device-local (which is true - the
players really are on this device), the header reports "Accounts unavailable"
rather than offering a "Sign in" control that cannot open, and no account
suggestion is offered, because a provider that cannot load cannot create an
account either. Favouriting keeps working throughout. If the provider answers
late, the latch drops in the same render and the normal anonymous or
authenticated flow - including the merge - runs from there.

Throughout that whole time, favouriting stays usable and writes to browser
storage. A dead identity provider does not take the product down: this was
verified in a browser against a build pointed at an unreachable Clerk instance,
where Discovery, its filters, and all twelve favourite and compare controls
continued to work.

**A failed removal goes back where it was, in RELATIVE terms.** Rollback records
the player's NEIGHBOURS - the ids immediately before and after it at the moment of
the optimistic removal - and restores it before the nearest surviving next
neighbour, otherwise after the nearest surviving previous neighbour, otherwise
appended. It never duplicates.

Two earlier versions were wrong. The first appended, silently reordering a curated
list as a side effect of a network error. The second recorded an absolute index,
which goes stale the moment anything in front of it moves: remove B from
[A, B, C], then remove A while B's request is in flight, and index 1 now points
after C. Anchors describe a relation rather than a position, so they survive it -
that case now restores [B, C], and it is covered by test.

Because rollback touches one player on the CURRENT list rather than restoring a
whole-list snapshot, any unrelated optimistic change made while the request was in
flight survives it, and a later canonical response remains the ordering authority.

Guest storage keeps its existing key and format, `scoutboy.shortlist.v1`, a plain
array of positive integers. No versioned migration was needed, so none was
invented. Corrupt-state recovery, deduplication, stale-id retention, ordering and
reload persistence are all unchanged.

## 6. Merge ordering and failure behaviour

On a successful sign-in with a non-empty guest list:

1. Read the valid ordered guest favourites from browser storage **at that
   moment** (not from a stale closure, so a player favourited seconds before the
   session resolved still travels with the merge).
2. `POST /api/me/favorites/merge`.
3. **Keep the local guest data untouched until the server confirms.**
4. Adopt the server's returned canonical list.
5. **Only then** clear the guest list, so a private account list is never left
   readable by the next anonymous visitor to this browser.
6. On failure, retain the guest data, **keep showing it**, enter
   `account-unconfirmed`, and expose a non-destructive "Try again". A retry
   re-reads browser storage, so it sends exactly the list still on the device.

**The retained list stays on screen.** This is worth stating plainly because the
first implementation got it wrong: guest favourites survived in `localStorage`
but disappeared from the interface, because authenticated rendering substituted
an empty account list. The data was safe and the scout had every reason to think
it had been deleted. A failed merge now keeps the players visible, their hearts
pressed, the count accurate, and the copy honest about where they are.

**And the device stays the system of record until the merge succeeds.** While the
account is unconfirmed, favouriting and unfavouriting remain fully available (the
controls are never disabled) and stay entirely device-local: they update the
visible list AND `scoutboy.shortlist.v1` on every interaction, and issue no
individual `PUT`/`DELETE` and adopt no canonical response.

That is a correction, not a simplification. Those edits previously went to the
individual account endpoints, and the first success adopted the server's canonical
list as the visible one while `localStorage` still held the pre-merge snapshot - so
the account appeared to hold players it had never been given, and signing out
exposed a stale list rather than the one just edited. Retry now merges the list as
it stands at that moment, not the snapshot the session began with, and only a
complete successful merge clears device storage and moves the state to
server-origin. Signing out at any point exposes the latest retained list.

If instead an account LOAD fails with nothing trustworthy stored locally, the
count is withheld rather than shown as zero, and the copy says the list could not
be loaded. An unknown list is not an empty one, and another account's cached data
is never used as a fallback.

Server-side ordering rules, in order:

1. Whatever the account already holds keeps its established position. A list
   curated on one device is not reshuffled by signing in on another.
2. Guest ids the account already holds are reported as `already_present` and are
   not re-inserted, so a merge can neither duplicate nor reorder them.
3. Genuinely new guest ids are appended **in guest order**, after everything the
   account already had.
4. Ids resolving to no player are reported as `unknown` and never written, so a
   stale browser entry cannot create a dangling reference.

Duplicates collapse to their **first** occurrence - the earliest position is the
one the guest actually saw their list in, which also makes the normalization
stable under repeated merges.

Each attempt is one transaction: the block of missing rows lands, or none of it
does. What makes the call safe under concurrency is that a rolled-back attempt is
not the end of the story.

The first implementation rolled the batch back and returned. That meant a
concurrent insert of ONE requested player silently dropped every other valid
player in the same batch: they were neither persisted nor reported in `added`,
`already_present` or `unknown`. The merge now re-reads canonical state,
recomputes what is genuinely still missing, and finishes the remainder, bounded
by `MERGE_MAX_ATTEMPTS` (4). Each attempt inserts only what is actually absent,
so a uniqueness conflict means somebody else inserted that row - which makes the
next attempt's remainder strictly smaller, so the sequence converges on its own
and the bound is a safety net rather than the mechanism.

Two invariants are asserted rather than assumed:

- **Only a uniqueness race is retried.** A NOT NULL or foreign-key breach
  propagates. Swallowing every `IntegrityError` as "somebody beat me to it" would
  turn genuine data-integrity bugs into silently short lists.
- **The union is checked against reality.** If any valid requested player is
  still absent after the bound, the request answers **409** rather than a 200
  whose disposition lists quietly omit it. The client clears its device copy only
  on success, so a partial "success" is exactly how a guest list gets lost.

Combined with rules 2 and 4, this makes merge idempotent - running it twice
produces the same list, with the second run reporting everything as
`already_present`.

A merge with an empty body is a no-op that returns the account's existing list.
**A non-empty server collection is never overwritten by an empty client
initialization**, and the client additionally never issues the request at all
when it has no guest list.

## 7. Privacy boundary

**On sign-out:**
- The account's favourites are *not* copied into anonymous `localStorage`.
- The former account's list is not displayed.
- The `["me", ...]` React Query namespace is dropped.
- Anonymous favouriting is immediately usable again.

**On account switch:** the same clearing runs, keyed on the account identity.
Private cache entries include the verified account key
(`["me", "favorites", accountKey]`), so one account's cached list is not merely
shadowed by the next - it is removed.

**Account identity is part of the state, not a check beside it.** The
account-favourites record carries the `accountKey` it belongs to and a generation
token. Rendering filters on the stamp, so account A's list cannot appear under
account B even for the single transitional frame between the identity changing and
any effect running - which is precisely the window the first implementation left
open by clearing A's list in an after-render effect.

**The generation cannot repeat.** The token is
`${accountKey}#e${epoch}#a${attempt}`, where `epoch` is a monotonic counter that
advances on every authentication lifecycle transition - anonymous to account,
account to anonymous, account A to account B, and signing out then back into the
SAME account, which passes through two of them. It is never reset. An earlier
token of `${accountKey}#${attempt}` was not unique enough: sign out and back into
the same account and both parts repeated, so a response belonging to the previous
login matched the new session's token and was allowed to mutate it. A generation
value is now never reused for the life of the page, and per-player intent maps and
promise chains are keyed to it, so nothing queued under one session resumes under
the next.

Every asynchronous step then re-checks the identity before mutating anything
visible: the load, the merge, each per-player add and remove, each rollback, each
query-cache write and each error message. A request cannot be recalled from the
network, but it can be made unable to land, and that is what happens - the
response for a departed account is discarded. Per-player intent maps and promise
chains are discarded with the identity too, so nothing queued under A resumes
under B, while rapid-toggle serialization inside a single account is preserved.

Tokens are minted per request from the current session, so no request ever
carries a previous account's token, and no token is written to a log.

**Tokens** are minted per request, passed straight into one `Authorization`
header, and never written to `localStorage`, `sessionStorage`, an
application-managed cookie, or a module variable.

## 8. The contextual account suggestion

A compact, non-modal callout shown to a guest **after** a successful new
favourite. It appears in the shared bottom rail, stacked *above* the compare tray
rather than over it, because that boundary is already the product's home for
transient anchored surfaces - and because an anchored element cannot move the
favourite control the user just pressed.

It appears only when all of these hold: a guest added a player they had not saved
before, this build offers accounts, nobody is signed in, it has not been shown
this browser session, and no explicit "Not now" is inside its cooling-off window.

So: never on load, never after a removal, never merely because saved players
exist, never for an account holder, never in an auth-free build, and never from
Compare - the comparison queue is not account-synchronized in this phase, so
offering an account there would promise something untrue.

Behaviour:

- **Never steals focus.** Focus stays on the favourite control. Dismissing from
  *inside* the callout returns focus to that control rather than dropping it on
  `document.body`; dismissing with Escape from elsewhere leaves focus alone.
- Escape and "Not now" are the same decision and have the same effect.
- Announced once via a polite `role="status"` carrying only the NEW information,
  so it queues behind - rather than duplicating - the existing favourites live
  region.
- Shown at most once per browser session (`sessionStorage`).
- "Not now" suppresses it for **30 days**, recorded in a small versioned
  preference at `scoutboy.accountSuggestion.v1`.
- Corrupt, unparseable, wrong-version, negative or future-dated preference state
  **fails open**: it is treated as no dismissal. An unreadable preference must
  never throw on the favourite path, and offering once more is a far smaller harm
  than a broken save.
- Motion reuses the tray's exact entrance/exit cadence and collapses under
  reduced motion.

## 9. Authentication and authorization design

### Why manual JWT verification rather than the Clerk Python SDK

`clerk-backend-api` is Clerk's official Python SDK, and it would have been the
first choice. Every release from **5.0.0 onward requires Python >= 3.10**, while
this repository declares `requires-python = ">=3.9"` and CI runs a 3.9 matrix
leg. The options were:

1. Pin the SDK back to 2.x (the last 3.9-compatible line, several majors behind)
   - a worse security posture than the alternative, on the one component whose
   entire job is security.
2. Drop Python 3.9 - a stack change this phase has no mandate to make, and one
   that would ripple through CI, the Dockerfile and the packaging metadata.
3. Use Clerk's other documented backend mechanism: **manual JWT verification**
   against the instance's published JWKS.

Option 3 was taken. It is a supported Clerk integration path, not a home-grown
identity system: Clerk still mints the tokens and owns the keys, and ScoutBoy
only verifies them. `pyjwt[crypto]` supports Python 3.9 and is a far smaller
dependency surface than the full SDK.

If the 3.9 floor is ever dropped, migrating to `clerk-backend-api` is a
contained change: it would replace `ClerkTokenVerifier` and nothing else.

### What is verified, on every private request

- **Signature**, against the key the token's `kid` names, fetched from Clerk's
  published JWKS. The algorithm list is pinned to `["RS256"]`, so `alg: none` and
  an HMAC token forged with a public key as its secret are both rejected before
  any key lookup happens.
- **`exp` and `nbf`**, with a small configured leeway.
- **`iss`**, against the configured issuer.
- **`azp`**, against the configured authorized parties. This is Clerk's
  documented CSRF defence, and it is **required** here rather than optional: a
  token minted for somebody else's front end is cryptographically perfect and
  must still not be honoured.
- **`aud`**, but only when an audience is configured, because a default Clerk
  session token carries none.
- **`sub` must be present and non-empty.**

JWKS retrieval is bounded and cache-aware: a `PyJWKClient` with `cache_keys` and
`max_cached_keys`, wrapped in an explicit TTL so key rotation is picked up within
`SCOUTBOY_CLERK_JWKS_CACHE_SECONDS` rather than never. A key-server outage
surfaces as 401, never as an unhandled 500.

### No Next.js middleware, and no Clerk secret key

Clerk's Next.js quickstart installs `clerkMiddleware()` in `proxy.ts`. This
implementation had it, and removed it: it fails at runtime with
`Missing secretKey`, because that middleware performs the server-side session
handshake against Clerk's Backend API and therefore requires `CLERK_SECRET_KEY`
on every deployment that runs it.

ScoutBoy has no server-side Clerk needs. It never calls `auth()` or
`currentUser()`, protects no Next.js route (every route is public), and reads no
session during server rendering; the private surface is FastAPI, which authorizes
from a bearer token it verifies itself against Clerk's public JWKS. Keeping the
middleware would have added a mandatory secret, an edge function on every
request, and a new class of deployment failure, in exchange for nothing this
product uses.

The cost is stated rather than hidden: there is no server-side handshake. Session
lifetime and token refresh are handled entirely by Clerk's browser SDK, exactly
as in a plain `@clerk/clerk-react` single-page app. `<ClerkProvider dynamic={false}>`
keeps the provider static, so no server component attempts to resolve a session
that has no middleware to resolve it.

**Consequence: ScoutBoy needs no Clerk secret key anywhere.** If server-rendered
private content is ever required, the middleware and a `CLERK_SECRET_KEY` return
together, as a deliberate decision at that point.

### The authorization boundary

The external subject is taken **exclusively** from the verified token. There is
no `user_id` path parameter, no owner field in any request body, and no header
outside `Authorization` that names a person - cross-account access is
unrepresentable rather than merely forbidden. The service layer enforces this
structurally: every function takes an `AppUser` object, never an id, and a test
asserts that signature.

CORS is not part of this. It constrains which browser origins may *make* a
request and says nothing about who the requester is.

## 10. Configuration

### Backend (all `SCOUTBOY_`-prefixed)

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `SCOUTBOY_AUTH_ENABLED` | no | `false` | Turns the private surface on |
| `SCOUTBOY_CLERK_ISSUER` | **when enabled** | - | Frontend API origin = the `iss` claim. Must be https |
| `SCOUTBOY_CLERK_AUTHORIZED_PARTIES` | **when enabled** | - | Comma-separated `azp` allow-list |
| `SCOUTBOY_CLERK_JWKS_URL` | no | `<issuer>/.well-known/jwks.json` | Must be https |
| `SCOUTBOY_CLERK_JWT_AUDIENCE` | no | none | Only if your JWT template mints `aud` |
| `SCOUTBOY_CLERK_JWKS_CACHE_SECONDS` | no | `300` | Key-set TTL |
| `SCOUTBOY_CLERK_JWKS_MAX_KEYS` | no | `8` | Retained signing keys |
| `SCOUTBOY_CLERK_LEEWAY_SECONDS` | no | `10` | Clock-skew tolerance |

Enabling auth with any required value missing, or with an http (rather than
https) issuer or JWKS URL, **raises at settings construction** - the API refuses
to start rather than serving a verifier it cannot anchor to a tenant.

### Frontend

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Browser-safe publishable key. Its presence enables accounts |
| `NEXT_PUBLIC_SCOUTBOY_AUTH_ENABLED` | Optional switch. `0`/`false` forces off; `1`/`true` forces on and **fails the build** if the key is missing |

**No secret ever gets a `NEXT_PUBLIC_` name.** ScoutBoy's frontend has no use for
a Clerk secret key and reads none; the backend verifies tokens with public keys
only, so it does not need one either. Nothing in this repository should ever
contain a real Clerk credential.

## 11. Local development without Clerk keys

This is the default. Nothing needs to be configured, disabled, or stubbed:

```
make seed
make dev
```

You get the anonymous product. `make test`, `make lint`, `make e2e`,
`make docker-smoke` and the production build all run with no Clerk tenant, and
the automated suites never touch the network for identity: the backend tests
generate an RSA key pair in-process and mint real RS256 tokens against it, and
the frontend tests inject the auth boundary directly.

To try the real flow you need a Clerk application:

1. Create one at the Clerk dashboard and copy the **publishable** key.
2. Note the instance's Frontend API origin, `https://<something>.clerk.accounts.dev`.
3. Export, in one shell, then start the stack:

```
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
export SCOUTBOY_AUTH_ENABLED=true
export SCOUTBOY_CLERK_ISSUER=https://your-instance.clerk.accounts.dev
export SCOUTBOY_CLERK_AUTHORIZED_PARTIES=http://localhost:3000
make dev
```

## 12. Live-provider verification steps

Against a real tenant, verify by hand:

1. Sign up with a new email. Confirm the account entry switches to "Account" and
   the counter to "saved to your account".
2. As a guest first, favourite two players, then sign in. Confirm the merge
   request fires once, both players appear on the account, and
   `scoutboy.shortlist.v1` is emptied only afterwards.
3. Favourite a third player while signed in. Reload. Confirm all three persist.
4. Open a second browser (or a private window), sign in as the same user, and
   confirm the same three players appear.
5. Sign out. Confirm the list empties, `localStorage` was not seeded with the
   account's players, and favouriting still works immediately.
6. Sign in as a *different* account and confirm the first account's players are
   not visible.
7. With devtools throttled to offline, toggle a favourite and confirm it rolls
   back and reports the failure rather than pretending to have saved.

## 13. The comparison tray on the comparison page

The tray exists to carry a scout from wherever they are TO the comparison. On the
comparison itself it has no errand left: both players are already on screen, in
full, with their own controls. So it stands down there.

Suppressed by ROUTE, never by mutating the queue. The selection is the user's: it
stays in `scoutboy.compareQueue.v1` untouched, the comparison page still receives
it, and leaving `/compare` brings the tray straight back with the same two
players. Everything before navigation is unchanged - it appears when the
device-local queue is populated, its remove/clear/disabled behaviour is intact,
and "Open comparison" navigates with the same `?a=&b=` parameters.

The route is folded into the tray's existing `usePresence` `active` term rather
than short-circuiting the component, so the established exit animation plays on
the way out and collapses under reduced motion exactly as an emptied queue does.
Nothing waits on it: navigation is never delayed by the animation.

The account suggestion is independent and may still occupy the bottom rail on
`/compare` - favouriting is not a Compare action. With neither surface present the
rail is childless, zero-height and `pointer-events: none`, so it cannot intercept
a click, obscure content, or introduce visible spacing. The tray's own styling,
geometry, wording, dimensions and placement are untouched everywhere else.

Compare remains device-local in this phase. Favourites are the only data
synchronized to an account.

## 14. Provider-owned surfaces

Clerk's in-page components (sign-in, sign-up, and any popover) are themed through
`SCOUTBOY_CLERK_APPEARANCE`: Inter, warm paper and pitch green, hairline borders,
`borderRadius: 0`, our focus-ring colour, 44px control heights, no shadows, no
gradients, no shimmer, and no Clerk logo block. The header's account entry is
ScoutBoy's own square `.btn`, not Clerk's `<UserButton>`, whose trigger is a
circular avatar the product has no geometry for.

**What cannot be themed from here, stated plainly rather than glossed over:**

- Clerk's **hosted Account Portal** - the pages on Clerk's own domain reached
  from "Manage account". ScoutBoy does not link to it, but a user who navigates
  there sees Clerk's design, not ours.
- Any **provider-hosted step inside an OAuth or email-verification flow**:
  Google's consent screen, an emailed magic-link landing page, and so on.
- Clerk's **CAPTCHA / bot-protection widget**, if enabled on the instance, which
  renders a third-party iframe we do not control.

These are provider-owned. The visual gate passes for the surfaces ScoutBoy
renders; it is not claimed for the surfaces Clerk hosts.

## 15. Where the gates were run

The repository's gates are Linux-shaped (`scripts/run_e2e.sh` and
`scripts/lib/fixture_env.sh` are POSIX scripts, and CI runs on ubuntu-latest).
They were exercised on both platforms during this work:

| Gate | Windows host | Linux (Docker) |
| --- | --- | --- |
| Ruff, Black | yes | yes |
| Python suite + 90% coverage gate | yes (92.09%) | yes |
| ESLint, tsc, Vitest | yes | n/a (same toolchain) |
| Production frontend build | yes | yes (inside the E2E gate) |
| Playwright E2E | yes | yes |
| Cross-browser matrix | yes | yes |
| PostgreSQL migration + concurrency smoke | yes (containerized PostgreSQL 16) | same engine |
| Full-stack container health | yes (`make docker-smoke`) | same containers |

One local-only wrinkle worth recording, because it will bite the next person who
runs the gates from a Windows checkout: this clone has `core.autocrlf=true`, so
the shell scripts arrive with CRLF while the committed blobs are LF. Running them
under Linux then fails with `set: pipefail: invalid option name`. That is a
checkout artifact, not a repository defect - the Linux verification normalises
copies into `/tmp` and leaves the working tree alone.

## 16. Known limitations

- **No live-tenant verification was performed for this phase.** No Clerk
  credentials were available. Every account behaviour is covered by deterministic
  offline tests; none of it has been exercised against a real Clerk instance.
  Section 12 is the checklist to run when credentials exist.
- Because the header uses ScoutBoy's own control rather than `<UserButton>`,
  Clerk's built-in account-management menu is not reachable from the header.
- `account-desynced` is per-session state. A reload while desynced re-attempts
  the load rather than restoring the previous error message.
- There is no offline write queue. A favourite toggled with no connection rolls
  back and says so; it is not replayed later.
- Favourites are not paginated. A pathologically large list is fetched whole.
- The 30-day suppression window is per-browser, in `localStorage`. Clearing site
  data resets it, and it does not follow an account.
- SQLite does not enforce foreign keys by default in this project's
  configuration. Player existence is therefore validated explicitly in the
  service layer on every write, so the behaviour is identical on both engines
  regardless.
- While an account's first list is still loading (a sub-second window),
  favouriting is announced as "still syncing" rather than queued. Once the list
  has arrived - or once a merge has failed and the device becomes the system of
  record - favouriting is fully available again.
- A superseded write keeps its player in the pending set until the follow-up
  request settles, so the scope copy reads "saving to your account" for slightly
  longer than one round trip when a scout changes their mind mid-flight. That is
  the honest reading: nothing is durable until the last request lands.

## 17. Deferred work

Explicitly **not** in 8.4A: mandatory accounts, paywalls or gated features,
home-grown passwords or sessions, social profiles, public or shared favourite
lists, collaboration, comments or notes, saved searches or Discovery presets,
recently viewed players, comparison snapshots, cloud-synchronized compare queues,
email marketing, analytics or behavioural tracking, a full account
deletion/export workflow, dark mode, any visual redesign, and any change to
RoleFit, ranking or Discovery filters.

## 18. Relationship to Milestone 9

**This phase is not the comprehensive Milestone 9 security audit and must not be
read as one.**

What 8.4A does claim, because none of it is deferrable when introducing an
identity boundary at all:

- token signature, expiry, not-before, issuer and authorized-party validation;
- authorization isolation between accounts, enforced structurally;
- secrets kept out of the bundle and out of the repository;
- no bearer token in any browser storage;
- no production auth bypass anywhere in the test harness.

What it does **not** claim, and what Milestone 9 still owes: rate limiting on the
private endpoints, audit logging, a formal threat model, dependency
supply-chain review, security headers and CSP, penetration testing,
session-revocation propagation timing, and a data-retention and deletion policy.

## 19. Where the code lives

| Concern | File |
| --- | --- |
| Settings and validation | `apps/api/app/core/config.py` |
| Token verification, JWKS cache, user resolution (read vs write dependencies) | `apps/api/app/core/auth.py` |
| 401 / 503 error shapes | `apps/api/app/core/errors.py` |
| ORM models | `apps/api/app/models/orm/accounts.py` |
| Request/response schemas | `apps/api/app/models/schemas/account.py` |
| Ordering and merge semantics | `apps/api/app/services/favorites_service.py` |
| Routes | `apps/api/app/api/routes/me.py` |
| Migration | `db/migrations/versions/0007_optional_accounts.py` |
| Backend tests | `apps/api/app/tests/test_account_favorites.py`, `account_auth.py` |
| Build-time auth configuration | `apps/web/src/lib/auth/config.ts` |
| Provider-agnostic session boundary | `apps/web/src/lib/auth/session.tsx` |
| The only Clerk-importing module | `apps/web/src/lib/auth/clerk-session.tsx` |
| Clerk theming | `apps/web/src/lib/auth/clerk-appearance.ts` |
| Suggestion preference state | `apps/web/src/lib/auth/suggestion-state.ts` |
| Guest/account favourites state machine, intent revisions, session epoch | `apps/web/src/lib/state/scouting-state.tsx` |
| Private API client | `apps/web/src/lib/api/favorites.ts` |
| The suggestion | `apps/web/src/components/account/AccountSuggestion.tsx` |
| Shared anchored surface | `apps/web/src/components/common/BottomRail.tsx` |
| Frontend tests | `apps/web/src/tests/account-favorites.test.tsx` |
| Compare-tray route tests | `apps/web/src/tests/compare-tray-route.test.tsx` |
| E2E | `tests/e2e/optional-accounts.spec.ts` |

## 20. Synchronization invariants, and the test that holds each one

Every row is a defect that was found and fixed, stated as the property that must
now hold. The named test is the one that fails if it stops holding.

### Favourites state

| Invariant | Test |
| --- | --- |
| The last intent expressed wins, even if it arrives after the request started (Add then Remove) | `Intent changed while a request was already in flight > Add then Remove: the removal is sent and wins` |
| ...and in the other direction (Remove then Add) | `... > Remove then Add: the addition is sent and wins` |
| Two requests for one player never overlap, and a burst produces ONE follow-up | `... > never overlaps two requests for the same player` |
| A superseded FAILURE reconciles instead of rolling back to a state the user abandoned | `... > reconciles rather than rolling back when a FAILED write was superseded` |
| A failed removal returns before its surviving next neighbour | `Rollback ordering uses neighbours, not indices > restores B before C when A was removed while B was pending` |
| ...or after its surviving previous neighbour | `... > falls back to the previous neighbour when the next one has gone` |
| ...or appended, without duplicating, when neither survives | `... > appends when neither neighbour survives, without duplicating` |
| Unrelated optimistic edits survive a rollback | `... > preserves an unrelated tail addition made while the removal was pending` |
| The count is never a fabricated zero | `Truthful account-state copy > never flashes a zero while a returning account's list loads` |
| Durability copy waits for the server | `... > says Saving, not saved, while an add is pending` |
| Concurrent writes stay pending until ALL settle | `... > stays pending until EVERY overlapping write has settled` |

### Unconfirmed merges

| Invariant | Test |
| --- | --- |
| The retained list stays visible, pressed, counted and stored | `Guest to account merge > keeps the retained list VISIBLE and accurate while a failed merge waits to retry` |
| Additions stay device-local, with no individual account request | `Favouriting while a guest merge is still unconfirmed > adds device-locally, with no individual account request` |
| Removals likewise, and the controls are never disabled | `... > removes device-locally, with no individual account request` |
| Signing out exposes the LATEST edited list | `... > exposes the LATEST device list after signing out` |
| Retry sends the edited list, and only success retires it | `... > retries with the LATEST edited list, and only then retires the device copy` |
| Repeated failure loses nothing and stays editable | `... > keeps editing and never loses the list through repeated retry failures` |
| A failed LOAD with nothing local withholds the count | `... > withholds the count when an account load fails with nothing trustworthy locally` |

### Session generations

| Invariant | Test |
| --- | --- |
| A delayed SUCCESS from a previous account cannot touch the current one | `An in-flight request that outlives its account > cannot change B's list, count, mode or error with A's delayed SUCCESS` |
| A delayed FAILURE likewise | `... > cannot change B's list, count, mode or error with A's delayed FAILURE` |
| No transitional frame renders the previous account's list | `Identity changes are clean > never renders account A's list once the identity has changed` |
| Signing back into the SAME account rejects the previous login's response | `Signing back into the SAME account > ignores a request left over from the previous login` |
| ...including its failures | `... > ignores a FAILED request left over from the previous login` |
| One account's token is never sent for another | `Identity changes are clean > does not carry one account's token into another account's request` |
| No bearer token is ever logged | `... > logs no bearer token to the console` |

### Account resolution

| Invariant | Test |
| --- | --- |
| One bounded timer, shared by every surface | `Account resolution is bounded once, for everyone > moves every surface off Checking account when the window expires` |
| A stalled provider offers no control that cannot open | same test |
| Late anonymous resolution recovers cleanly | `... > recovers into the real ANONYMOUS state if the provider answers late` |
| Late authenticated resolution runs the normal merge | `... > recovers into the real AUTHENTICATED state if the provider answers late` |
| An auth-free build arms no timer and issues no private request | `... > arms no timer at all, and shows no account UI, when auth is disabled` |

### Server persistence

| Invariant | Test |
| --- | --- |
| Reads never insert an account row | `test_reading_favorites_verifies_the_identity_without_writing_anything` |
| The first mutation creates exactly one | `test_the_first_mutation_lazily_creates_exactly_one_account` |
| A merge creates the row it needs | `test_a_merge_lazily_creates_the_account_it_needs` |
| The read path is not a weaker gate | `test_reads_and_writes_share_one_verification_path` |
| Disposition lists are disjoint and exhaustive | `test_merge_dispositions_are_disjoint_and_exhaustive` |
| A concurrent insert does not drop the rest of the batch | `test_a_concurrent_insert_does_not_drop_the_rest_of_the_batch` |
| Post-race merges stay idempotent and stably ordered | `test_merge_after_a_race_is_idempotent_and_stably_ordered` |
| A non-uniqueness IntegrityError is not swallowed | `test_an_unrelated_integrity_error_is_not_swallowed_as_a_race` |
| An unresolvable conflict is reported, not returned short | `test_an_unresolvable_conflict_is_reported_rather_than_returned_short` |
| Real PostgreSQL sessions racing one merge converge | `test_a_real_concurrent_merge_loses_nothing_on_postgresql` |
| Four parallel threads converge with no duplicates | `test_parallel_merges_of_the_same_list_converge_on_postgresql` |

### Comparison (unchanged by these corrections)

| Invariant | Test |
| --- | --- |
| Open comparison appears with two queued and carries both into the URL | `Compare tray visibility by route > behaves exactly as before away from the comparison route` |
| The tray is absent on `/compare`, queue untouched | `... > is absent on the comparison route, and leaves the queue untouched` |
| It returns after navigating away | `... > returns with its queue intact once the scout leaves the comparison` |
| End to end, in three engines | `the compare tray stands down on the comparison page in every engine` |
