import { expect, test } from "@playwright/test";

// Core user flow: search -> open card -> view rating explanation ->
// open role leaderboard -> compare two players -> open methodology.
test("main scouting flow", async ({ page }) => {
  // 1) Search / home
  await page.goto("/");
  await expect(page.getByTestId("scope-banner")).toContainText("RoleFit analysis");
  // Analysis scope is no longer a Discovery control; the default analyzed pool is.
  await expect(page.getByTestId("scope-filter")).toHaveCount(0);
  await expect(page.getByTestId("player-result").first()).toBeVisible();
  // The header counts active narrowing criteria rather than restating one of
  // them; an unfiltered ledger therefore says nothing about criteria at all. The
  // age condition itself stays visible in the always-present Age control and in
  // the rail's active-criteria list.
  await expect(page.getByTestId("result-count")).not.toContainText("criteri");
  await expect(page.getByTestId("active-criteria")).toHaveCount(0);
  const defaultCountText = await page.getByTestId("result-count").textContent();
  expect(defaultCountText).not.toBeNull();

  // Age threshold: one bound at a time, both directions, then an explicit reset.
  await page.getByTestId("age-direction-younger").click();
  await expect(page).toHaveURL(/age_max=25/);
  await expect(page).not.toHaveURL(/age_min/);
  await expect(page.getByTestId("result-count")).toContainText("1 active criterion");
  await expect(page.getByTestId("active-criteria-count")).toHaveText("1 Active Criterion");
  await expect(page.getByTestId("active-criteria-summary")).toContainText(
    "Age: 25 Years And Younger",
  );
  await expect(page.getByTestId("player-result").first()).toBeVisible();

  await page.getByTestId("age-direction-older").click();
  await expect(page).toHaveURL(/age_min=25/);
  await expect(page).not.toHaveURL(/age_max/);

  await page.getByTestId("age-direction-all").click();
  await expect(page).not.toHaveURL(/age_m(in|ax)/);
  await expect(page.getByTestId("result-count")).not.toContainText("criteri");
  await expect(page.getByTestId("active-criteria")).toHaveCount(0);

  // A legacy age_band link still loads and still narrows by age.
  await page.goto("/?age_band=u23");
  await expect(page.getByTestId("age-threshold-value")).toHaveText("22 Years");
  await expect(page.getByTestId("age-direction-younger")).toHaveAttribute("aria-pressed", "true");

  await page.goto("/");
  await expect(page.getByTestId("player-result").first()).toBeVisible();

  // 2) Open a player card
  await page.getByTestId("player-result").first().click();
  await expect(page.getByTestId("player-card")).toBeVisible();
  await expect(page.getByTestId("role-ratings")).toBeVisible();
  await expect(page.getByTestId("market-panel")).toBeVisible();

  // 2b) Recruitment Desk: best role active, role switch updates score + territory
  const selector = page.getByTestId("role-selector");
  await expect(selector).toBeVisible();
  const tabs = selector.getByRole("tab");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("territory-disclosure")).toContainText(
    "Not tracking or event-location data.",
  );
  // no unsupported tracking-data claim anywhere on the page
  await expect(page.locator("body")).not.toContainText(/heatmap|gps|tracked position/i);

  const summaryBefore = await page.getByTestId("selected-role-summary").textContent();
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  const summaryAfter = await page.getByTestId("selected-role-summary").textContent();
  expect(summaryAfter).not.toEqual(summaryBefore);
  // the territory + its supporting evidence updated with the role
  await expect(page.getByTestId("role-territory")).toBeVisible();
  await expect(page.getByTestId("role-evidence-list")).toBeVisible();

  // 3) View the rating explanation (audit)
  const audit = page.getByTestId("audit-accordion");
  await expect(audit).toBeVisible();
  await audit.getByRole("button").first().click();
  await expect(audit).toContainText(/percentile|context|Rates/i);

  // 4) Role leaderboard
  await page.goto("/roles/touchline_winger");
  const leaderboard = page.locator('table[data-testid="leaderboard-table"]');
  await expect(leaderboard).toBeVisible();
  const firstRank = leaderboard.locator("tbody tr").first();
  await expect(firstRank).toContainText("1");

  // 5) Compare two players
  await page.goto("/compare");
  await page.getByTestId("compare-a").selectOption({ index: 1 });
  await page.getByTestId("compare-b").selectOption({ index: 2 });
  await expect(page.getByTestId("compare-table")).toBeVisible();
  await expect(page.getByTestId("why-higher")).not.toBeEmpty();

  // 6) Methodology
  await page.goto("/methodology");
  await expect(page.getByRole("heading", { name: "Methodology" })).toBeVisible();
  await expect(page.getByText(/RoleFit rating/i).first()).toBeVisible();
});
