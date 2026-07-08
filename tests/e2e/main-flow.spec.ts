import { expect, test } from "@playwright/test";

// Core user flow: search -> open card -> view rating explanation ->
// open role leaderboard -> compare two players -> open methodology.
test("main scouting flow", async ({ page }) => {
  // 1) Search / home
  await page.goto("/");
  await expect(page.getByTestId("scope-banner")).toContainText("U23");
  await expect(page.getByTestId("player-result").first()).toBeVisible();

  // 2) Open a player card
  await page.getByTestId("player-result").first().click();
  await expect(page.getByTestId("player-card")).toBeVisible();
  await expect(page.getByTestId("role-ratings")).toBeVisible();
  await expect(page.getByTestId("market-panel")).toBeVisible();

  // 3) View the rating explanation (audit)
  const audit = page.getByTestId("audit-accordion");
  await expect(audit).toBeVisible();
  await audit.getByRole("button").first().click();
  await expect(audit).toContainText(/percentile|context|Rates/i);

  // 4) Role leaderboard
  await page.goto("/roles/touchline_winger");
  await expect(page.getByTestId("leaderboard-table")).toBeVisible();
  const firstRank = page.getByTestId("leaderboard-table").locator("tbody tr").first();
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
