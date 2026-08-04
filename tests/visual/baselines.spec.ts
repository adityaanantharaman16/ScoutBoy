import { expect, test, type Page } from "@playwright/test";

/**
 * Milestone 7 closeout — Phase 12: the curated visual-regression baseline set.
 *
 * Product-defining surfaces and risk-bearing honesty states only. There is
 * deliberately no snapshot for every trivial permutation: a baseline nobody
 * reviews is worse than no baseline, because it trains reviewers to rubber-stamp
 * updates.
 *
 * Determinism rules applied to every shot:
 *  - production build, fixture-backed API and database (see the config);
 *  - device-local state cleared unless the state under test needs it;
 *  - fonts loaded and all motion finished before capture;
 *  - masks used ONLY for genuinely nondeterministic values, each documented.
 */

/** Waits until fonts are loaded and every animation has finished. */
async function stable(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

/**
 * The only masks in this suite.
 *
 * `page-meta` carries a "Last updated" timestamp on Methodology which changes
 * with the fixture build, and the leaderboard's rating-version line. Both are
 * asserted textually by the functional suites; masking them here keeps the
 * baseline about layout and treatment rather than about the clock.
 */
const META_MASK = (page: Page) => [page.locator('[data-testid="page-meta"]')];

async function clearDeviceState(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

async function seedTwo(page: Page) {
  await page.goto("/");
  await page.waitForSelector('[data-testid="result-row"]');
  await page.locator('[data-testid="favorite-action"]').nth(0).click();
  await page.locator('[data-testid="favorite-action"]').nth(1).click();
  await page.locator('[data-testid="compare-action"]').nth(0).click();
  await page.locator('[data-testid="compare-action"]').nth(1).click();
}

async function firstDossier(page: Page, ready = '[data-testid="role-territory"]') {
  await page.goto("/");
  await page.waitForSelector('[data-testid="player-result"]');
  const href = await page.locator('[data-testid="player-result"]').first().getAttribute("href");
  await page.goto(href!);
  await page.waitForSelector(ready);
}

const isMobile = (name: string) => name.startsWith("mobile");

// ---------------------------------------------------------------------------
// Product-defining surfaces
// ---------------------------------------------------------------------------

test.describe("Curated surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await clearDeviceState(page);
  });

  test("discovery", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await stable(page);
    await expect(page).toHaveScreenshot("discovery.png", { fullPage: false });
  });

  test("discovery with compare tray", async ({ page }) => {
    await seedTwo(page);
    await page.waitForSelector('[data-testid="compare-tray"]');
    await stable(page);
    await expect(page).toHaveScreenshot("discovery-compare-tray.png");
  });

  test("player dossier", async ({ page }) => {
    await firstDossier(page);
    await stable(page);
    await expect(page).toHaveScreenshot("player-dossier.png");
  });

  test("player dossier — alternate selected role", async ({ page }) => {
    await firstDossier(page);
    const tabs = page.locator('[role="tab"]');
    test.skip((await tabs.count()) < 2, "needs at least two roles");
    await tabs.nth(1).click();
    await stable(page);
    await expect(page).toHaveScreenshot("player-dossier-alternate-role.png");
  });

  test("player dossier — pinned territory evidence", async ({ page }) => {
    await firstDossier(page);
    await page.locator('[data-testid^="evidence-group-"]').first().click();
    await stable(page);
    await expect(page).toHaveScreenshot("player-dossier-pinned-evidence.png");
  });

  test("player dossier — role selector", async ({ page }) => {
    await firstDossier(page, '[data-testid="role-selector"]');
    await stable(page);
    await expect(page.locator('[data-testid="role-selector"]')).toHaveScreenshot(
      "role-selector.png",
    );
  });

  test("player action rail", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    await stable(page);
    await expect(page.locator('[data-testid="action-rail-box"]').first()).toHaveScreenshot(
      "player-action-rail.png",
    );
  });

  test("my favorites", async ({ page }) => {
    await seedTwo(page);
    await page.goto("/shortlist");
    await page.waitForSelector("h1");
    await stable(page);
    await expect(page).toHaveScreenshot("my-favorites.png", { mask: META_MASK(page) });
  });

  test("completed comparison", async ({ page }) => {
    await page.goto("/compare");
    await page.waitForSelector('[data-testid="compare-a"]');
    await page.getByTestId("compare-a").selectOption({ index: 1 });
    await page.getByTestId("compare-b").selectOption({ index: 2 });
    await page.waitForLoadState("networkidle");
    await stable(page);
    await expect(page).toHaveScreenshot("comparison-completed.png");
  });

  test("no shared rated role comparison", async ({ page }) => {
    // The seed cohort contains a genuine disjoint pair (Anton Keller ATT vs
    // Karim Nasser MID), so this state needs no interception at all — it is the
    // real API response, which makes the baseline both simpler and more honest.
    await page.goto("/compare?a=6&b=17");
    await page.waitForSelector('[data-testid="compare-no-shared-role"]');
    await stable(page);
    await expect(page).toHaveScreenshot("comparison-no-shared-role.png");
  });

  test("role leaderboard", async ({ page }) => {
    await page.goto("/roles/touchline_winger");
    await page.waitForSelector("h1");
    await stable(page);
    await expect(page).toHaveScreenshot("leaderboard.png", { mask: META_MASK(page) });
  });

  test("methodology", async ({ page }) => {
    await page.goto("/methodology");
    await page.waitForSelector('[data-testid="methodology-contents"]');
    await stable(page);
    await expect(page).toHaveScreenshot("methodology.png", { mask: META_MASK(page) });
  });

  test("mobile navigation open", async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo.project.name), "mobile viewports only");
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await page.locator('[data-testid="nav-menu-toggle"]').click();
    await stable(page);
    await expect(page).toHaveScreenshot("mobile-navigation-open.png");
  });

  test("discovery at 320", async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo.project.name), "mobile viewports only");
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await stable(page);
    await expect(page).toHaveScreenshot("discovery-320.png");
  });
});

