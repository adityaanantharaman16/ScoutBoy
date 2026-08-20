import { expect, request, test, type Page } from "@playwright/test";

import { expectNoA11yViolations, settle } from "./support/a11y";
import { seedDeviceState } from "./support/surfaces";

/**
 * Milestone 8.4A - optional accounts, verified against the real production build.
 *
 * WHAT THIS SUITE IS, AND WHAT IT DELIBERATELY IS NOT.
 *
 * The E2E stack runs the checked-in production build with NO Clerk configuration,
 * which is precisely the deployment shape this milestone promises must keep
 * working: accounts are optional for a visitor AND optional for a deployment. So
 * this suite proves the anonymous contract end to end - no auth wall, no account
 * UI, no private traffic, guest favourites behaving exactly as before - and
 * proves the private API refuses to serve anything where no identity provider is
 * configured.
 *
 * It does NOT fabricate a signed-in session. Minting a fake Clerk session in the
 * browser would need either a production auth bypass (explicitly forbidden) or a
 * live Clerk tenant (unavailable here). The signed-in state machine is instead
 * covered at the two layers where it can be exercised honestly:
 * `apps/web/src/tests/account-favorites.test.tsx` drives the real store through an
 * injected auth boundary, and `apps/api/app/tests/test_account_favorites.py`
 * drives the real API with real RS256 tokens verified against a locally generated
 * key set.
 */

const SHORTLIST_KEY = "scoutboy.shortlist.v1";
const API_PORT = process.env.SCOUTBOY_E2E_API_PORT ?? "18080";

async function readShortlist(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), SHORTLIST_KEY);
}

function apiContext() {
  return request.newContext({ baseURL: `http://127.0.0.1:${API_PORT}` });
}

test.describe("Anonymous deployment: the account layer is absent, not hidden", () => {
  test("renders no account entry and no sign-in affordance anywhere", async ({ page }) => {
    for (const path of ["/", "/compare", "/shortlist", "/methodology", "/roles/touchline_winger"]) {
      await page.goto(path);
      await settle(page);
      await expect(page.locator('[data-testid="account-sign-in"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="account-entry-authenticated"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="account-entry-resolving"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="account-suggestion"]')).toHaveCount(0);
    }
  });

  test("keeps the My Favorites counter on the device wording", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    const counter = page.locator('[data-testid="favorites-counter"]');
    await expect(counter).toContainText("saved on this device");
    await expect(counter).toHaveAttribute("data-favorites-mode", "guest");
  });

  test("favourites still save, persist across a reload, and remove cleanly", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');

    await page.locator('[data-testid="favorite-action"]').first().click();
    await expect(page.locator('[data-testid="favorites-counter"]')).toContainText("1");
    const saved = await readShortlist(page);
    expect(saved).toHaveLength(1);

    await page.reload();
    await page.waitForSelector('[data-testid="result-row"]');
    await expect(page.locator('[data-testid="favorites-counter"]')).toContainText("1");
    expect(await readShortlist(page)).toEqual(saved);

    // No account suggestion appeared at any point in that flow.
    await expect(page.locator('[data-testid="account-suggestion"]')).toHaveCount(0);

    await page.locator('[data-testid="favorite-action"]').first().click();
    await expect(page.locator('[data-testid="favorites-counter"]')).toContainText("0");
    expect(await readShortlist(page)).toEqual([]);
  });

  test("issues no request to the private account surface", async ({ page }) => {
    const privateCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/me/")) privateCalls.push(req.method() + " " + req.url());
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    await page.locator('[data-testid="favorite-action"]').first().click();
    await page.goto("/shortlist");
    await settle(page);

    expect(privateCalls, "an anonymous build must never call /api/me/*").toEqual([]);
  });

  test("My Favorites explains browser storage and never claims an account", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    await page.locator('[data-testid="favorite-action"]').first().click();

    await page.goto("/shortlist");
    await page.waitForSelector('[data-testid="shortlist-record"]');
    const body = await page.locator("main").innerText();
    expect(body).toContain("saved on this device");
    expect(body).not.toContain("saved to your account");
    expect(body).not.toContain("checking your account");
    await expect(page.locator('[data-testid="favorites-sync-error"]')).toHaveCount(0);
  });
});

test.describe("The private API refuses a deployment with no identity provider", () => {
  test("answers 503, never 401, and never serves a list", async () => {
    const api = await apiContext();
    try {
      for (const call of [
        { method: "get" as const, path: "/api/me/favorites" },
        { method: "put" as const, path: "/api/me/favorites/1" },
        { method: "delete" as const, path: "/api/me/favorites/1" },
      ]) {
        const response = await api[call.method](call.path);
        // 503, because no credential the caller could supply would help here.
        expect(response.status(), call.path).toBe(503);
        expect(JSON.stringify(await response.json())).not.toContain("player_ids");
      }

      const merged = await api.post("/api/me/favorites/merge", { data: { player_ids: [1, 2] } });
      expect(merged.status()).toBe(503);
    } finally {
      await api.dispose();
    }
  });

  test("leaves every public read endpoint open", async () => {
    const api = await apiContext();
    try {
      for (const path of ["/api/players?page_size=1", "/api/methodology", "/api/health"]) {
        expect((await api.get(path)).status(), path).toBe(200);
      }
    } finally {
      await api.dispose();
    }
  });
});

