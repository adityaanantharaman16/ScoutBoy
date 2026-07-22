#!/usr/bin/env bash
set -euo pipefail

e2e_root=$(mktemp -d "${TMPDIR:-/tmp}/scoutboy-e2e.XXXXXX")
cleanup() {
  status=$?
  trap - EXIT
  rm -rf "$e2e_root"
  exit "$status"
}
trap cleanup EXIT

export SCOUTBOY_E2E_API_PORT="${SCOUTBOY_E2E_API_PORT:-18080}"
export SCOUTBOY_E2E_WEB_PORT="${SCOUTBOY_E2E_WEB_PORT:-13080}"
export SCOUTBOY_E2E_REUSE_EXISTING_SERVER="${SCOUTBOY_E2E_REUSE_EXISTING_SERVER:-0}"
export SCOUTBOY_E2E_DATABASE_URL="sqlite:///$e2e_root/scoutboy.db"
export DATABASE_URL="$SCOUTBOY_E2E_DATABASE_URL"
export SCOUTBOY_ENVIRONMENT=test
export SCOUTBOY_WEB_ORIGINS="http://127.0.0.1:${SCOUTBOY_E2E_WEB_PORT}"
export NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:${SCOUTBOY_E2E_API_PORT}/api"

echo ">> Preparing isolated E2E database at $e2e_root"
.venv/bin/alembic upgrade head
.venv/bin/python -m data_pipeline.jobs.ingest --source sample
.venv/bin/python -m data_pipeline.jobs.recompute --ratings --playstyles --market

echo ">> Building production web app for ${NEXT_PUBLIC_API_BASE_URL}"
pnpm --filter @scoutboy/web build

echo ">> Running E2E on API :${SCOUTBOY_E2E_API_PORT} and web :${SCOUTBOY_E2E_WEB_PORT}"
pnpm exec playwright test
