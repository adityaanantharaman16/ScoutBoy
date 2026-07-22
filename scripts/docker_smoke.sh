#!/usr/bin/env bash
set -euo pipefail

export SCOUTBOY_POSTGRES_PORT="${SCOUTBOY_SMOKE_POSTGRES_PORT:-55432}"
export SCOUTBOY_API_PORT="${SCOUTBOY_SMOKE_API_PORT:-18000}"
export SCOUTBOY_WEB_PORT="${SCOUTBOY_SMOKE_WEB_PORT:-13000}"
export NEXT_PUBLIC_API_BASE_URL="http://localhost:${SCOUTBOY_API_PORT}/api"
export SCOUTBOY_ADMIN_TOKEN="${SCOUTBOY_SMOKE_ADMIN_TOKEN:-disposable-smoke-token}"

compose=(docker compose -p scoutboy-smoke -f docker-compose.full.yml)

cleanup() {
  status=$?
  trap - EXIT
  if [[ $status -ne 0 ]]; then
    "${compose[@]}" logs --no-color || true
  fi
  "${compose[@]}" down --volumes --remove-orphans
  exit "$status"
}
trap cleanup EXIT

"${compose[@]}" up -d --build --wait --wait-timeout 180
curl --fail --silent --show-error http://localhost:${SCOUTBOY_API_PORT:-8000}/healthz >/dev/null
curl --fail --silent --show-error http://localhost:${SCOUTBOY_API_PORT:-8000}/readyz >/dev/null
curl --fail --silent --show-error http://localhost:${SCOUTBOY_WEB_PORT:-3000}/ >/dev/null

echo "Full-stack container smoke passed."
