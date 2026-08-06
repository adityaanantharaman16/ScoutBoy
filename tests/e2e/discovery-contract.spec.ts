import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 8.1A - the Discovery contract, proved in a real browser against the
 * committed sample fixture cohort.
 *
 * The invariant: the role, score and confidence a row DISPLAYS are the same stored
 * role rating that filtered and ordered it. Before this phase, `?role=<key>` ranked
 * by the selected role but rendered each player's best role, so the visible scores
 * ran out of order on screen while the API considered the page correctly sorted.
 *
 * Player identity is asserted by canonical name, never by primary key: the fixture
 * database is rebuilt per run and ids are not part of the contract. Role identity is
 * asserted by the role caption the API supplies.
 */

const SELECTED_ROLE = "touchline_winger";
const SELECTED_ROLE_LABEL = "Touchline Winger";
/** Well above the retired 99 ceiling, and a real narrowing of the sample cohort. */
const MINUTES_THRESHOLD = 1500;

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Every row's displayed name, RoleFit score and role caption, in ledger order. */
async function ledgerRows(page: Page) {
  await page.getByTestId("results-ledger").waitFor();
  return page.locator('[data-testid="result-row"]').evaluateAll((rows) =>
    rows.map((row) => ({
      name: row.querySelector('[data-testid="player-result"]')?.textContent?.trim() ?? "",
      score: row.querySelector('[data-testid="score-readout"] > div')?.textContent?.trim() ?? "",
      role: row.querySelector('[data-testid="score-caption"]')?.textContent?.trim() ?? "",
      minutes: row.querySelector('[data-testid="row-identity"]')?.textContent ?? "",
    })),
  );
}