// ---------------------------------------------------------------------------
// Honesty / degraded states — Chromium only
//
// These prove the *treatment* of unavailable data, which does not vary by
// engine; capturing them on four projects would quadruple the review burden for
// no additional signal.
// ---------------------------------------------------------------------------

test.describe("Honesty states", () => {
  // `browserName` is "chromium" for BOTH the desktop and mobile Chromium
  // projects, so the gate is on the project name. A describe-level
  // `test.skip(condition)` callback only receives fixtures — not `testInfo` —
  // so the check lives in `beforeEach`, where the project is available.
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "desktop Chromium is the reference engine for honesty states",
    );
    await clearDeviceState(page);
  });

  test("loading skeleton", async ({ page }) => {
    await page.route(/\/api\/players\?/, async (r) => {
      await new Promise((x) => setTimeout(x, 4000));
      await r.continue();
    });
    await page.goto("/");
    await page.waitForSelector('[data-testid="ledger-skeleton"]');
    await stable(page);
    await expect(page).toHaveScreenshot("state-loading-skeleton.png");
  });

  test("empty results", async ({ page }) => {
    await page.route(/\/api\/players\?/, (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 12, total_pages: 1 }),
      }),
    );
    await page.goto("/");
    await page.waitForSelector('[role="status"]');
    await stable(page);
    await expect(page).toHaveScreenshot("state-empty-results.png");
  });

  test("api error", async ({ page }) => {
    await page.route(/\/api\/players\?/, (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.goto("/");
    await page.waitForSelector('[role="alert"]');
    await stable(page);
    await expect(page).toHaveScreenshot("state-api-error.png");
  });

  test("unavailable role audit", async ({ page }) => {
    await page.route("**/api/players/*/ratings", (r) => r.fulfill({ status: 500, body: "{}" }));
    await firstDossier(page, '[data-testid="territory-error"]');
    await stable(page);
    await expect(page).toHaveScreenshot("state-role-audit-unavailable.png");
  });

  test("unknown evidence group", async ({ page }) => {
    await page.route("**/api/players/*/ratings", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const audit of body.audits ?? []) {
        const groups = audit.metric_breakdown?.groups ?? [];
        const spatial = groups.find((g: { key: string }) =>
          ["box_presence", "shot_threat", "progression", "defensive_contribution"].includes(g.key),
        );
        if (spatial) {
          spatial.group_score = null;
          for (const m of spatial.metrics ?? []) {
            m.present = false;
            m.score = null;
          }
        }
      }
      await route.fulfill({ response, json: body });
    });
    await firstDossier(page);
    await stable(page);
    await expect(page).toHaveScreenshot("state-unknown-evidence.png");
  });

  test("missing market data", async ({ page }) => {
    await page.route("**/api/players/*", async (route) => {
      if (route.request().url().includes("/ratings")) return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.market = null;
      await route.fulfill({ response, json: body });
    });
    await firstDossier(page, '[data-testid="player-name"]');
    await stable(page);
    await expect(page).toHaveScreenshot("state-missing-market.png");
  });

  test("not found", async ({ page }) => {
    await page.goto("/definitely-not-a-route");
    await page.waitForSelector('[data-testid="not-found"]');
    await stable(page);
    await expect(page).toHaveScreenshot("state-not-found.png");
  });
});
