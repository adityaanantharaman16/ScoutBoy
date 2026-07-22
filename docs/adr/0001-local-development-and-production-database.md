# ADR 0001: Local development and production database

## Context

ScoutBoy needs a zero-friction portfolio setup and a database path that exercises production-like
concurrency, migrations, and drivers. Existing development and tests use SQLite; SQLAlchemy and
Alembic already support PostgreSQL.

## Decision

Keep SQLite as the default for local development and unit tests. Use PostgreSQL 16 for the
full-stack Compose environment, CI integration smoke, and any production deployment. Preserve the
database-only `docker-compose.yml`; provide `docker-compose.full.yml` as a separate delivery path.

## Consequences

Contributors can start without Docker. CI catches PostgreSQL-specific migration, ingestion,
recompute, and API-read failures. Code must remain portable, and behavior that depends on database
dialect needs explicit PostgreSQL coverage.

## Alternatives considered

- Require PostgreSQL everywhere: stronger parity but unnecessary setup friction.
- Use SQLite in containers/CI: simpler but would not validate the intended production database.
- Maintain separate persistence implementations: rejected because it creates drift.
