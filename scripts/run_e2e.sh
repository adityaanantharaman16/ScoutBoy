#!/usr/bin/env bash
set -euo pipefail

# Isolated, fixture-backed E2E run against a production web build.
# The environment preparation is shared with scripts/run_visual.sh.
source scripts/lib/fixture_env.sh

scoutboy_fixture_init e2e
scoutboy_fixture_seed
scoutboy_fixture_build_web

echo ">> Running E2E on API :${SCOUTBOY_E2E_API_PORT} and web :${SCOUTBOY_E2E_WEB_PORT}"
pnpm exec playwright test "$@"
