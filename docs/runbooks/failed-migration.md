# Runbook: Failed migration

1. Stop API writes. Capture the failing migration name and sanitized error; never paste a database
   URL or password into an issue.
2. Check service state with `docker compose -f docker-compose.full.yml ps` and database logs with
   `docker compose -f docker-compose.full.yml logs db migrate`.
3. Inspect the current revision with `.venv/bin/alembic current` (host) or by rerunning the Compose
   `migrate` service. Compare it with `.venv/bin/alembic heads`.
4. Back up a non-disposable database before corrective work. For a disposable local stack, prefer
   creating a fresh database and running `alembic upgrade head` from base.
5. Fix the migration with additive, dialect-compatible changes and verify both a fresh migration
   from base and an upgrade from the last released revision. Never edit production state manually
   without recording the exact remediation.
6. Restart the API only after `/readyz` returns HTTP 200 and confirm a representative player read.

Do not use `make db-reset` on data that must be retained; that target is destructive.