test.describe("Bottom rail composition", () => {
  test("holds the compare tray at the geometry it has always had", async ({ page }) => {
    await seedDeviceState(page);
    await settle(page);

    const rail = page.locator('[data-testid="bottom-rail"]');
    const tray = page.locator('[data-testid="compare-tray"]');
    await expect(tray).toBeVisible();

    const railBox = (await rail.boundingBox())!;
    const trayBox = (await tray.boundingBox())!;
    // With only the tray present, the rail IS the tray's box: introducing the
    // shared container must not have moved or resized it.
    expect(Math.abs(railBox.y - trayBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(railBox.height - trayBox.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(railBox.width - trayBox.width)).toBeLessThanOrEqual(1);
  });

  test("does not intercept clicks through its empty region", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    // Nothing is queued, so the rail is empty. A page-wide invisible click
    // shield would be exactly the kind of regression nobody notices, so probe
    // the point it occupies.
    const state = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="bottom-rail"]') as HTMLElement | null;
      if (!rail) return "no rail";
      const box = rail.getBoundingClientRect();
      const at = document.elementFromPoint(box.left + box.width / 2, window.innerHeight - 8);
      return at && rail.contains(at) ? "blocked" : "clear";
    });
    expect(state).toBe("clear");
  });

  test("causes no horizontal overflow at 320px with the tray open", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await seedDeviceState(page);
    await settle(page);

    const metrics = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(metrics.doc).toBeLessThanOrEqual(metrics.win + 1);
  });

  test("passes an axe scan with the tray present", async ({ page }) => {
    await seedDeviceState(page);
    await settle(page);
    await expectNoA11yViolations(page, "discovery with bottom rail");
  });
});

test.describe("The compare tray stands down on the comparison itself", () => {
  test("carries the scout to the comparison, then disappears there", async ({ page }) => {
    // 1. Populate two comparison players, away from /compare.
    await page.goto("/");
    await page.waitForSelector('[data-testid="result-row"]');
    const names = await page
      .locator('[data-testid="player-result"]')
      .evaluateAll((nodes) => nodes.slice(0, 2).map((n) => (n.textContent ?? "").trim()));
    await page.locator('[data-testid="compare-action"]').nth(0).click();
    await page.locator('[data-testid="compare-action"]').nth(1).click();

    // 2. The tray and its call to action are there.
    const tray = page.locator('[data-testid="compare-tray"]');
    await expect(tray).toBeVisible();
    await expect(tray).toContainText("Compare queue · device local");
    const open = page.getByRole("link", { name: /Open comparison/i });
    await expect(open).toBeVisible();
    const href = await open.getAttribute("href");
    expect(href).toMatch(/^\/compare\?a=\d+&b=\d+$/);

    // 3. Open the comparison.
    await open.click();

    // 4. The route carries the players.
    await expect(page).toHaveURL(/\/compare\?a=\d+&b=\d+$/);
    // The two selectors always render; the table follows once the API answers.
    await page.waitForSelector('[data-testid="compare-a"]');
    await page.waitForSelector('[data-testid="compare-table"]');

    // 5. The tray is gone here, and stays gone.
    await settle(page);
    await expect(tray).toHaveCount(0);

    // 6. The selection is still the app's, not discarded to hide the tray.
    const queue = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("scoutboy.compareQueue.v1") ?? "[]"),
    );
    expect(queue).toHaveLength(2);
    // …and the comparison itself is showing those two players.
    const body = await page.locator("main").innerText();
    for (const name of names) {
      if (name) expect(body).toContain(name);
    }
  });

  test("comes back with its queue intact after leaving the comparison", async ({ page }) => {
    await seedDeviceState(page);
    await page.getByRole("link", { name: /Open comparison/i }).click();
    await expect(page).toHaveURL(/\/compare\?/);
    await expect(page.locator('[data-testid="compare-tray"]')).toHaveCount(0);

    // 7. Navigate away; the tray may return.
    await page.locator('[data-testid="nav-discover"]').first().click();
    await page.waitForSelector('[data-testid="result-row"]');
    const tray = page.locator('[data-testid="compare-tray"]');
    await expect(tray).toBeVisible();
    await expect(page.getByRole("link", { name: /Open comparison/i })).toHaveAttribute(
      "href",
      /^\/compare\?a=\d+&b=\d+$/,
    );
  });

  test("is absent on a direct load of /compare with a pre-existing queue", async ({ page }) => {
    // 8. Seed the device queue, then land on /compare cold.
    await seedDeviceState(page);
    const queue = await page.evaluate(() =>
      localStorage.getItem("scoutboy.compareQueue.v1"),
    );
    await page.goto("/compare");
    await settle(page);

    await expect(page.locator('[data-testid="compare-tray"]')).toHaveCount(0);
    // The queue is untouched by the suppression.
    expect(await page.evaluate(() => localStorage.getItem("scoutboy.compareQueue.v1"))).toBe(queue);
  });

  test("leaves the empty bottom rail inert on the comparison page", async ({ page }) => {
    // 9. Nothing in the rail: it must not intercept clicks or add visible space.
    await seedDeviceState(page);
    await page.goto("/compare");
    await settle(page);

    const state = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="bottom-rail"]') as HTMLElement | null;
      if (!rail) return { present: false } as const;
      const box = rail.getBoundingClientRect();
      const at = document.elementFromPoint(
        Math.max(1, box.left + box.width / 2),
        window.innerHeight - 8,
      );
      return {
        present: true,
        children: rail.children.length,
        height: Math.round(box.height),
        pointerEvents: getComputedStyle(rail).pointerEvents,
        interceptsClicks: !!(at && rail.contains(at)),
      } as const;
    });

    expect(state.present).toBe(true);
    if (state.present) {
      expect(state.children).toBe(0);
      expect(state.height).toBe(0);
      expect(state.pointerEvents).toBe("none");
      expect(state.interceptsClicks).toBe(false);
    }
  });

  test("passes an axe scan on the comparison page with a populated queue", async ({ page }) => {
    await seedDeviceState(page);
    await page.goto("/compare");
    await settle(page);
    await expectNoA11yViolations(page, "compare page with a device-local queue");
  });
});
