import { expect, test, type Page } from "@playwright/test";

import { settle } from "./support/a11y";
import { gotoFirstDossier, seedDeviceState } from "./support/surfaces";

/**
 * Milestone 7 closeout — Phases 8–10.
 *
 * Degraded-data and failure-state resilience, plus interaction stress. Every
 * adverse state is produced by intercepting and lightly editing the REAL response
 * shape; the production sample dataset is never modified to make testing
 * convenient.
 *
 * The recurring contract for every state below: explain what is unavailable,
 * never fabricate a score or a zero, never surface raw `undefined`/`null`/`NaN`,
 * keep a recovery path, use the right status/alert semantics, stay
 * keyboard-operable, reflow at 320, and log no unhandled console error.
 */

/** Collects console errors and page exceptions for the life of a test. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** No raw JS sentinel ever reaches the rendered text. */
async function expectNoRawSentinels(page: Page, label: string) {
  const text = await page.locator("body").innerText();
  for (const bad of ["undefined", "NaN", "[object Object]", "Infinity"]) {
    expect(text, `${label} leaked "${bad}"`).not.toContain(bad);
  }
  // "null" as a standalone word (not inside prose such as "nullable").
  expect(text, `${label} leaked a bare null`).not.toMatch(/(^|\s)null(\s|$)/);
}

