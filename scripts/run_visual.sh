#!/usr/bin/env bash
set -euo pipefail

# Isolated, fixture-backed visual-regression run against a production web build.
#
# This exists because screenshot comparison is only meaningful when the data
# behind the pixels is fixed. Run bare, `playwright test --config
# playwright.visual.config.ts` starts the API against whatever DATABASE_URL
# happens to be in scope — in practice the developer's `db/scoutboy.db`, whose
# primary keys and cohort differ from the committed sample fixtures. Baselines
# compared (or worse, regenerated) against that database are meaningless.
#
# Both entry points go through here:
#   pnpm visual          -> compare against the committed baselines
#   pnpm visual:update    -> regenerate them, AFTER the fixture DB is ready
#
# Extra arguments are forwarded to Playwright, and Playwright's exit status is
# this script's exit status.
source scripts/lib/fixture_env.sh

scoutboy_fixture_init visual
scoutboy_fixture_seed
scoutboy_fixture_build_web

# playwright.visual.config.ts refuses to run unless this is set and DATABASE_URL
# points inside $SCOUTBOY_FIXTURE_ROOT.
export SCOUTBOY_VISUAL_FIXTURE_READY=1

echo ">> Running visual comparison on API :${SCOUTBOY_E2E_API_PORT} and web :${SCOUTBOY_E2E_WEB_PORT}"
pnpm exec playwright test --config playwright.visual.config.ts "$@"
