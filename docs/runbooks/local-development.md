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
