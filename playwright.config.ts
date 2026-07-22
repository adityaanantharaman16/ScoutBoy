import { defineConfig } from "@playwright/test";

const PYTHONPATH = "packages:packages/rating_engine:packages/shared/python:apps/api";
const API_PORT = process.env.SCOUTBOY_E2E_API_PORT ?? "18080";
const WEB_PORT = process.env.SCOUTBOY_E2E_WEB_PORT ?? "13080";
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const REUSE_EXISTING_SERVER = process.env.SCOUTBOY_E2E_REUSE_EXISTING_SERVER === "1";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: WEB_ORIGIN,
    trace: "on-first-retry",
  },
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
