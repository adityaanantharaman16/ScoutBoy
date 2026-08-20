# Runbook: Local development

## SQLite (default)

Prerequisites are Python 3.9 or 3.11, Node 20, and Corepack/pnpm.

```bash
corepack enable
make install
make seed
make recompute-ratings
make dev
```

Open the web app at `http://localhost:3000`. The API is at `http://localhost:8000`, liveness at
`/healthz`, and readiness at `/readyz`. SQLite data lives at `db/scoutboy.db` and is local only.

## PostgreSQL database with host-run apps

```bash
docker compose up -d db
export DATABASE_URL=postgresql+psycopg://scoutboy:scoutboy@localhost:5432/scoutboy
.venv/bin/pip install -e ".[postgres]"
make db-migrate seed recompute-ratings
make dev-pilot
```

## Full-stack containers

```bash
export SCOUTBOY_ADMIN_TOKEN=choose-a-local-secret
make docker-up
make docker-logs
make docker-down
```

The defaults publish web on `3000`, API on `8000`, and PostgreSQL on `5432`. Override them with
`SCOUTBOY_WEB_PORT`, `SCOUTBOY_API_PORT`, and `SCOUTBOY_POSTGRES_PORT`. Override the browser API
URL before building with `NEXT_PUBLIC_API_BASE_URL`; it must be reachable by the browser, not only
inside Docker.

The local full-stack path bootstraps deterministic synthetic sample data after migrations so the
UI is usable without raw provider snapshots. It does not present that fixture as provider data.

Compose requires an explicit token. Set a strong `SCOUTBOY_ADMIN_TOKEN` and explicit
`SCOUTBOY_WEB_ORIGINS` for any deployment. Compose is a delivery reference, not a hosted production
platform.

## Optional accounts (Milestone 8.4A)

**Skip this entire section unless you specifically want to work on accounts.**
Every command above runs the anonymous product with no Clerk tenant, no keys and
no stubs, and the full test suite, production build, E2E and Docker smoke all
pass in that state. My Favorites lives in browser storage.

### Enabling accounts locally

You need a Clerk application and its **publishable** key. ScoutBoy never uses a
Clerk secret key; the backend verifies tokens with Clerk's published public keys.

```bash
# Frontend: presence of the publishable key is what enables the account UI.
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here

# Backend: the private /api/me/* surface.
export SCOUTBOY_AUTH_ENABLED=true
export SCOUTBOY_CLERK_ISSUER=https://your-instance.clerk.accounts.dev
export SCOUTBOY_CLERK_AUTHORIZED_PARTIES=http://localhost:3000

make db-migrate
make dev
```

`NEXT_PUBLIC_*` values are inlined at build time, so a production build must be
rebuilt after changing them. `make dev` picks them up on restart.

### Full-stack containers with accounts

The same four variables are read by `docker-compose.full.yml`; the two
`NEXT_PUBLIC_*` ones are passed as build args because Next.js inlines them.

```bash
export SCOUTBOY_ADMIN_TOKEN=choose-a-local-secret
export SCOUTBOY_AUTH_ENABLED=true
export SCOUTBOY_CLERK_ISSUER=https://your-instance.clerk.accounts.dev
export SCOUTBOY_CLERK_AUTHORIZED_PARTIES=http://localhost:3000
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
make docker-up
```

### Diagnosing a misconfiguration

| Symptom | Cause |
| --- | --- |
| API refuses to start, `SCOUTBOY_CLERK_ISSUER is required` | `SCOUTBOY_AUTH_ENABLED=true` with no issuer |
| API refuses to start, `must be an https URL` | An `http://` issuer or JWKS URL |
| Build fails, `NEXT_PUBLIC_SCOUTBOY_AUTH_ENABLED is set but ...` | Forced on without a publishable key |
| `/api/me/favorites` returns **503** | The API has accounts disabled |
| `/api/me/favorites` returns **401** with `authorized party is not accepted` | The browser origin is missing from `SCOUTBOY_CLERK_AUTHORIZED_PARTIES` |
| `/api/me/favorites` returns **401** with `issuer is not accepted` | Frontend and backend point at different Clerk instances |
| Account UI missing while signed in elsewhere | The web build was made without the publishable key |

Never commit real Clerk keys. `.env` is untracked; keep it that way.