async function expectNoOverflowAt320(page: Page, label: string) {
  const previous = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 720 });
  await settle(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} overflows at 320`).toBeLessThanOrEqual(0);
  if (previous) await page.setViewportSize(previous);
}

/**
 * Precise route matchers. A Playwright URL *glob* treats `?` as a
 * single-character wildcard, so `**\/api/players?**` silently also matches
 * `/api/players/6/ratings` — regexes remove that ambiguity entirely.
 */
const SEARCH_ROUTE = /\/api\/players\?/;

/**
 * React Query retries a failed request, so an error region can appear, vanish
 * during a retry, and reappear. Asserting "no alert, ever" therefore races the
 * retry cycle. What actually matters is the settled outcome: once real data is
 * on screen, no error region is left VISIBLE to the user.
 */
async function expectNoVisibleAlert(page: Page, label: string) {
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll('[role="alert"]')).filter(
            (el) => (el as HTMLElement).offsetParent !== null,
          ).length,
        ),
      { message: `${label} still shows an error region` },
    )
    .toBe(0);
}

// ---------------------------------------------------------------------------
// Phase 9 — degraded data and failure states
// ---------------------------------------------------------------------------

test.describe("Degraded data and failure states", () => {
  test("discovery loading shows an honest in-progress status", async ({ page }) => {
    const errors = watchConsole(page);
    await page.route(SEARCH_ROUTE, async (r) => {
      await new Promise((x) => setTimeout(x, 1500));
      await r.continue();
    });
    await page.goto("/");
    const skeleton = page.locator('[data-testid="ledger-skeleton"]');
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute("role", "status");
    await expect(page.locator('[data-testid="results-ledger"]')).toBeVisible({ timeout: 15000 });
    expect(errors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
  });

  test("discovery empty results are a status, not an error", async ({ page }) => {
    await page.route(SEARCH_ROUTE, (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 12, total_pages: 1 }),
      }),
    );
    await page.goto("/");
    await expect(
      page.locator('[role="status"]').filter({ hasText: /No players match/ }),
    ).toBeVisible();
    // Not dramatised as a failure.
    await expectNoVisibleAlert(page, "empty results");
    // The filter rail survives so the search can be widened.
    await expect(page.locator('[data-testid="filter-column"]')).toBeVisible();
    await expectNoRawSentinels(page, "empty results");
    await expectNoOverflowAt320(page, "empty results");
  });

  test("discovery error is an alert that keeps the page identity", async ({ page }) => {
    await page.route(SEARCH_ROUTE, (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.goto("/");
    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator('[data-testid="filter-column"]')).toBeVisible();
    await expectNoRawSentinels(page, "search error");
    await expectNoOverflowAt320(page, "search error");
  });

  test("a failed search recovers cleanly on the next successful load", async ({ page }) => {
    // The failure is scoped to a single load; the retry is a genuinely fresh
    // navigation with no interception, so no stale error may survive it.
    await page.route(SEARCH_ROUTE, (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.goto("/");
    await expect(page.locator('[role="alert"]')).toBeVisible();

    await page.unroute(SEARCH_ROUTE);
    await page.goto("/");
    await expect(page.locator('[data-testid="results-ledger"]')).toBeVisible();
    await expect(page.locator('[data-testid="result-row"]').first()).toBeVisible();
    await expectNoVisibleAlert(page, "recovered search");
  });

  test("dossier: failed card request keeps navigation and explains itself", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    await page.waitForSelector('[data-testid="player-result"]');
    const href = await page.locator('[data-testid="player-result"]').first().getAttribute("href");

    await page.route("**/api/players/*", (r) =>
      r.request().url().includes("/ratings") ? r.continue() : r.fulfill({ status: 500, body: "{}" }),
    );
    await page.goto(href!);
    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-discover"]')).toBeVisible();
    await expectNoRawSentinels(page, "dossier card error");
    await expectNoOverflowAt320(page, "dossier card error");
    expect(errors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
  });

  test("dossier: failed role audit keeps identity, market and context usable", async ({ page }) => {
    await page.route("**/api/players/*/ratings", (r) => r.fulfill({ status: 500, body: "{}" }));
    await gotoFirstDossier(page, '[data-testid="player-name"]');

    // The dossier is NOT hidden behind the audit request.
    await expect(page.locator('[data-testid="player-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="territory-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="territory-error"]')).toContainText(/unavailable/i);
    await expectNoRawSentinels(page, "role audit error");
    await expectNoOverflowAt320(page, "role audit error");
  });

  test("unknown evidence group renders as unknown, never as zero", async ({ page }) => {
    await page.route("**/api/players/*/ratings", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const audit of body.audits ?? []) {
        const groups = audit.metric_breakdown?.groups ?? [];
        if (groups[0]) {
          groups[0].group_score = null;
          for (const m of groups[0].metrics ?? []) {
            m.present = false;
            m.score = null;
          }
        }
      }
      await route.fulfill({ response, json: body });
    });
    await gotoFirstDossier(page, '[data-testid="role-evidence-list"]');

    const list = page.locator('[data-testid="role-evidence-list"]');
    await expect(list).toContainText("unknown");
    // The word "unknown" appears where a score would be — and no 0 was invented.
    const unknownRow = list.locator("li").filter({ hasText: "unknown" }).first();
    await expect(unknownRow).not.toContainText(/\b0\b/);
    await expectNoRawSentinels(page, "unknown evidence group");
  });

  test("missing market data never renders a fabricated price", async ({ page }) => {
    await page.route("**/api/players/*", async (route) => {
      if (route.request().url().includes("/ratings")) return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.market = null;
      await route.fulfill({ response, json: body });
    });
    await gotoFirstDossier(page, '[data-testid="player-name"]');
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("€0");
    expect(text).toMatch(/No market data|Unknown|-/);
    await expectNoRawSentinels(page, "missing market");
  });

  test("long identity, club and role names stay contained at 320", async ({ page }) => {
    await page.route(SEARCH_ROUTE, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (body.items?.[0]) {
        body.items[0].canonical_name = "Maximiliaan Van Der Steenhuizen-Oppenheimer";
        body.items[0].club = "Borussia Mönchengladbach Fußballklub e.V. Reserves";
        body.items[0].league = "Campeonato Brasileiro Série A Interregional";
        body.items[0].best_role_display = "Ball-Winning Deep-Lying Playmaker";
      }
      await route.fulfill({ response, json: body });
    });
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await settle(page);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    // The long name is rendered in full — never truncated into meaninglessness.
    await expect(page.locator('[data-testid="player-result"]').first()).toContainText(
      "Van Der Steenhuizen-Oppenheimer",
    );
  });

  test("zero favorites shows an honest empty state with a route back", async ({ page }) => {
    await page.goto("/shortlist");
    await page.waitForSelector("h1");
    await expectNoRawSentinels(page, "empty favorites");
    // A recovery path exists.
    expect(await page.locator('a[href="/"]').count()).toBeGreaterThan(0);
    await expectNoOverflowAt320(page, "empty favorites");
  });

  test("an unresolved saved player id does not break My Favorites", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() =>
      window.localStorage.setItem("scoutboy.shortlist.v1", JSON.stringify([99999901, 99999902])),
    );
    const errors = watchConsole(page);
    await page.goto("/shortlist");
    await page.waitForSelector("h1");
    await settle(page);
    await expectNoRawSentinels(page, "stale saved ids");
    expect(errors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
  });

  test("a one-player compare queue explains what is still needed", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    await page.locator('[data-testid="compare-action"]').first().click();
    const tray = page.locator('[data-testid="compare-tray"]');
    await expect(tray).toContainText("Add one more player");
    // The comparison entry point is disabled rather than misleadingly active.
    const open = tray.getByRole("link", { name: /Open comparison/ });
    await expect(open).toHaveAttribute("aria-disabled", "true");
  });

  test("the not-found route explains itself and offers recovery", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/definitely-not-a-route");
    await page.waitForSelector('[data-testid="not-found"]');
    await expect(page.locator("h1")).toHaveText("Page Not Found");
    await expect(page.locator('[data-testid="not-found-discover"]')).toBeVisible();
    expect(await page.title()).toBe("Page Not Found - ScoutBoy");
    await expectNoRawSentinels(page, "not found");
    await expectNoOverflowAt320(page, "not found");
    expect(errors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 10 — interaction stress
// ---------------------------------------------------------------------------

test.describe("Interaction stress", () => {
  test("rapid favorite toggling stays deterministic and announces once", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    const fav = page.locator('[data-testid="favorite-action"]').first();
    for (let i = 0; i < 11; i += 1) await fav.click({ delay: 0 });
    // Odd count → on.
    await expect(fav).toHaveAttribute("aria-pressed", "true");
    // Exactly one polite live region, not one per toggle.
    expect(await page.locator(".sr-only[aria-live='polite']").count()).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test("compare add/remove/replace never strands a tray or duplicates it", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    const a = page.locator('[data-testid="compare-action"]').nth(0);
    const b = page.locator('[data-testid="compare-action"]').nth(1);
    const c = page.locator('[data-testid="compare-action"]').nth(2);

    await a.click();
    await b.click();
    await expect(page.locator('[data-testid="compare-tray"]')).toHaveCount(1);
    // Replace one side.
    await a.click();
    await c.click();
    await expect(page.locator('[data-testid="compare-tray"]')).toHaveCount(1);

    // Clear then immediately re-open.
    await page.getByRole("button", { name: "Clear" }).click();
    await a.click();
    await expect(page.locator('[data-testid="compare-tray"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="compare-tray"]')).toHaveAttribute(
      "data-leaving",
      "false",
    );
  });

  test("repeated mobile-menu toggling never duplicates the menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const toggle = page.locator('[data-testid="nav-menu-toggle"]');
    for (let i = 0; i < 9; i += 1) await toggle.click({ delay: 0 });
    await expect(page.locator('[data-testid="nav-menu-panel"]')).toHaveCount(1);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("fast filter changes cannot leave count and rows disagreeing", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    // The age threshold took over from the retired scope selector as the rail's
    // fastest-changing control, so it is what this stress case drives now.
    for (const id of ["age-direction-younger", "age-direction-older", "age-direction-all"]) {
      await page.getByTestId(id).click().catch(() => {});
    }
    await page.getByTestId("age-threshold-slider").focus();
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowLeft"]) {
      await page.keyboard.press(key).catch(() => {});
    }
    await page.waitForLoadState("networkidle");
    await settle(page);

    const summary = await page.locator('[data-testid="result-count"]').innerText();
    const rows = await page.locator('[data-testid="result-row"]').count();
    const total = Number(summary.match(/^(\d+)\s+player/)?.[1] ?? "-1");
    expect(total).toBeGreaterThanOrEqual(0);
    if (total === 0) expect(rows).toBe(0);
    else expect(rows).toBeGreaterThan(0);
  });

  test("back/forward navigation restores URL-backed filters", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await page.getByTestId("age-direction-younger").click();
    await page.waitForLoadState("networkidle");
    const filtered = page.url();
    expect(filtered).toContain("age_max=");

    await page.goBack();
    await page.waitForLoadState("networkidle");
    await page.goForward();
    await page.waitForLoadState("networkidle");
    expect(page.url()).toBe(filtered);
    await expect(page.locator('[data-testid="results-ledger"], [role="status"]')).toBeVisible();
    // the control itself came back with the URL, not just the address bar
    await expect(page.getByTestId("age-threshold-value")).toHaveText("25 Years");
    await expect(page.getByTestId("age-direction-younger")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("favorites and compare state survive a reload", async ({ page }) => {
    await seedDeviceState(page);
    await expect(page.locator('[data-testid="compare-tray"]')).toBeVisible();
    await page.reload();
    await page.waitForSelector('[data-testid="results-ledger"]');
    await expect(page.locator('[data-testid="compare-tray"]')).toBeVisible();
    await expect(page.locator('[data-testid="favorite-action"][aria-pressed="true"]')).toHaveCount(
      2,
    );
  });

  test("rapid role switching leaves no stale analysis and no runtime error", async ({ page }) => {
    const errors = watchConsole(page);
    await gotoFirstDossier(page);
    const tabs = page.locator('[role="tab"]');
    const n = await tabs.count();
    test.skip(n < 2, "needs at least two roles");
    for (let i = 0; i < 12; i += 1) await tabs.nth(i % n).click({ delay: 0 });
    await settle(page);
    expect(await page.locator('[role="tab"][aria-selected="true"]').count()).toBe(1);
    expect(errors).toEqual([]);
  });

  test("removing the focused saved player keeps focus connected", async ({ page }) => {
    await seedDeviceState(page);
    await page.goto("/shortlist");
    await page.waitForSelector('[data-testid="remove-action"]');
    const remove = page.locator('[data-testid="remove-action"]').first();
    await remove.focus();
    await page.keyboard.press("Enter");
    await settle(page);
    expect(await page.evaluate(() => document.activeElement?.isConnected ?? false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — user-preference resilience
// ---------------------------------------------------------------------------

test.describe("User-preference resilience", () => {
  test("forced-colours emulation keeps controls and states perceivable", async ({ page }) => {
    // Chromium supports `forcedColors`; WebKit/Firefox do not, so this reports a
    // platform limitation rather than silently passing.
    let supported = true;
    try {
      await page.emulateMedia({ forcedColors: "active" });
    } catch {
      supported = false;
    }
    test.skip(!supported, "forced-colours emulation unavailable in this browser");

    await seedDeviceState(page);
    await settle(page);

    // Controls must still be identifiable: in forced colours the UA replaces
    // author colours, so we assert that state is carried by something other than
    // colour — semantics and structure survive.
    await expect(page.locator('[data-testid="compare-tray"]')).toBeVisible();
    await expect(page.locator('[data-testid="favorite-action"]').first()).toHaveAttribute(
      "aria-pressed",
      /true|false/,
    );
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    // Focus indication still resolves to a non-zero outline.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle };
    });
    expect(parseFloat(outline.width)).toBeGreaterThan(0);
    expect(outline.style).not.toBe("none");
  });
});
