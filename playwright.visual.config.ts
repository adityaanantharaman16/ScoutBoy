import { defineConfig, devices } from "@playwright/test";

/**
 * Milestone 7 closeout — Phase 12: controlled visual regression.
 *
 * DELIBERATELY SEPARATE FROM CI.
 *
 * Screenshot comparison across platforms is dominated by font rasterization
 * differences: the same build renders text measurably differently on macOS and
 * on a Linux CI runner, which produces failures that say nothing about the
 * product. Until baselines are proven stable across the platforms that will run
 * them, this stays an explicit local/release-review gate. `make e2e` — the CI
 * gate — keeps ALL of the non-visual accessibility, resilience, motion and
 * functional coverage, so nothing is lost by excluding this suite from it.
 *
 * Compare against baselines:  pnpm visual
 * Regenerate baselines:       pnpm visual:update   (REVIEW THE DIFF BY HAND)
 *
 * Both commands go through `scripts/run_visual.sh`, which prepares a throwaway
 * migrated + sample-seeded + recomputed SQLite database and exports it as
 * DATABASE_URL before Playwright starts. This config REFUSES to run without it —
 * see `requireIsolatedFixtureDatabase` below.
 *
 * Baselines are written to `tests/visual/__screenshots__/{project}/…` so the
 * browser and viewport that produced each one are visible in its path. Never
 * regenerate them in CI.
 */

/**
 * Screenshot comparison is only meaningful when the data behind the pixels is
 * fixed. Started bare, the API webServer below would inherit whatever
 * DATABASE_URL is in scope — in practice the developer's `db/scoutboy.db`, whose
 * primary keys and cohort differ from the committed sample fixtures. That is
 * exactly how a green-looking suite came to compare (and could have regenerated)
 * baselines against pilot data, so this fails loudly instead of proceeding.
 */
function requireIsolatedFixtureDatabase(): void {
  const fixtureRoot = process.env.SCOUTBOY_FIXTURE_ROOT ?? "";
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const expected = `sqlite:///${fixtureRoot}/scoutboy.db`;

  if (process.env.SCOUTBOY_VISUAL_FIXTURE_READY !== "1" || fixtureRoot === "") {
    throw new Error(
      "Visual comparison must be run through `pnpm visual` (or `pnpm visual:update`), " +
        "which prepares an isolated migrated, sample-seeded and recomputed fixture " +
        "database first. Running this config directly would compare screenshots " +
        "against whatever database happens to exist locally.",
    );
  }
  if (databaseUrl !== expected) {
    throw new Error(
      `Refusing to run visual comparison against DATABASE_URL=${databaseUrl || "(unset)"}: ` +
        `expected the throwaway fixture database at ${expected}.`,
    );
  }
}

requireIsolatedFixtureDatabase();

const PYTHONPATH = "packages:packages/rating_engine:packages/shared/python:apps/api";
const API_PORT = process.env.SCOUTBOY_E2E_API_PORT ?? "18080";
const WEB_PORT = process.env.SCOUTBOY_E2E_WEB_PORT ?? "13080";
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const REUSE_EXISTING_SERVER = process.env.SCOUTBOY_E2E_REUSE_EXISTING_SERVER === "1";

export default defineConfig({
  testDir: "tests/visual",
  timeout: 90_000,
  // A baseline mismatch is a finding to look at, never something to retry away.
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      // Tight on purpose. A large tolerance would approve exactly the visible
      // regressions this suite exists to catch; a small allowance absorbs
      // sub-pixel antialiasing only.
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "desktop-webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 390, height: 844 } },
    },
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
