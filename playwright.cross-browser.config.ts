import { defineConfig, devices } from "@playwright/test";

/**
 * Milestone 7 closeout — Phase 11: the cross-browser functional matrix.
 *
 * Separate from the default config on purpose. `make e2e` proves behaviour in
 * depth on one engine and must stay fast; this config answers a different,
 * narrower question — does each mandatory flow still work on Chromium, WebKit and
 * Firefox? — by running only `tests/cross-browser/`.
 *
 * Run: pnpm e2e:cross-browser
 *
 * Browser binaries are NOT installed automatically. If one is missing, Playwright
 * fails loudly for that project rather than silently reporting a pass; install it
 * with `pnpm exec playwright install <browser>`.
 */

const PYTHONPATH = "packages:packages/rating_engine:packages/shared/python:apps/api";
const API_PORT = process.env.SCOUTBOY_E2E_API_PORT ?? "18080";
const WEB_PORT = process.env.SCOUTBOY_E2E_WEB_PORT ?? "13080";
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const REUSE_EXISTING_SERVER = process.env.SCOUTBOY_E2E_REUSE_EXISTING_SERVER === "1";

export default defineConfig({
  testDir: "tests/cross-browser",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: [
    {
      command: `env PYTHONPATH=${PYTHONPATH} SCOUTBOY_ENVIRONMENT=test SCOUTBOY_WEB_ORIGINS=${WEB_ORIGIN} .venv/bin/uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port ${API_PORT}`,
      url: `${API_ORIGIN}/healthz`,
      reuseExistingServer: REUSE_EXISTING_SERVER,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @scoutboy/web start -H 127.0.0.1 -p ${WEB_PORT}`,
      url: WEB_ORIGIN,
      reuseExistingServer: REUSE_EXISTING_SERVER,
      timeout: 120_000,
    },
  ],
});
