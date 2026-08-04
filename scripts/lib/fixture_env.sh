# Shared fixture preparation for ScoutBoy's isolated Playwright suites.
#
# SOURCE this file from a script; it is not executable on its own.
#
# `scripts/run_e2e.sh` and `scripts/run_visual.sh` need exactly the same
# guarantee: the suite runs against a throwaway SQLite database that was
# migrated, ingested from the committed `sample` provider and recomputed *in
# this process*, never against whatever happens to sit in `db/scoutboy.db`. The
# developer's local/pilot database is not read, written or opened.
#
# Usage:
#   source scripts/lib/fixture_env.sh
#   scoutboy_fixture_init <label>    # temp root + cleanup trap + exported env
#   scoutboy_fixture_seed            # migrate, ingest sample, recompute
#   scoutboy_fixture_build_web       # production web build against the test API
#
# Both callers run from the repository root (`make` and `pnpm run` both do), so
# the relative `.venv/bin/...` paths below resolve the same way they always have.

# The Makefile exports this; setting a default keeps the scripts runnable when
# invoked directly or through `pnpm run`.
export PYTHONPATH="${PYTHONPATH:-packages:packages/rating_engine:packages/shared/python:apps/api}"

# Set by scoutboy_fixture_init; read by the cleanup trap and by the Playwright
# visual config, which refuses to run unless DATABASE_URL points inside it.
SCOUTBOY_FIXTURE_ROOT=""

# Removes exactly the directory this run created — nothing else — and then
# re-raises the original exit status, so a failing suite still fails the command.
scoutboy_fixture_cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$SCOUTBOY_FIXTURE_ROOT" && -d "$SCOUTBOY_FIXTURE_ROOT" ]]; then
    rm -rf "$SCOUTBOY_FIXTURE_ROOT"
  fi
  exit "$status"
}

scoutboy_fixture_init() {
  local label="$1"
  SCOUTBOY_FIXTURE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/scoutboy-${label}.XXXXXX")
  export SCOUTBOY_FIXTURE_ROOT
  trap scoutboy_fixture_cleanup EXIT

  export SCOUTBOY_E2E_API_PORT="${SCOUTBOY_E2E_API_PORT:-18080}"
  export SCOUTBOY_E2E_WEB_PORT="${SCOUTBOY_E2E_WEB_PORT:-13080}"
  export SCOUTBOY_E2E_REUSE_EXISTING_SERVER="${SCOUTBOY_E2E_REUSE_EXISTING_SERVER:-0}"
  export SCOUTBOY_E2E_DATABASE_URL="sqlite:///$SCOUTBOY_FIXTURE_ROOT/scoutboy.db"
  export DATABASE_URL="$SCOUTBOY_E2E_DATABASE_URL"
  export SCOUTBOY_ENVIRONMENT=test
  export SCOUTBOY_WEB_ORIGINS="http://127.0.0.1:${SCOUTBOY_E2E_WEB_PORT}"
  export NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:${SCOUTBOY_E2E_API_PORT}/api"
}

scoutboy_fixture_seed() {
  echo ">> Preparing isolated fixture database at $SCOUTBOY_FIXTURE_ROOT"
  .venv/bin/alembic upgrade head
  .venv/bin/python -m data_pipeline.jobs.ingest --source sample
  .venv/bin/python -m data_pipeline.jobs.recompute --ratings --playstyles --market
}

scoutboy_fixture_build_web() {
  echo ">> Building production web app for ${NEXT_PUBLIC_API_BASE_URL}"
  pnpm --filter @scoutboy/web build
}
