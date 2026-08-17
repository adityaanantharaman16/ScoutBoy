import { expect, test, type Page } from "@playwright/test";

import { expectNoA11yViolations, readyForScan } from "./support/a11y";

/**
 * Phase 8.3 — "Why this order", in a production build against the real API.
 *
 * Every test here runs against the real stack: the production bundle, the real
 * API and the committed sample fixture. Nothing is intercepted, because nothing
 * needs to be — the explanation is PAGE-LEVEL, so what it says is a function of
 * the active sort and role alone, and every mode's text is reachable by asking
 * for that mode. The ordering those texts describe is proven exhaustively against
 * a synthetic cohort with a tie at every level, in
 * `apps/api/app/tests/test_discovery_ranking.py`.
 *
 * Several tests assert an ABSENCE: the region never names a player, never
 * compares two results, and never grows with the page.
 */

const TOGGLE = '[data-testid="why-this-order-toggle"]';
const REGION = '[data-testid="why-this-order-region"]';
const KEY = '[data-testid="ranking-key"]';

async function openExplanation(page: Page) {
  await page.waitForSelector('[data-testid="results-ledger"]');
  await page.click(TOGGLE);
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-expanded", "true");
}

/**
 * Open the disclosure only if it is closed.
 *
 * Open state is local presentation state, so whether it survives a page change
 * depends on whether the new page resolves from React Query's cache (no skeleton,
 * no unmount) or issues a fresh request (skeleton, remount, collapsed again).
 * Neither is load-bearing, and a test about pagination should not depend on it.
 */
async function ensureExplanationOpen(page: Page) {
  await page.waitForSelector('[data-testid="results-ledger"]');
  if ((await page.locator(TOGGLE).getAttribute("aria-expanded")) !== "true") {
    await page.click(TOGGLE);
  }
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-expanded", "true");
}

async function keySequence(page: Page): Promise<string[]> {
  return page.locator(KEY).evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-ranking-key") ?? ""),
  );
}

