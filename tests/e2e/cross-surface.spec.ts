import { expect, test, type Page } from "@playwright/test";

// Cross-surface extension coverage: each surface keeps a distinct structure,
// honesty states hold, and no surface overflows at narrow widths. Rare honesty
// states that the sample data cannot produce (a missing shared role) are driven
// by lightly editing the real API response, never by changing seed data.

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

const OVERFLOW_SURFACES: Array<{ path: string; ready: string }> = [
  { path: "/", ready: '[data-testid="results-ledger"]' },
  { path: "/roles/touchline_winger", ready: '[data-testid="leaderboard-ledger"]' },
  { path: "/compare", ready: "text=Pick two players to compare" },
  { path: "/shortlist", ready: "text=No players saved yet" },
  { path: "/methodology", ready: '[data-testid="methodology-contents"]' },
];

test.describe("Cross-surface layout & honesty", () => {
  for (const width of [320, 390]) {
    test(`no horizontal page overflow at ${width}px across surfaces`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      for (const { path, ready } of OVERFLOW_SURFACES) {
        await page.goto(path);
        await page.locator(ready).first().waitFor();
        expect(await pageOverflow(page), `overflow at ${path}`).toBeLessThanOrEqual(1);
      }
    });
  }

  test("discovery: filter rail narrows results and survives a scope change", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.getByTestId("filter-rail")).toBeVisible();
    await expect(page.getByTestId("results-ledger")).toBeVisible();
    await expect(page.getByTestId("result-row").first()).toBeVisible();

    await page.getByRole("button", { name: /All records/i }).click();
    await expect(page).toHaveURL(/scope=all_records/);
    // a result-pane change does not erase the filter rail
    await expect(page.getByTestId("filter-rail")).toBeVisible();

    await page.getByTestId("search-input").fill("Anton");
    await expect(page).toHaveURL(/q=Anton/);
    await expect(page.getByTestId("player-result").first()).toBeVisible();
  });

  test("leaderboard: desktop ranking table, mobile linear ledger, RoleFit Confidence label", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/roles/inside_forward");
    const table = page.locator('table[data-testid="leaderboard-table"]');
    await expect(table).toBeVisible();
    await expect(table.getByText("RoleFit Confidence")).toBeVisible();
    await expect(table.locator("tbody tr").first()).toContainText("1");
    await expect(page.getByTestId("page-meta")).toContainText("rated player");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('table[data-testid="leaderboard-table"]')).toBeHidden();
    await expect(page.getByTestId("leaderboard-ledger")).toBeVisible();
    await expect(page.getByTestId("leaderboard-ledger")).toContainText("#1");
  });

  test("compare: populated balance sheet explains the difference and shows evidence context", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/compare");
    await page.getByTestId("compare-a").selectOption({ index: 1 });
    await page.getByTestId("compare-b").selectOption({ index: 2 });
    await expect(page.getByTestId("compare-table")).toBeVisible();
    await expect(page.getByTestId("compare-side-left")).toBeVisible();
    await expect(page.getByTestId("compare-side-right")).toBeVisible();
    await expect(page.getByTestId("compare-role")).not.toBeEmpty();
    await expect(page.getByTestId("why-higher")).not.toBeEmpty();
    await expect(page.getByTestId("compare-metric-ledger")).toBeVisible();

    // Automatic-role copy reflects the real API fallback, not "most comparable".
    await expect(page.getByText(/Uses Player A.s best-rated role, falling back to Player B.s/)).toBeVisible();
    await expect(page.getByText(/most comparable/i)).toHaveCount(0);

    // Evidence context is visible and parallel on both sides.
    await expect(page.getByTestId("compare-context-left")).toContainText("Minutes");
    await expect(page.getByTestId("compare-context-right")).toContainText("Minutes");

    // Keyboard-readable: the role control is reachable/focusable.
    await page.getByTestId("compare-role-select").focus();
    await expect(page.getByTestId("compare-role-select")).toBeFocused();

    // No page-level horizontal overflow at 390px and 320px; conclusion + context survive.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await pageOverflow(page), `overflow at ${width}px`).toBeLessThanOrEqual(1);
      await expect(page.getByTestId("why-higher")).not.toBeEmpty();
      await expect(page.getByTestId("compare-context-left")).toContainText("Minutes");
    }
  });

  test("compare: honest unavailable state when a side lacks the selected role", async ({ page }) => {
    // Lightly edit the real response so player B is not rated in the selected role.
    await page.route("**/api/compare*", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      const roleKey = json.role_key;
      json.player_b.role_ratings = (json.player_b.role_ratings ?? []).filter(
        (r: { role_key: string }) => r.role_key !== roleKey,
      );
      await route.fulfill({ response, json });
    });
    await page.goto("/compare");
    await page.getByTestId("compare-a").selectOption({ index: 1 });
    await page.getByTestId("compare-b").selectOption({ index: 2 });
    await expect(page.getByTestId("compare-table")).toBeVisible();
    await expect(page.getByTestId("compare-unavailable-right")).toContainText("Not rated in this role");
    await expect(page.getByTestId("why-higher")).not.toBeEmpty();
    // the rated side still shows its evidence context honestly
    await expect(page.getByTestId("compare-context-left")).toContainText("Minutes");
  });

  test("compare: evidence context stays honest when a side supplies none (intercepted)", async ({ page }) => {
    // Null out one side's context in the real response — a state the sample data
    // does not otherwise produce.
    await page.route("**/api/compare*", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.player_b.context = null;
      await route.fulfill({ response, json });
    });
    await page.goto("/compare");
    await page.getByTestId("compare-a").selectOption({ index: 1 });
    await page.getByTestId("compare-b").selectOption({ index: 2 });
    await expect(page.getByTestId("compare-table")).toBeVisible();
    await expect(page.getByTestId("compare-context-right")).toContainText("Evidence context unavailable");
    // the other side is unaffected and the conclusion is retained
    await expect(page.getByTestId("compare-context-left")).toContainText("Minutes");
    await expect(page.getByTestId("why-higher")).not.toBeEmpty();
  });

  test("shortlist: add from discovery, revisit, and remove", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page
      .getByTestId("result-row")
      .first()
      .getByRole("button", { name: /Add .* to shortlist/i })
      .click();
    await expect(page.getByText(/Shortlist 1 · saved on this device/)).toBeVisible();

    await page.goto("/shortlist");
    await expect(page.getByTestId("shortlist-record")).toHaveCount(1);
    await page.getByRole("button", { name: "Remove" }).first().click();
    await expect(page.getByText(/No players saved yet/)).toBeVisible();
  });

  test("methodology: calibration disclosure + contents rail, limitations visible", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/methodology");
    await expect(page.getByRole("heading", { name: "Methodology" })).toBeVisible();
    await expect(page.getByTestId("methodology-contents")).toBeVisible();
    await expect(page.getByText(/Status: (Pass|Warn|Fail|Inconclusive)/)).toBeVisible();
    await expect(page.getByText(/Real-pilot limitation/)).toBeVisible();
    await expect(page.getByText(/Limitations/).first()).toBeVisible();
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("mobile navigation toggles on the discovery surface", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const toggle = page.getByTestId("nav-menu-toggle");
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId("nav-leaderboards")).toBeHidden();
    await toggle.click();
    await expect(page.getByTestId("nav-leaderboards")).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId("nav-leaderboards")).toBeHidden();
  });

  test("keyboard focus is visible on discovery controls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    // Establish keyboard modality so the next focus matches :focus-visible.
    await page.getByTestId("search-input").focus();
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return { style: "none", width: "0px" };
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth };
    });
    expect(outline.style !== "none" || outline.width !== "0px").toBe(true);
  });
});
