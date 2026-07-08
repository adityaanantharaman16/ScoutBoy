import { defineConfig } from "@playwright/test";

/**
 * E2E for the main user flow. Assumes the app is running locally.
 * Easiest: run `make dev` in one terminal (starts API + web + seeded DB), then `make e2e`.
 * The webServers below use reuseExistingServer so they attach to an already-running stack.
 */
const REPO = process.cwd();
const PYTHONPATH = "packages:packages/rating_engine:packages/shared/python:apps/api";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `bash -c "PYTHONPATH=${PYTHONPATH} DATABASE_URL=sqlite:///${REPO}/db/scoutboy.db .venv/bin/uvicorn app.main:app --app-dir apps/api --port 8000"`,
      url: "http://localhost:8000/api/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // Production build (`next start`) — deterministic, no per-request dev compilation.
      // `make e2e` builds first; this serves the prebuilt app.
      command: "pnpm --filter @scoutboy/web start -p 3000",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
