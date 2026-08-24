# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private
**Report a vulnerability** / Security Advisory feature for this repository and include:

- the affected component and revision;
- reproduction steps or a minimal proof of concept;
- the likely impact and any known mitigations;
- whether the report contains secrets or personal/provider data.

The maintainer will acknowledge reports and coordinate validation and disclosure on a best-effort
basis. This portfolio project does not promise a commercial support SLA. Do not test against
systems, accounts, or data you do not own or have permission to use.

## Supported code

Security fixes target the current `main` branch. Historical commits, local modifications, and
unmaintained deployments are not supported releases.

## Baseline controls

Pull requests run secret scanning plus Python and production JavaScript dependency audits.
Dependabot proposes dependency and GitHub Actions updates. Production mode refuses to start without
an admin token and rejects wildcard CORS origins. These controls reduce common risks; they are not
a claim of penetration testing, uptime guarantees, or commercial production readiness.

The Python audit checks the declared project dependency graph rather than the audit tool's own
environment. Temporary upstream exceptions, if needed because no compatible fixed release exists,
must be listed explicitly in the workflow with an explanation and revisited by Dependabot updates.

### Temporary Python audit exceptions

As of 2026-07-22, `PYSEC-2026-161`, `PYSEC-2026-248`, `PYSEC-2026-249`,
`PYSEC-2026-2280`, and `PYSEC-2026-2281` list Starlette 1.x fixes while the newest published
Starlette is 0.49.3 and FastAPI's published compatible range remains below 0.50.
`PYSEC-2026-2132` and `PYSEC-2026-2270` similarly list Click 8.3.3 and python-dotenv 1.2.2,
which are not yet published on the configured PyPI index. CI ignores only these exact ids and
continues to fail on any other finding. Remove each exception as soon as a compatible fixed release
is published; Dependabot's weekly run is the review trigger.

## Optional end-user accounts (Milestone 8.4A)

Accounts are optional and disabled by default. With no identity configuration the application has
no authentication surface at all, and the private `/api/me/*` routes answer 503.

When enabled, Clerk is the identity provider. ScoutBoy implements no passwords, sessions, resets,
or email verification, and stores no personal data: an account row holds an opaque external
subject and the issuer that vouched for it, and nothing else.

Controls that are in force on that boundary:

- Every private request verifies the token's RS256 signature against Clerk's published JWKS, plus
  `exp`, `nbf`, `iss`, and `azp` (Clerk's documented CSRF defence, required rather than optional
  here). The algorithm list is pinned, so `alg: none` and public-key-as-HMAC forgeries are rejected.
- The account is derived solely from the verified subject. No request body, path, query, or header
  outside `Authorization` can name a user, so cross-account access is unrepresentable rather than
  merely blocked.
- Reads do not write. `GET /api/me/favorites` and `DELETE /api/me/favorites/{id}` verify the identity
  through the same checks as the write path but never insert an account row, so signing in and
  browsing leaves no database trace. The row is materialized on the first request that actually
  stores something.
- Enabling authentication with incomplete or inconsistent configuration raises at start-up rather
  than serving a verifier that is not anchored to a tenant.
- Bearer tokens are minted per request and are never written to `localStorage`, `sessionStorage`,
  an application-managed cookie, or a module variable.
- Only Clerk's browser-safe **publishable** key is ever exposed to the client. No secret is given a
  `NEXT_PUBLIC_` name, and the backend needs no Clerk secret key because it verifies with public
  keys only.
- The test suites contain no production authentication bypass, magic test user, or backdoor route.
  Backend tests generate an RSA key pair in-process and verify real tokens against it; frontend
  tests inject the application's own auth boundary.

## Saved work (Milestone 8.4B)

8.4B extends the same optional-account boundary to two further durable collections: saved Discovery
views and saved comparison setups. It introduces no new configuration, no new secret, and no new
identity mechanism - the six new `/api/me/*` routes are authorized by exactly the token verification
described above, and answer 503 when no identity provider is configured.

Controls specific to this surface:

- **No arbitrary string reaches storage.** A saved Discovery view is a fixed set of typed,
  individually bounded columns - never a URL, query string, redirect target or opaque blob. A saved
  comparison is two integer player references plus a role key. There is no field anywhere in the
  contract that accepts a URL, so `javascript:` and `data:` payloads are unrepresentable rather than
  filtered.
- **No analytical result is persisted.** A saved comparison stores participants and a role and has
  no column for a score, conclusion, confidence value or evidence summary, so a stale figure cannot
  later be presented as current.
- **Ownership stays unrepresentable from outside.** No `user_id` path parameter, no owner field in
  any body, no header outside `Authorization` that names a person. The `client_id` in a path
  addresses a row *within* the caller's own account; a well-formed id belonging to another account
  resolves to nothing, and a rename of one returns 404 - the same shape as "does not exist" - so the
  response is not an existence oracle. Every service function takes an account object, never an id.
- **`client_id` is a canonical UUID on both the body and the path**, declared once and applied to
  both. Queries are parameterized throughout.
- **Reads and no-op mutations create no account row.** An idempotent delete, a rename of a
  non-existent item, and a merge with nothing storable all leave no database trace.
- **Bounded everywhere:** 200 items per merge body, 200 items per collection per account, 80-character
  labels, 120-character free-text filter predicates, and schema ceilings on every numeric bound.
- **Labels are plain text and are stored verbatim.** They are rendered as React text and are never
  interpolated into markup, a URL or SQL. Explicit tests store `<img src=x onerror=alert(1)>` and
  `<script>alert(1)</script>` and assert that neither becomes markup, at the API, unit and E2E layers.
  Control characters (C0, DEL, C1, U+2028/U+2029) are rejected.
- **Enumerated values are checked against live configuration** (roles, sorts, position groups,
  playstyles), so a saved view cannot hold a filter the interface cannot display or the API accept.
- **No account data is written to browser storage**, and private query caches are partitioned by
  account key and dropped on identity change.

Deleting an account cascades its saved work. Deleting a *player* does not: the comparison foreign
keys are `ON DELETE SET NULL`, so a data refresh cannot silently destroy a scout's saved setups, and
the interface reports the unavailable side honestly instead of resolving a dangling reference.

See `docs/milestone_8_4b_saved_work.md`.

This phase is **not** the comprehensive security audit planned for Milestone 9. Rate limiting on
the private endpoints, audit logging, a formal threat model, security headers/CSP, penetration
testing, and a data-retention and deletion policy all remain outstanding. See
`docs/milestone_8_4a_optional_accounts.md` and `docs/milestone_8_4b_saved_work.md`.

Never commit credentials, `.env` files, Clerk keys, database dumps, raw provider payloads, or
licensed data. Rotate any credential immediately if it is exposed, even if a later commit removes
it.