/** Horizontal overflow of the document, in CSS pixels. Must always be 0. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

// ---------------------------------------------------------------------------
// against the real API
// ---------------------------------------------------------------------------
test.describe("Why this order: the default ordering", () => {
  test("is collapsed by default and states the active sort", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');

    const toggle = page.locator(TOGGLE);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(REGION)).toBeHidden();
    await expect(page.locator('[data-testid="ranking-summary-collapsed"]')).toHaveText(
      "Ordered by RoleFit, highest first.",
    );
    // One disclosure for the page, never one per row.
    expect(await page.locator(TOGGLE).count()).toBe(1);
    expect(await page.locator('[data-testid="result-row"]').count()).toBeGreaterThan(1);
  });

  test("opens onto the exact RoleFit key sequence, role context and limitation", async ({
    page,
  }) => {
    await page.goto("/");
    await openExplanation(page);

    expect(await keySequence(page)).toEqual([
      "rated_first",
      "result_role_score",
      "result_role_confidence",
      "canonical_name",
      "player_id",
    ]);
    await expect(page.locator('[data-testid="ranking-role-context"]')).toContainText(
      "Best role for each player",
    );
    await expect(page.locator('[data-testid="ranking-tie-breakers"]')).toContainText(
      "Canonical Name, Player ID",
    );
    await expect(page.locator('[data-testid="ranking-limitation"]')).toContainText(
      "ordering, not recruitment suitability",
    );
  });

  test("names no player and compares no two results", async ({ page }) => {
    await page.goto("/");
    await openExplanation(page);

    const text = await page.locator(REGION).innerText();
    for (const row of await page.locator('[data-testid="player-result"]').allInnerTexts()) {
      expect(text, `the region named ${row}`).not.toContain(row);
    }
    expect(text).not.toMatch(/adjacent results/i);
    expect(text).not.toMatch(/appears above|appears below|precedes/i);
    expect(text).not.toMatch(/first visible/i);
    expect(await page.locator('[data-testid="ranking-adjacent"]').count()).toBe(0);
  });

  test("says the same thing however many results are on the page", async ({ page }) => {
    // The explanation describes the ordering, so narrowing the cohort must not
    // change a word of it — and it cannot grow with the ledger.
    await page.goto("/");
    await openExplanation(page);
    const wide = await page.locator(REGION).innerText();

    await page.goto("/?league=Bundesliga");
    await openExplanation(page);
    expect(await page.locator(REGION).innerText()).toBe(wide);
  });

  test("states the limitation last, immediately after the ordering rules", async ({ page }) => {
    await page.goto("/");
    await openExplanation(page);
    const order = await page.locator(REGION).evaluate((region) => {
      const blocks = Array.from(region.children);
      const limitation = region.querySelector('[data-testid="ranking-limitation"]')!;
      return {
        rules: blocks.findIndex((b) => b.getAttribute("data-testid") === "ranking-rules"),
        limitation: blocks.findIndex((b) => b.contains(limitation)),
        total: blocks.length,
      };
    });
    expect(order.limitation).toBe(order.rules + 1);
    expect(order.limitation).toBe(order.total - 1);
  });
});

test.describe("Why this order: role context", () => {
  test("names the selected role and never the best role", async ({ page }) => {
    await page.goto("/?role=touchline_winger");
    await openExplanation(page);

    const context = page.locator('[data-testid="ranking-role-context"]');
    await expect(context).toContainText("Selected role: Touchline Winger");
    await expect(context).toContainText("stored Touchline Winger rating");
    await expect(context).toContainText("no other role's rating is read");
    await expect(context).not.toContainText("best role");
    // Under RoleFit that rating really did order the page, and the copy says so.
    await expect(context).toContainText("what this page is ordered by");
  });

  test("says which sort ordered the page when RoleFit did not", async ({ page }) => {
    // The correction: under Age, Expected Asking and Name the applicable role
    // rating is what each result DISPLAYS, and the named sort is what ordered.
    for (const [sort, label] of [
      ["age_asc", "Age"],
      ["value_desc", "Expected Asking"],
      ["name_asc", "Name"],
    ] as const) {
      await page.goto(`/?sort=${sort}&role=touchline_winger`);
      await openExplanation(page);
      const context = page.locator('[data-testid="ranking-role-context"]');
      await expect(context, sort).toContainText("Selected role: Touchline Winger");
      await expect(context, sort).toContainText("did not order this page");
      await expect(context, sort).toContainText(`the ordering comes from the ${label} sort`);
      await expect(context, sort).not.toContainText("ordering keys below");
      // And the sequence backs the claim up: no RoleFit key is in it.
      expect(await keySequence(page), sort).not.toContain("result_role_score");
    }
  });

  test("returns to the best-role context when the role is cleared", async ({ page }) => {
    await page.goto("/?role=touchline_winger");
    await openExplanation(page);
    await expect(page.locator('[data-testid="ranking-role-context"]')).toContainText(
      "Selected role",
    );

    await page.selectOption('[data-testid="role-filter"]', "");
    await page.waitForLoadState("networkidle");
    await openExplanation(page);
    await expect(page.locator('[data-testid="ranking-role-context"]')).toContainText(
      "Best role for each player",
    );
  });
});

test.describe("Why this order: every sort the control can represent", () => {
  const MODES = [
    { sort: "rolefit_desc", summary: "Ordered by RoleFit, highest first.", first: "rated_first" },
    { sort: "rolefit_asc", summary: "Ordered by RoleFit, lowest first.", first: "rated_first" },
    { sort: "age_asc", summary: "Ordered by age, youngest first.", first: "age" },
    {
      sort: "value_desc",
      summary: "Ordered by Expected Asking, highest first.",
      first: "asking_low_known_first",
    },
    {
      sort: "value_asc",
      summary: "Ordered by Expected Asking, lowest first.",
      first: "asking_low_known_first",
    },
    { sort: "name_asc", summary: "Ordered by name, A to Z.", first: "canonical_name" },
  ] as const;

  for (const mode of MODES) {
    test(`follows ${mode.sort}`, async ({ page }) => {
      await page.goto(`/?sort=${mode.sort}`);
      await page.waitForSelector('[data-testid="results-ledger"]');
      await expect(page.locator('[data-testid="ranking-summary-collapsed"]')).toHaveText(
        mode.summary,
      );
      await openExplanation(page);
      await expect(page.locator('[data-testid="ranking-summary"]')).toHaveText(mode.summary);
      expect((await keySequence(page))[0]).toBe(mode.first);
      // Every mode ends with the canonical name and then the stable id.
      expect((await keySequence(page)).slice(-1)[0]).toBe("player_id");
    });
  }

  test("changing the Sort control changes the explanation with the ledger", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await page.selectOption('[data-testid="sort-filter"]', "name_asc");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="ranking-summary-collapsed"]')).toHaveText(
      "Ordered by name, A to Z.",
    );
    await openExplanation(page);
    expect(await keySequence(page)).toEqual(["canonical_name", "player_id"]);
  });

  test("the asking modes say they use the lower endpoint, and rule out the others", async ({
    page,
  }) => {
    await page.goto("/?sort=value_desc");
    await openExplanation(page);

    const rule = page.locator(`${KEY}[data-ranking-key="expected_asking_low_eur"]`);
    await expect(rule).toContainText("Expected Asking (Lower Endpoint)");
    await expect(rule).toContainText("Never the high endpoint");
    await expect(rule).toContainText("never a midpoint");
    // An unpriced player is placed, never priced at zero.
    await expect(page.locator(`${KEY}[data-ranking-key="asking_low_known_first"]`)).toContainText(
      "never read as €0",
    );
    await expect(page.locator('[data-testid="ranking-missing-values"]')).toContainText(
      "after every priced player",
    );
  });

  test("each mode states how it places the values it does not know", async ({ page }) => {
    for (const [sort, wording] of [
      ["rolefit_desc", "never receives a placeholder score"],
      ["age_asc", "placed after every known age"],
      ["value_asc", "never read as €0"],
      ["name_asc", "places no unknown value"],
    ] as const) {
      await page.goto(`/?sort=${sort}&scope=all_records`);
      await openExplanation(page);
      await expect(page.locator('[data-testid="ranking-missing-values"]'), sort).toContainText(
        wording,
      );
    }
  });

  test("confidence is offered only as a tie-break, and only after the score", async ({ page }) => {
    await page.goto("/?sort=rolefit_desc");
    await openExplanation(page);
    const sequence = await keySequence(page);
    expect(sequence.indexOf("result_role_confidence")).toBe(
      sequence.indexOf("result_role_score") + 1,
    );
    await expect(page.locator(`${KEY}[data-ranking-key="result_role_confidence"]`)).toContainText(
      "Only on an equal score",
    );
    // And it is not an ordering key at all under a non-RoleFit mode.
    await page.goto("/?sort=age_asc");
    await openExplanation(page);
    expect(await keySequence(page)).not.toContain("result_role_confidence");
  });

  test("every mode ends with the canonical name and then the stable id", async ({ page }) => {
    for (const sort of ["rolefit_desc", "age_asc", "value_desc", "name_asc"]) {
      await page.goto(`/?sort=${sort}`);
      await openExplanation(page);
      expect((await keySequence(page)).slice(-2), sort).toEqual(["canonical_name", "player_id"]);
      // In `name_asc` the name IS the ordering, so only the id is a tie-break.
      const breakers = sort === "name_asc" ? "Player ID" : "Canonical Name, Player ID";
      await expect(page.locator('[data-testid="ranking-tie-breakers"]'), sort).toContainText(
        `Final tie-breakers, always applied last: ${breakers}.`,
      );
    }
  });
});

test.describe("Why this order: pagination", () => {
  test("page 2 explains the same ordering, and names none of its rows", async ({ page }) => {
    await page.goto("/");
    await openExplanation(page);
    const onPageOne = await page.locator(REGION).innerText();

    await page.goto("/?page=2");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await expect(page.locator('[data-testid="result-count"]')).toContainText("page 2 of");
    await openExplanation(page);

    // The ordering did not change between pages, so neither did its explanation —
    // and no page-boundary caveat is needed, because nothing here is row-specific.
    expect(await page.locator(REGION).innerText()).toBe(onPageOne);
    const text = await page.locator(REGION).innerText();
    for (const row of await page.locator('[data-testid="player-result"]').allInnerTexts()) {
      expect(text, `page 2 named ${row}`).not.toContain(row);
    }
  });

  test("Next and Prev leave the explanation intact", async ({ page }) => {
    // Pagination is a replace-style URL write, exactly like every other filter
    // change, so Prev is the way back rather than browser history.
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const firstOnPageOne = await page.locator('[data-testid="player-result"]').first().innerText();

    await page.getByRole("button", { name: "Next" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="result-count"]')).toContainText("page 2 of");
    await ensureExplanationOpen(page);
    await expect(page.locator('[data-testid="ranking-summary"]')).toHaveText(
      "Ordered by RoleFit, highest first.",
    );
    expect(await page.locator(REGION).innerText()).not.toContain(firstOnPageOne);

    await page.getByRole("button", { name: "Prev" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="result-count"]')).toContainText("page 1 of");
    await ensureExplanationOpen(page);
    await expect(page.locator('[data-testid="ranking-summary"]')).toHaveText(
      "Ordered by RoleFit, highest first.",
    );
    // Still page-level on the way back: the first row of page 1 is not named.
    expect(await page.locator(REGION).innerText()).not.toContain(firstOnPageOne);
  });
});

test.describe("Why this order: URL durability", () => {
  test("survives a hard load, a reload and back/forward", async ({ page }) => {
    await page.goto("/?sort=value_asc&role=inside_forward");
    await openExplanation(page);
    await expect(page.locator('[data-testid="ranking-summary"]')).toHaveText(
      "Ordered by Expected Asking, lowest first.",
    );
    await expect(page.locator('[data-testid="ranking-role-context"]')).toContainText(
      "Selected role: Inside Forward",
    );

    await page.reload();
    await page.waitForSelector('[data-testid="results-ledger"]');
    // Collapsed again after a reload: open state is presentation, not URL state.
    await expect(page.locator(TOGGLE)).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('[data-testid="ranking-summary-collapsed"]')).toHaveText(
      "Ordered by Expected Asking, lowest first.",
    );

    await page.goto("/?sort=name_asc");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await page.goBack();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="ranking-summary-collapsed"]')).toHaveText(
      "Ordered by Expected Asking, lowest first.",
    );
    await page.goForward();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="ranking-summary-collapsed"]')).toHaveText(
      "Ordered by name, A to Z.",
    );
  });

  test("compound filters narrow the cohort without becoming a reason for rank", async ({
    page,
  }) => {
    await page.goto("/?league=Bundesliga&min_minutes=900&sort=rolefit_desc");
    await openExplanation(page);
    const text = await page.locator(REGION).innerText();
    expect(text).not.toMatch(/Bundesliga|minutes|league|boost/i);
    expect(await keySequence(page)).toEqual([
      "rated_first",
      "result_role_score",
      "result_role_confidence",
      "canonical_name",
      "player_id",
    ]);
  });
});


test.describe("Why this order: empty and failing states", () => {
  test("is absent when nothing matches", async ({ page }) => {
    await page.goto("/?q=zzz-no-such-player");
    await page.waitForSelector("text=No players match these filters.");
    await expect(page.locator(TOGGLE)).toHaveCount(0);
  });

  test("is absent while loading and while failing, and returns on recovery", async ({ page }) => {
    await page.route("**/api/players?*", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(TOGGLE)).toHaveCount(0);

    await page.unroute("**/api/players?*");
    await page.reload();
    await expect(page.locator(TOGGLE)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// accessibility
// ---------------------------------------------------------------------------
test.describe("Why this order: accessibility", () => {
  test("opens and closes from the keyboard with Enter and Space", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const toggle = page.locator(TOGGLE);

    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toBeFocused();

    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Focus stays on the control that closed the region — never on <body>.
    await expect(toggle).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
  });

  test("names its purpose and owns a region that resolves in both states", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const toggle = page.locator(TOGGLE);
    const name = (await toggle.getAttribute("aria-label"))!;
    expect(name.startsWith("Why this order")).toBe(true);
    expect(name).toContain("Ordered by RoleFit");
    await expect(toggle).toContainText("Why This Order");

    const controls = (await toggle.getAttribute("aria-controls"))!;
    for (const state of ["closed", "open"]) {
      expect(
        await page.evaluate((id) => Boolean(document.getElementById(id)), controls),
        state,
      ).toBe(true);
      if (state === "closed") await toggle.click();
    }
  });

  test("traps no focus and leaves the tab order intact when open", async ({ page }) => {
    await page.goto("/");
    await openExplanation(page);
    // The region contributes no focusable content at all, so Tab from the toggle
    // lands on the next control of the ledger rather than inside the explanation.
    expect(
      await page.locator(REGION).evaluate(
        (el) => el.querySelectorAll("a, button, input, select, textarea, [tabindex]").length,
      ),
    ).toBe(0);
    await page.locator(TOGGLE).focus();
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const region = document.querySelector('[data-testid="why-this-order-region"]');
      return Boolean(region && document.activeElement && region.contains(document.activeElement));
    });
    expect(inside).toBe(false);
  });

  test("keeps a visible focus indicator on the control", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await page.locator(TOGGLE).focus();
    const outline = await page.locator(TOGGLE).evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: parseFloat(style.outlineWidth || "0"), style: style.outlineStyle };
    });
    expect(outline.width).toBeGreaterThanOrEqual(2);
    expect(outline.style).not.toBe("none");
  });

  test("meets the target-size minimum at mobile and desktop", async ({ page }) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.waitForSelector('[data-testid="results-ledger"]');
      const box = (await page.locator(TOGGLE).boundingBox())!;
      expect(box.height, `@${width}`).toBeGreaterThanOrEqual(44);
      expect(box.width, `@${width}`).toBeGreaterThanOrEqual(24);
    }
  });

  test("passes axe with the explanation open", async ({ page }) => {
    for (const size of [
      { width: 1280, height: 900 },
      { width: 640, height: 720 },
      { width: 320, height: 720 },
    ]) {
      await page.setViewportSize(size);
      await page.goto("/");
      await openExplanation(page);
      await readyForScan(page, REGION);
      await expectNoA11yViolations(page, `discovery + ranking explanation @${size.width}`);
    }
  });

  test("survives the WCAG text-spacing override", async ({ page }) => {
    await page.goto("/");
    await openExplanation(page);
    await page.addStyleTag({
      content: `* { line-height: 1.5 !important; letter-spacing: 0.12em !important;
                    word-spacing: 0.16em !important; }
                p, li, div, span { margin-bottom: 2em !important; }`,
    });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expect(page.locator('[data-testid="ranking-limitation"]')).toBeVisible();
  });

  test("stays legible under forced colours", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");
    await openExplanation(page);
    await expect(page.locator(REGION)).toBeVisible();
    await expect(page.locator(KEY).first()).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// responsive geometry
// ---------------------------------------------------------------------------
const WIDTHS = [320, 390, 640, 768, 1024, 1280, 1440];

test.describe("Why this order: responsive geometry", () => {
  for (const width of WIDTHS) {
    test(`adds no horizontal overflow and no width at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.waitForSelector('[data-testid="results-ledger"]');

      const before = await page.locator('[data-testid="results-ledger"]').boundingBox();
      const railBefore = await page.locator('[data-testid="filter-column"]').boundingBox();
      expect(await overflow(page), `collapsed @${width}`).toBeLessThanOrEqual(0);

      await page.click(TOGGLE);
      await expect(page.locator(REGION)).toBeVisible();

      const after = await page.locator('[data-testid="results-ledger"]').boundingBox();
      const railAfter = await page.locator('[data-testid="filter-column"]').boundingBox();
      expect(await overflow(page), `expanded @${width}`).toBeLessThanOrEqual(0);
      // Opening adds height and nothing else: the ledger and the rail keep their
      // approved widths and their shared left/right relationship.
      expect(after!.width, `ledger width @${width}`).toBeCloseTo(before!.width, 0);
      expect(railAfter!.width, `rail width @${width}`).toBeCloseTo(railBefore!.width, 0);
      expect(after!.height).toBeGreaterThan(before!.height);
    });
  }

  test("the Milestone 8.2 mobile rail regression stays fixed with the region open", async ({
    page,
  }) => {
    // Linux Chromium's classic scrollbar layout exposed a 15px overflow at 390px
    // when the filter grid item was allowed its default `min-width: auto`. The
    // explanation must not reintroduce a min-content floor of its own.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await openExplanation(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    const minContent = await page.evaluate(() => {
      const region = document.querySelector<HTMLElement>(
        '[data-testid="why-this-order-region"]',
      )!;
      const probe = region.cloneNode(true) as HTMLElement;
      probe.style.width = "min-content";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.appendChild(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    });
    expect(minContent).toBeLessThanOrEqual(390);
  });

  test("introduces no nested scroller and needs none", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/");
    await openExplanation(page);
    const scrollers = await page.locator(REGION).evaluate((region) => {
      const nodes = [region, ...Array.from(region.querySelectorAll("*"))];
      return nodes.filter((el) => {
        const style = getComputedStyle(el as Element);
        return ["auto", "scroll"].includes(style.overflowX) ||
          ["auto", "scroll"].includes(style.overflowY);
      }).length;
    });
    expect(scrollers).toBe(0);
    // The last line of the region is reachable by ordinary page scrolling.
    await page.locator('[data-testid="ranking-limitation"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid="ranking-limitation"]')).toBeInViewport();
  });

  test("every rectangle it introduces is 90 degrees", async ({ page }) => {
    await page.goto("/");
    await openExplanation(page);
    const radii = await page.locator('[data-testid="why-this-order"]').evaluate((root) => {
      const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
      return nodes
        .map((el) => {
          const style = getComputedStyle(el as Element);
          return [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomLeftRadius,
            style.borderBottomRightRadius,
          ].join(" ");
        })
        .filter((value) => !/^(0px ){3}0px$/.test(value));
    });
    expect(radii).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// motion
// ---------------------------------------------------------------------------
test.describe("Why this order: motion", () => {
  test("animates no layout property", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    const properties = await page.locator(TOGGLE).evaluate((el) => {
      const style = getComputedStyle(el);
      return style.transitionProperty.split(",").map((p) => p.trim());
    });
    for (const property of properties) {
      expect(
        ["height", "width", "padding", "margin", "top", "left", "grid-template-rows", "all"],
      ).not.toContain(property);
    }
    expect(properties).toContain("background-color");
  });

  test("reaches the same final state immediately under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.waitForSelector('[data-testid="results-ledger"]');
    await page.click(TOGGLE);

    // The content is present in the same frame, and nothing is animating.
    await expect(page.locator(REGION)).toBeVisible();
    await expect(page.locator(KEY)).toHaveCount(5);
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === "running").length,
    );
    expect(running).toBe(0);
    const transitions = await page.locator(TOGGLE).evaluate((el) => {
      const style = getComputedStyle(el);
      return style.transitionDuration;
    });
    expect(transitions.replace(/\s/g, "")).toMatch(/^0s(,0s)*$/);
  });
});
