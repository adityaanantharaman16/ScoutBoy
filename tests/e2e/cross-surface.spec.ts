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

/** Per-row ledger geometry, read in one pass so the numbers are self-consistent. */
type LedgerRowGeometry = {
  name: string;
  role: string;
  heroX: number;
  heroW: number;
  heroCentreDelta: number;
  captionLines: number;
  captionOverflows: boolean;
  statusIncreasing: boolean;
  statusSameLeft: boolean;
  railBelowStatus: boolean;
  railX: number;
  railW: number;
  railH: number;
  rowH: number;
  rowFillsLedger: boolean;
  actionA: { x: number; y: number; w: number; h: number };
  actionB: { x: number; y: number; w: number; h: number };
};

async function ledgerGeometry(
  page: Page,
  rowTestId: string,
  nameTestId: string,
  ledgerTestId: string,
  actionATestId: string,
  actionBTestId: string,
): Promise<LedgerRowGeometry[]> {
  return page.evaluate(
    ([rowSel, nameSel, ledgerSel, aSel, bSel]) => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const ledger = document
        .querySelector(`[data-testid="${ledgerSel}"]`)!
        .getBoundingClientRect();
      return [...document.querySelectorAll(`[data-testid="${rowSel}"]`)].map((row) => {
        const pick = (id: string) => box(row.querySelector(`[data-testid="${id}"]`)!);
        const hero = pick("row-rolefit");
        const rowBox = box(row);
        const caption = row.querySelector('[data-testid="score-caption"]') as HTMLElement | null;
        const lineHeight = caption ? parseFloat(getComputedStyle(caption).lineHeight) : 0;
        const cov = pick("status-line-coverage");
        const mkt = pick("status-line-market");
        const pls = pick("status-line-playstyles");
        const rail = pick("action-rail");
        return {
          name: (row.querySelector(`[data-testid="${nameSel}"]`) as HTMLElement).innerText.trim(),
          role: caption ? caption.textContent ?? "" : "",
          heroX: hero.x,
          heroW: hero.w,
          heroCentreDelta: hero.y + hero.h / 2 - (rowBox.y + rowBox.h / 2),
          captionLines:
            caption && lineHeight > 0
              ? Math.round(caption.getBoundingClientRect().height / lineHeight)
              : 0,
          captionOverflows: caption ? caption.scrollWidth > caption.clientWidth + 1 : false,
          statusIncreasing: cov.y < mkt.y && mkt.y < pls.y,
          statusSameLeft: Math.abs(cov.x - mkt.x) <= 1 && Math.abs(mkt.x - pls.x) <= 1,
          railBelowStatus: rail.y >= pls.y + pls.h - 1,
          railX: rail.x,
          railW: rail.w,
          railH: rail.h,
          rowH: rowBox.h,
          rowFillsLedger: Math.abs(rowBox.w - ledger.width) <= 2,
          actionA: pick(aSel),
          actionB: pick(bSel),
        };
      });
    },
    [rowTestId, nameTestId, ledgerTestId, actionATestId, actionBTestId] as const,
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

  test("discovery: filter rail narrows results and survives an age change", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.getByTestId("filter-rail")).toBeVisible();
    await expect(page.getByTestId("results-ledger")).toBeVisible();
    await expect(page.getByTestId("result-row").first()).toBeVisible();

    await page.getByTestId("age-direction-younger").click();
    await expect(page).toHaveURL(/age_max=25/);
    // a result-pane change does not erase the filter rail
    await expect(page.getByTestId("filter-rail")).toBeVisible();

    await page.getByTestId("search-input").fill("Anton");
    await expect(page).toHaveURL(/q=Anton/);
    await expect(page.getByTestId("player-result").first()).toBeVisible();
  });

  test("discovery desktop: three-region ledger, centred RoleFit hero, full-height action rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const row = page.getByTestId("result-row").first();
    await expect(row).toBeVisible();

    const identity = row.getByTestId("row-identity");
    const hero = row.getByTestId("row-rolefit");
    const rail = row.getByTestId("action-rail");
    for (const region of [identity, hero, rail]) await expect(region).toBeVisible();

    const rowBox = (await row.boundingBox())!;
    const identityBox = (await identity.boundingBox())!;
    const heroBox = (await hero.boundingBox())!;
    const railBox = (await rail.boundingBox())!;

    // left → right: player information, RoleFit hero, action rail
    expect(identityBox.x + identityBox.width).toBeLessThanOrEqual(heroBox.x + 1);
    expect(heroBox.x + heroBox.width).toBeLessThanOrEqual(railBox.x + 1);

    // the whole RoleFit group is vertically centred in the row
    const rowCentre = rowBox.y + rowBox.height / 2;
    const heroCentre = heroBox.y + heroBox.height / 2;
    expect(Math.abs(heroCentre - rowCentre)).toBeLessThanOrEqual(6);

    // the rail stretches to the row's useful height
    expect(railBox.height).toBeGreaterThan(rowBox.height * 0.7);

    // two equal-height rows filling the rail's width: favourite on top, compare below
    const favBox = (await row.getByTestId("favorite-action").boundingBox())!;
    const cmpBox = (await row.getByTestId("compare-action").boundingBox())!;
    expect(Math.abs(favBox.width - cmpBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(favBox.height - cmpBox.height)).toBeLessThanOrEqual(1);
    expect(favBox.y).toBeLessThan(cmpBox.y);
    expect(Math.abs(favBox.y + favBox.height - cmpBox.y)).toBeLessThanOrEqual(2);
    expect(favBox.width).toBeGreaterThanOrEqual(railBox.width - 3);
  });

  test("discovery desktop: the RoleFit track is stable and long role names wrap on word boundaries", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // Midfield roles put the long names ("Deep-Lying Playmaker",
    // "Ball-Winning Midfielder") next to short ones ("Advanced 8") in one ledger.
    await page.goto("/?position_group=MID");
    await page.getByTestId("results-ledger").waitFor();
    const rows = await ledgerGeometry(
      page,
      "result-row",
      "player-result",
      "results-ledger",
      "favorite-action",
      "compare-action",
    );
    expect(rows.length).toBeGreaterThan(2);

    const short = rows.filter((r) => r.captionLines === 1);
    const long = rows.filter((r) => r.captionLines > 1);
    expect(short.length, "a short role is present").toBeGreaterThan(0);
    expect(long.length, "a long role is present").toBeGreaterThan(0);
    // the long roles are the hyphenated multi-word ones, wrapped not truncated
    for (const row of long) {
      expect(row.role, `${row.name} keeps its full role name`).toMatch(/^\S+-\S+ \S+$/);
      expect(row.captionOverflows, `${row.name} role is not clipped`).toBe(false);
      expect(row.role).not.toContain("…");
    }

    // every RoleFit divider/column starts at the same x, within a pixel
    const heroXs = rows.map((r) => r.heroX);
    expect(Math.max(...heroXs) - Math.min(...heroXs), "RoleFit column starts align").toBeLessThanOrEqual(1);
    const heroWs = rows.map((r) => r.heroW);
    expect(Math.max(...heroWs) - Math.min(...heroWs), "RoleFit track width is stable").toBeLessThanOrEqual(1);
    // and the action rail stays dimensionally consistent across rows
    const railXs = rows.map((r) => r.railX);
    const railWs = rows.map((r) => r.railW);
    expect(Math.max(...railXs) - Math.min(...railXs)).toBeLessThanOrEqual(1);
    expect(Math.max(...railWs) - Math.min(...railWs)).toBeLessThanOrEqual(1);

    for (const row of rows) {
      // the hero stays vertically centred, including on a two-line role
      expect(Math.abs(row.heroCentreDelta), `${row.name} hero centred`).toBeLessThanOrEqual(6);
      // three status lines, strictly increasing, all from the same left edge
      expect(row.statusIncreasing, `${row.name} status order`).toBe(true);
      expect(row.statusSameLeft, `${row.name} status left edge`).toBe(true);
      // both actions stay equal halves of a full-height rail
      expect(Math.abs(row.actionA.w - row.actionB.w)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.actionA.h - row.actionB.h)).toBeLessThanOrEqual(1);
      expect(row.actionA.y).toBeLessThan(row.actionB.y);
      expect(row.railH).toBeGreaterThan(row.rowH * 0.7);
    }
  });

  test("discovery: the favourite heart toggles, persists via My Favorites, and compare still queues", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const row = page.getByTestId("result-row").first();
    const favorite = row.getByTestId("favorite-action");
    const heart = row.getByTestId("favorite-heart");
    const name = (await row.getByTestId("player-result").innerText()).trim();

    await expect(favorite).toHaveAttribute("aria-pressed", "false");
    await expect(heart).toHaveAttribute("data-filled", "false");
    await expect(favorite).toHaveAccessibleName(`Add ${name} to My Favorites`);
    const before = (await favorite.boundingBox())!;

    await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
    await expect(heart).toHaveAttribute("data-filled", "true");
    await expect(favorite).toHaveAccessibleName(`Remove ${name} from My Favorites`);
    await expect(page.getByTestId("favorites-counter")).toContainText(
      "My Favorites 1 · saved on this device",
    );
    // selecting a player must not resize its action region
    const after = (await favorite.boundingBox())!;
    expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1);

    await page.getByTestId("nav-shortlist").click();
    await expect(page).toHaveURL(/\/shortlist$/);
    await expect(page.getByTestId("shortlist-record")).toHaveCount(1);

    await page.goto("/");
    const back = page.getByTestId("result-row").first();
    await expect(back.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "true");
    await expect(back.getByTestId("favorite-heart")).toHaveAttribute("data-filled", "true");

    // compare queue behaviour is unchanged, and shows no visible "vs"
    const compare = back.getByTestId("compare-action");
    await expect(compare).toHaveText("Compare");
    await compare.click();
    await expect(compare).toHaveAttribute("aria-pressed", "true");
    await expect(compare).toHaveText("Compare");
    // the compare tray (exact label — the rail buttons' names also end in "compare queue")
    const tray = page.getByLabel("Compare queue", { exact: true });
    await expect(tray).toBeVisible();
    await expect(tray).toContainText("Add one more player");
  });

  test("discovery mobile: approved stacked layout holds at 640/390/320", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const row = page.getByTestId("result-row").first();
    await expect(row).toBeVisible();

    const identityBox = (await row.getByTestId("row-identity").boundingBox())!;
    const heroBox = (await row.getByTestId("row-rolefit").boundingBox())!;
    // identity keeps the left, RoleFit the right, and the hero stays legible
    expect(heroBox.x).toBeGreaterThan(identityBox.x);
    await expect(row.getByTestId("row-rolefit")).toContainText("RoleFit");

    // 640px doubles as the 200%-zoom-equivalent reflow check on a 1280 desktop.
    for (const width of [640, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const [first] = await ledgerGeometry(
        page,
        "result-row",
        "player-result",
        "results-ledger",
        "favorite-action",
        "compare-action",
      );
      // coverage → market → playstyles, each on its own line from the same left edge
      expect(first.statusIncreasing, `status order at ${width}px`).toBe(true);
      expect(first.statusSameLeft, `status left edge at ${width}px`).toBe(true);
      expect(first.railBelowStatus, `rail below the status stack at ${width}px`).toBe(true);
      // equal-width bottom halves, each at least a 44px target
      expect(Math.abs(first.actionA.w - first.actionB.w), `equal widths at ${width}px`).toBeLessThanOrEqual(1);
      expect(Math.abs(first.actionA.y - first.actionB.y), `same row at ${width}px`).toBeLessThanOrEqual(1);
      expect(first.actionA.x).toBeLessThan(first.actionB.x);
      expect(first.actionA.w).toBeGreaterThanOrEqual(first.railW / 2 - 3);
      expect(first.actionA.h, `44px target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(first.actionB.h, `44px target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(await pageOverflow(page), `overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
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
    const comparison = page.waitForResponse(
      (r) => r.url().includes("/api/compare") && r.status() === 200,
    );
    await page.getByTestId("compare-a").selectOption({ index: 1 });
    await page.getByTestId("compare-b").selectOption({ index: 2 });
    await expect(page.getByTestId("compare-table")).toBeVisible();
    await expect(page.getByTestId("compare-side-left")).toBeVisible();
    await expect(page.getByTestId("compare-side-right")).toBeVisible();
    await expect(page.getByTestId("compare-role")).not.toBeEmpty();
    await expect(page.getByTestId("why-higher")).not.toBeEmpty();
    await expect(page.getByTestId("compare-metric-ledger")).toBeVisible();

    // The automatically selected role is one *both* players are rated in.
    const body = await (await comparison).json();
    expect(body.role_key).not.toBeNull();
    for (const key of ["player_a", "player_b"] as const) {
      const rated = (body[key].role_ratings ?? []).map((r: { role_key: string }) => r.role_key);
      expect(rated, `${key} rated in ${body.role_key}`).toContain(body.role_key);
    }
    // so both sides show a stored RoleFit score and neither is labelled unrated
    for (const side of ["compare-side-left", "compare-side-right"]) {
      await expect(page.getByTestId(side).getByTestId("score-readout")).toBeVisible();
    }
    await expect(page.getByText("Not rated in this role")).toHaveCount(0);

    // Automatic-role copy describes the shared-role policy the API implements.
    await expect(
      page.getByText(/Chooses the shared rated role where both players have the strongest joint fit/),
    ).toBeVisible();
    await expect(page.getByText(/falling back to Player B/i)).toHaveCount(0);
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

  test("compare: neutral no-shared-role state when the players share no rated role", async ({ page }) => {
    // The sample cohort always shares a rated role, so reshape the real response
    // into the empty-intersection state the API returns for disjoint players.
    const explanation =
      "No shared rated role is available for these players. Select a role to inspect the available analysis.";
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route("**/api/compare*", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.role_key = null;
      json.role_display = null;
      json.role_comparison = {};
      json.why_higher = explanation;
      await route.fulfill({ response, json });
    });
    await page.goto("/compare");
    await page.getByTestId("compare-a").selectOption({ index: 1 });
    await page.getByTestId("compare-b").selectOption({ index: 2 });
    await expect(page.getByTestId("compare-table")).toBeVisible();

    // exact title-case heading; the explanatory prose stays sentence case
    await expect(page.getByTestId("compare-role")).toHaveText("No Shared Rated Role");
    await expect(page.getByTestId("compare-no-shared-role")).toBeVisible();
    await expect(page.getByTestId("why-higher")).toContainText(explanation);

    // nothing is fabricated: no score, no role confidence, no unrated blame
    await expect(page.getByTestId("score-readout")).toHaveCount(0);
    await expect(page.getByTestId("confidence-readout")).toHaveCount(0);
    await expect(page.getByText("Not rated in this role")).toHaveCount(0);

    // market, evidence context and the metric ledger stay usable
    await expect(page.getByTestId("compare-side-left").getByTestId("market-readout")).toBeVisible();
    await expect(page.getByTestId("compare-context-left")).toContainText("Minutes");
    await expect(page.getByTestId("compare-context-right")).toContainText("Minutes");
    await expect(page.getByTestId("compare-metric-ledger")).toBeVisible();

    // the user can still ask for an explicit role from the same selector
    const selector = page.getByTestId("compare-role-select");
    await expect(selector).toBeEnabled();
    await selector.selectOption("touchline_winger");
    await expect(selector).toHaveValue("touchline_winger");
    await expect(page.getByTestId("compare-table")).toBeVisible();

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await pageOverflow(page), `overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
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

  test("My Favorites: add from discovery, revisit, and remove", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page
      .getByTestId("result-row")
      .first()
      .getByRole("button", { name: /Add .* to My Favorites/i })
      .click();
    await expect(page.getByTestId("favorites-counter")).toContainText(
      "My Favorites 1 · saved on this device",
    );

    await page.goto("/shortlist");
    await expect(page.getByTestId("shortlist-record")).toHaveCount(1);
    await page.getByRole("button", { name: /Remove .* from My Favorites/i }).first().click();
    await expect(page.getByText(/No players saved yet/)).toBeVisible();
  });

  test("My Favorites desktop: full-width ledger rows, stable RoleFit track, equal Remove/Compare rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // Favourite a short-role and two long-role players straight from discovery.
    await page.goto("/?position_group=MID");
    await page.getByTestId("results-ledger").waitFor();
    for (const index of [0, 1, 2]) {
      await page.getByTestId("result-row").nth(index).getByTestId("favorite-action").click();
    }
    await expect(page.getByTestId("favorites-counter")).toContainText("My Favorites 3");

    await page.goto("/shortlist");
    await expect(page.getByRole("heading", { name: "Saved Players" })).toBeVisible();
    await expect(page.getByText("Saved decisions")).toHaveCount(0);
    await expect(page.getByTestId("shortlist-ledger")).toBeVisible();
    await expect(page.getByTestId("shortlist-record")).toHaveCount(3);

    const rows = await ledgerGeometry(
      page,
      "shortlist-record",
      "shortlist-player",
      "shortlist-ledger",
      "remove-action",
      "compare-action",
    );

    // one continuous single-column ledger, not the former two-column card grid
    for (const row of rows) {
      expect(row.rowFillsLedger, `${row.name} spans the ledger width`).toBe(true);
    }
    const rowXs = await page
      .getByTestId("shortlist-record")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
    expect(new Set(rowXs.map(Math.round)).size, "all rows share one column").toBe(1);

    // the RoleFit divider does not move when a role name wraps
    const heroXs = rows.map((r) => r.heroX);
    expect(Math.max(...heroXs) - Math.min(...heroXs)).toBeLessThanOrEqual(1);
    const heroWs = rows.map((r) => r.heroW);
    expect(Math.max(...heroWs) - Math.min(...heroWs)).toBeLessThanOrEqual(1);
    expect(rows.some((r) => r.captionLines > 1), "a long saved role wraps").toBe(true);
    for (const row of rows) {
      expect(row.captionOverflows, `${row.name} role is not clipped`).toBe(false);
      expect(Math.abs(row.heroCentreDelta), `${row.name} hero centred`).toBeLessThanOrEqual(6);
      expect(row.statusIncreasing, `${row.name} status order`).toBe(true);
      expect(row.statusSameLeft, `${row.name} status left edge`).toBe(true);
      // Remove tops the rail, Compare sits beneath it, at identical dimensions
      expect(Math.abs(row.actionA.w - row.actionB.w)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.actionA.h - row.actionB.h)).toBeLessThanOrEqual(1);
      expect(row.actionA.y).toBeLessThan(row.actionB.y);
      expect(row.railH).toBeGreaterThan(row.rowH * 0.7);
    }

    // exact visible copy, and no "vs"
    const first = page.getByTestId("shortlist-record").first();
    await expect(first.getByTestId("remove-action")).toHaveText("Remove");
    await expect(first.getByTestId("compare-action")).toHaveText("Compare");
    await expect(first.getByTestId("action-rail")).not.toContainText("vs");
    await expect(first.getByTestId("favorite-heart")).toHaveCount(0);

    // compare toggles without shifting the rail
    const compare = first.getByTestId("compare-action");
    const before = (await compare.boundingBox())!;
    await compare.click();
    await expect(compare).toHaveAttribute("aria-pressed", "true");
    const after = (await compare.boundingBox())!;
    expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1);
    await expect(compare).toHaveText("Compare");
  });

  test("My Favorites mobile: stacked status order and an equal-width Remove/Compare rail", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?position_group=MID");
    await page.getByTestId("results-ledger").waitFor();
    await page.getByTestId("result-row").first().getByTestId("favorite-action").click();
    await page.goto("/shortlist");
    await expect(page.getByTestId("shortlist-record")).toHaveCount(1);

    // 640px doubles as the 200%-zoom-equivalent reflow check on a 1280 desktop.
    for (const width of [640, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const [row] = await ledgerGeometry(
        page,
        "shortlist-record",
        "shortlist-player",
        "shortlist-ledger",
        "remove-action",
        "compare-action",
      );
      expect(row.statusIncreasing, `status order at ${width}px`).toBe(true);
      expect(row.statusSameLeft, `status left edge at ${width}px`).toBe(true);
      expect(row.railBelowStatus, `rail below the status stack at ${width}px`).toBe(true);
      // equal-width bottom halves, each at least a 44px target
      expect(Math.abs(row.actionA.w - row.actionB.w), `equal widths at ${width}px`).toBeLessThanOrEqual(1);
      expect(Math.abs(row.actionA.y - row.actionB.y), `same row at ${width}px`).toBeLessThanOrEqual(1);
      expect(row.actionA.x).toBeLessThan(row.actionB.x);
      expect(row.actionA.w).toBeGreaterThanOrEqual(row.railW / 2 - 3);
      expect(row.actionA.h, `44px target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(row.actionB.h, `44px target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(await pageOverflow(page), `overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
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
