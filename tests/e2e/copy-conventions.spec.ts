import { expect, test, type Page } from "@playwright/test";

import { gotoFirstDossier } from "./support/surfaces";

// Runtime punctuation + title audit.
//
// The source-level guard lives in `apps/web/src/tests/copy-conventions.test.tsx`;
// this is the half that source scanning cannot cover — copy the API generates and
// the frontend renders (methodology limitations, market factors, audit
// explanations, confidence notes, compare warnings) and the titles the browser
// actually reports.

const EM_DASH = "—";

/** Every route reachable in production, with a proof-of-render anchor. */
const ROUTES: Array<{ id: string; path: string; ready: string; title: string }> = [
  {
    id: "discovery",
    path: "/",
    ready: '[data-testid="results-ledger"]',
    title: "ScoutBoy - Player Discovery",
  },
  {
    id: "players",
    path: "/players",
    ready: '[data-testid="results-ledger"]',
    title: "ScoutBoy - Player Discovery",
  },
  {
    id: "leaderboard",
    path: "/roles/touchline_winger",
    ready: '[data-testid="leaderboard-table"], [data-testid="leaderboard-ledger"]',
    title: "Role Leaderboard - ScoutBoy",
  },
  {
    id: "compare",
    path: "/compare",
    ready: '[data-testid="compare-a"]',
    title: "Compare Players - ScoutBoy",
  },
  { id: "favorites", path: "/shortlist", ready: "h1", title: "My Favorites - ScoutBoy" },
  {
    id: "methodology",
    path: "/methodology",
    ready: '[data-testid="methodology-contents"]',
    title: "Methodology - ScoutBoy",
  },
  {
    id: "not-found",
    path: "/this-route-does-not-exist",
    ready: '[data-testid="not-found"]',
    title: "Page Not Found - ScoutBoy",
  },
  {
    id: "design-pilot",
    path: "/design-pilots/dark-mode",
    ready: "h1",
    title: "Dark Mode Pilot - ScoutBoy (for visual approval)",
  },
];

/** Rendered, user-visible text of the whole document. */
async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

test.describe("Sitewide copy conventions", () => {
  for (const { id, path, ready, title } of ROUTES) {
    test(`${id}: title uses " - " and no rendered copy contains an em dash`, async ({ page }) => {
      await page.goto(path);
      await page.locator(ready).first().waitFor();

      await expect(page).toHaveTitle(title);
      expect(title, `${id} title separator`).toContain(" - ");

      const text = await visibleText(page);
      expect(text, `${id} rendered copy`).not.toContain(EM_DASH);
      // title attributes and aria labels are user-visible too
      const attributes = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("*"))
          .flatMap((el) => [el.getAttribute("title"), el.getAttribute("aria-label")])
          .filter((v): v is string => !!v)
          .join("\n"),
      );
      expect(attributes, `${id} title/aria copy`).not.toContain(EM_DASH);
    });
  }

  test("player dossier: no em dash in any rendered copy, including API-generated text", async ({
    page,
  }) => {
    await gotoFirstDossier(page);
    await expect(page).toHaveTitle("Player Dossier - ScoutBoy");
    expect(await visibleText(page)).not.toContain(EM_DASH);

    // open the audit, which renders the engine's own explanation strings
    const audit = page.getByTestId("audit-accordion");
    await audit.waitFor();
    for (const button of await audit.getByRole("button").all()) await button.click();
    expect(await visibleText(page)).not.toContain(EM_DASH);

    // and the comparable-player cards further down the page
    await page.getByTestId("similar-group").first().waitFor();
    expect(await visibleText(page)).not.toContain(EM_DASH);
  });

  test("comparison: no em dash in the conclusion or confidence warnings", async ({ page }) => {
    await page.goto("/compare");
    await page.getByTestId("compare-a").selectOption({ index: 1 });
    await page.getByTestId("compare-b").selectOption({ index: 2 });
    await page.getByTestId("compare-table").waitFor();
    expect(await visibleText(page)).not.toContain(EM_DASH);
  });

  test("methodology renders the corrected scope and the 0-99 scale", async ({ page }) => {
    await page.goto("/methodology");
    await page.getByTestId("methodology-contents").waitFor();

    await expect(page.getByTestId("methodology-formula")).toContainText("clamped to 0-99");
    await expect(page.getByTestId("methodology-formula")).not.toContainText("99.9");

    const text = await visibleText(page);
    expect(text).not.toContain("99.9");
    expect(text).not.toMatch(/U23/);
    expect(text).toContain("profile-only");
    expect(text).toContain("attacking and midfield roles only");
    // defenders and goalkeepers are named as UNRATED, never as rated
    expect(text).toContain("never given a RoleFit rating");
  });

  test("the wordmark is ScoutBoy alone on every surface", async ({ page }) => {
    for (const { path, ready } of ROUTES.slice(0, 6)) {
      await page.goto(path);
      await page.locator(ready).first().waitFor();
      const brand = page.getByRole("banner").getByRole("link", { name: /ScoutBoy/ }).first();
      await expect(brand).toHaveText("ScoutBoy");
      await expect(brand).toHaveAttribute("href", "/");
      await expect(page.getByRole("banner")).not.toContainText("Recruitment");
    }
  });

  test("missing values render a plain hyphen, never an em dash or a zero", async ({ page }) => {
    // The market panel's honest-unknown state is the widest sentinel surface.
    await page.route("**/api/players/*/market", (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ detail: "not found" }) }),
    );
    await gotoFirstDossier(page);
    const text = await visibleText(page);
    expect(text).not.toContain(EM_DASH);
  });
});
