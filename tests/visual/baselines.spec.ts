import { expect, test, type Page } from "@playwright/test";

import { NO_SHARED_ROLE_PAIR, compareByName, expectNoSharedRatedRole } from "./support/fixtures";

/**
 * Milestone 7 closeout — Phase 12: the curated visual-regression baseline set.
 *
 * Product-defining surfaces and risk-bearing honesty states only. There is
 * deliberately no snapshot for every trivial permutation: a baseline nobody
 * reviews is worse than no baseline, because it trains reviewers to rubber-stamp
 * updates.
 *
 * Determinism rules applied to every shot:
 *  - production build against a throwaway migrated, sample-seeded and recomputed
 *    database prepared by `scripts/run_visual.sh` — never the local/pilot one;
 *  - identities asserted, never assumed from primary keys (see `support/fixtures`);
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

  /**
   * Discovery with an age threshold applied. Distinct from the default shot in
   * three ways worth a baseline of their own: the slider's painted fill and
   * selected stop, the pressed direction segment, and the results summary
   * reporting the active age condition instead of "All Ages".
   *
   * `age_max=22` is chosen because it still returns players against the committed
   * fixture cohort, so the shot exercises a filtered LEDGER rather than the empty
   * state (which already has its own baseline).
   */
  test("discovery with an age threshold applied", async ({ page }) => {
    await page.goto("/?age_max=22");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await stable(page);
    await expect(page).toHaveScreenshot("discovery-age-filtered.png", { fullPage: false });
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

  /**
   * The same rail with both actions selected: this is the one shot that proves the
   * MIRRORED markers, favourite on the left edge and Compare on the right, and
   * that selecting neither changes the rail's dimensions.
   */
  test("player action rail — both actions selected", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    const rail = page.locator('[data-testid="action-rail-box"]').first();
    await rail.locator('[data-testid="favorite-action"]').click();
    await rail.locator('[data-testid="compare-action"]').click();
    await stable(page);
    await expect(rail).toHaveScreenshot("player-action-rail-selected.png");
  });

  /**
   * The dossier's comparable-player cards: single-line identity, the RoleFit and
   * expected-asking channels side by side, and the two-part heart/Compare bar.
   */
  test("player dossier — comparable players", async ({ page }) => {
    await firstDossier(page, '[data-testid="similar-group"]');
    await stable(page);
    await expect(page.locator('[data-testid="similar-group"]').first()).toHaveScreenshot(
      "player-comparables.png",
    );
  });

  /**
   * The comparable-player card's action bar with both actions selected. The
   * unselected shot above cannot show it: the mirrored markers — heart on the left
   * edge, Compare on the right — only exist in the pressed state, and this is the
   * bar the leaderboard shares, so one baseline covers both surfaces' selected
   * treatment.
   */
  test("comparable-player action bar — both actions selected", async ({ page }) => {
    await firstDossier(page, '[data-testid="similar-group"]');
    const bar = page.locator('[data-testid="card-action-bar"]').first();
    await bar.locator('[data-testid="favorite-action"]').click();
    await bar.locator('[data-testid="compare-action"]').click();
    await stable(page);
    await expect(bar).toHaveScreenshot("player-comparables-action-bar-selected.png");
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
    // The sample cohort contains a genuine disjoint pair, so this state needs no
    // interception at all — it is the real API response. The players are chosen by
    // visible name, never by primary key, and every claim the baseline depends on
    // is asserted before the capture: who each side is, that both are genuinely
    // rated, that their rated roles do not intersect, and that the UI is showing
    // the neutral state rather than hiding a role.
    const { a, b } = NO_SHARED_ROLE_PAIR;
    const response = await compareByName(page, a, b);
    await expectNoSharedRatedRole(response, a, b);

    await expect(page.getByTestId("compare-side-left")).toContainText(a);
    await expect(page.getByTestId("compare-side-right")).toContainText(b);
    await expect(page.getByTestId("compare-role")).toHaveText("No Shared Rated Role");
    await expect(page.getByTestId("compare-no-shared-role")).toBeVisible();

    await page.waitForLoadState("networkidle");
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