test.describe("Role-filtered Discovery shows the role it ranked by", () => {
  test("every visible row reports the selected role, in selected-role order", async ({ page }) => {
    // a HARD load of a role-filtered URL, as a shared link would arrive
    await page.goto(`/?role=${SELECTED_ROLE}`);
    const rows = await ledgerRows(page);

    expect(rows.length).toBeGreaterThan(2);

    // (2) every RoleFit hero is showing the SELECTED role, not a best role
    for (const row of rows) {
      expect(row.role, `${row.name} should display the selected role`).toBe(SELECTED_ROLE_LABEL);
    }

    // (3) the displayed scores are in the order the ledger claims to be sorted in.
    // This is the assertion the old behaviour failed: it ranked by the selected role
    // while printing best-role scores, so the visible column was not monotonic.
    const scores = rows.map((r) => Number(r.score));
    expect(scores.every((s) => Number.isFinite(s))).toBe(true);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    // the summary agrees that this is one ranked ledger of real players
    await expect(page.getByTestId("result-count")).toContainText("Ranked ledger");
  });

  test("the selected role's score replaces the best-role score for the same player", async ({
    page,
  }) => {
    // unfiltered: each row shows the player's own best role
    await page.goto("/?page_size=100");
    const unfiltered = new Map(
      (await ledgerRows(page)).map((r) => [r.name, { score: r.score, role: r.role }]),
    );

    await page.goto(`/?role=${SELECTED_ROLE}&page_size=100`);
    const filtered = await ledgerRows(page);
    expect(filtered.length).toBeGreaterThan(2);

    // At least one player in this cohort is better at another role, and that player's
    // displayed score and caption must CHANGE under the filter. If nothing changed,
    // the row would be showing the best role while being ranked by the selected one.
    const changed = filtered.filter((row) => {
      const before = unfiltered.get(row.name);
      return before != null && before.role !== SELECTED_ROLE_LABEL;
    });
    expect(
      changed.length,
      "fixture cohort no longer contains a player whose best role differs",
    ).toBeGreaterThan(0);
    for (const row of changed) {
      expect(row.role).toBe(SELECTED_ROLE_LABEL);
      expect(row.score).not.toBe(unfiltered.get(row.name)!.score);
    }
  });

  test("the filtered URL reloads into the same ledger", async ({ page }) => {
    await page.goto(`/?role=${SELECTED_ROLE}`);
    const before = await ledgerRows(page);

    // (6) a reload of the filtered URL still works and still means the same thing
    await page.reload();
    const after = await ledgerRows(page);
    expect(after).toEqual(before);
    await expect(page.getByTestId("role-filter")).toHaveValue(SELECTED_ROLE);
  });

  test("stays operable from the keyboard with accessible names intact", async ({ page }) => {
    await page.goto(`/?role=${SELECTED_ROLE}`);
    await page.getByTestId("results-ledger").waitFor();

    // (8) the rail's controls keep their accessible names under a role filter
    await expect(page.getByLabel("Min minutes")).toBeVisible();
    await expect(page.getByLabel("Min RoleFit")).toBeVisible();
    await expect(page.getByLabel("Sort")).toBeVisible();
    await expect(page.getByTestId("age-threshold-slider")).toHaveAccessibleName("Age threshold");

    // the role select is reachable and operable by keyboard, and its own value is
    // what the ledger is showing
    const role = page.getByTestId("role-filter");
    await role.focus();
    await expect(role).toBeFocused();
    const outline = await role.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("");

    await role.selectOption("inside_forward");
    await expect(page).toHaveURL(/role=inside_forward/);
    const rows = await ledgerRows(page);
    for (const row of rows) expect(row.role).toBe("Inside Forward");
  });

  // (7) no page-level horizontal overflow at a representative desktop and mobile
  // width while a role filter is active
  for (const { name, width, height } of [
    { name: "desktop 1280", width: 1280, height: 900 },
    { name: "mobile 390", width: 390, height: 844 },
  ]) {
    test(`does not overflow the page at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/?role=${SELECTED_ROLE}&min_minutes=${MINUTES_THRESHOLD}`);
      await page.getByTestId("results-ledger").waitFor();
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("A realistic minimum-minutes threshold", () => {
  test("accepts a value far above the retired 99 ceiling and narrows honestly", async ({
    page,
  }) => {
    await page.goto("/?page_size=100");
    const all = await ledgerRows(page);

    // (4) typed into the control, not just supplied by URL
    await page.goto("/?page_size=100");
    await page.getByTestId("results-ledger").waitFor();
    await page.getByLabel("Min minutes").fill(String(MINUTES_THRESHOLD));
    await expect(page).toHaveURL(new RegExp(`min_minutes=${MINUTES_THRESHOLD}`));

    const narrowed = await ledgerRows(page);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThan(all.length);

    // the value survived intact: it was NOT clamped to the old 0-99 RoleFit ceiling
    await expect(page.getByLabel("Min minutes")).toHaveValue(String(MINUTES_THRESHOLD));

    // every remaining row genuinely clears the threshold
    for (const row of narrowed) {
      const minutes = Number(/(\d+)\s*min/.exec(row.minutes)?.[1] ?? NaN);
      expect(minutes).toBeGreaterThanOrEqual(MINUTES_THRESHOLD);
    }
  });

  test("states the minutes and RoleFit contracts separately in the rail", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const help = page.locator("#filter-threshold-help");
    await expect(help).toContainText("Whole minutes 0-10,000");
    await expect(help).toContainText("whole RoleFit 0-99");
    await expect(page.getByLabel("Min minutes")).toHaveAttribute("max", "10000");
    await expect(page.getByLabel("Min RoleFit")).toHaveAttribute("max", "99");
  });
});

test.describe("Sort and pagination", () => {
  test("changing Sort from a later page returns to page 1", async ({ page }) => {
    // a small page size guarantees a later page exists in the fixture cohort
    await page.goto("/?page_size=2&page=3");
    await page.getByTestId("results-ledger").waitFor();
    await expect(page.getByTestId("result-count")).toContainText("page 3 of");

    // (5) the ranking changes, so the page must reset rather than showing page 3 of a
    // freshly reordered ledger
    await page.getByLabel("Sort").selectOption("name_asc");
    await expect(page).toHaveURL(/sort=name_asc/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByTestId("result-count")).toContainText("page 1 of");
  });

  test("a page past the end lands on the last real page, not an empty state", async ({ page }) => {
    await page.goto("/?page_size=2&page=999");
    await page.getByTestId("results-ledger").waitFor();

    // the URL is rewritten to the page actually served...
    await expect(page).not.toHaveURL(/page=999/);
    const url = new URL(page.url());
    const served = Number(url.searchParams.get("page") ?? "1");
    expect(served).toBeGreaterThan(0);

    // ...and the summary, the ledger and the pager all agree on it
    await expect(page.getByTestId("result-count")).toContainText(`page ${served} of ${served}`);
    expect((await ledgerRows(page)).length).toBeGreaterThan(0);
    await expect(page.getByText("No players match these filters")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

    // reloading the canonical URL is stable
    await page.reload();
    await expect(page.getByTestId("result-count")).toContainText(`page ${served} of ${served}`);
  });

  test("an unrepresentable URL sort is not forwarded and the control agrees", async ({ page }) => {
    // `age_desc` is a real API-only mode with no option in the control
    await page.goto("/?sort=age_desc");
    await page.getByTestId("results-ledger").waitFor();
    await expect(page.getByLabel("Sort")).toHaveValue("rolefit_desc");

    await page.goto("/?sort=not_a_sort");
    await page.getByTestId("results-ledger").waitFor();
    await expect(page.getByLabel("Sort")).toHaveValue("rolefit_desc");
    // a real ledger loaded rather than the API's validation error or an empty state,
    // because the unknown value was never forwarded
    expect((await ledgerRows(page)).length).toBeGreaterThan(0);
    await expect(page.getByText("No players match these filters")).toHaveCount(0);
    await expect(page.getByText("Failed to load players")).toHaveCount(0);
  });

  for (const direction of ["asc", "desc"] as const) {
    test(`asking-price ${direction} orders by the known lower bound, unknown last`, async ({
      page,
    }) => {
      await page.goto(`/?sort=value_${direction}&page_size=100`);
      await page.getByTestId("results-ledger").waitFor();
      const markets = await page
        .locator('[data-testid="status-line-market"]')
        .evaluateAll((els) => els.map((el) => el.textContent ?? ""));

      expect(markets.length).toBeGreaterThan(1);
      // nothing is ever presented as a EUR 0 asking price
      for (const market of markets) expect(market).not.toContain("€0");

      // A row's ordering value is its LOWER bound. "Unknown" has none, and so does
      // "Up to EUR X" (a range whose low endpoint is missing); both must trail every
      // known lower bound in BOTH directions.
      const lows = markets.map((text) => {
        if (/Unknown/i.test(text) || /Up to/i.test(text)) return null;
        return parseEur(text);
      });
      const knownFlags = lows.map((low) => low != null);
      expect(knownFlags).toEqual([...knownFlags].sort((a, b) => Number(b) - Number(a)));

      const known = lows.filter((low): low is number => low != null);
      expect(known.length).toBeGreaterThan(1);
      expect(known).toEqual(
        [...known].sort((a, b) => (direction === "asc" ? a - b : b - a)),
      );
    });
  }
});

/** First EUR figure in a market readout, in absolute euros. "€58.5M" -> 58_500_000. */
function parseEur(text: string): number | null {
  const match = /€([\d.,]+)\s*([KMB])?/.exec(text);
  if (!match) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[match[2] ?? ""] ?? 1;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value * scale : null;
}
