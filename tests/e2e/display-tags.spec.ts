import { expect, test, type Page } from "@playwright/test";

// Cross-surface display-tag consistency. Every semantic tag renders through the
// shared primitive, so these assertions are on computed geometry and the
// `data-tag-variant` contract rather than screenshots.

const SURFACES = [
  { path: "/", ready: '[data-testid="results-ledger"]', name: "discovery", tagged: true },
  { path: "/shortlist", ready: '[data-testid="shortlist-ledger"]', name: "my favorites", tagged: true },
  { path: "/players/6", ready: '[data-testid="player-card"]', name: "dossier", tagged: true },
  { path: "/compare?a=6&b=4", ready: '[data-testid="compare-table"]', name: "comparison", tagged: true },
  {
    path: "/methodology",
    ready: '[data-testid="methodology-contents"]',
    name: "methodology",
    tagged: true,
  },
  // The leaderboard deliberately renders playstyles as comma-separated prose and
  // the asking range as a table cell, so it legitimately shows no display tags.
  { path: "/roles/inside_forward", ready: "h1", name: "leaderboard", tagged: false },
];

/** My Favorites is browser-local, so seed it before the saved-row surface. */
async function seedFavorites(page: Page) {
  await page.goto("/");
  await page.getByTestId("results-ledger").waitFor();
  for (const index of [0, 1]) {
    await page.getByTestId("result-row").nth(index).getByTestId("favorite-action").click();
  }
}

type TagInfo = {
  variant: string;
  text: string;
  radius: string;
  display: string;
  bg: string;
  color: string;
  borderWidth: string;
  fontWeight: string;
  wordBreak: string;
  overflowWrap: string;
  clipped: boolean;
};

async function tagsOn(page: Page): Promise<TagInfo[]> {
  return page.$$eval("[data-tag-variant]", (els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return {
        variant: el.getAttribute("data-tag-variant") ?? "",
        text: (el.textContent ?? "").trim(),
        radius: s.borderTopLeftRadius,
        display: s.display,
        bg: s.backgroundColor,
        color: s.color,
        borderWidth: s.borderTopWidth,
        fontWeight: s.fontWeight,
        wordBreak: s.wordBreak,
        overflowWrap: s.overflowWrap,
        clipped: el.scrollWidth > el.clientWidth + 1,
      };
    }),
  );
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("Semantic display tags", () => {
  test("every tag on every surface shares the sharp base geometry", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedFavorites(page);
    let total = 0;
    for (const { path, ready, name, tagged } of SURFACES) {
      await page.goto(path);
      await page.locator(ready).first().waitFor();
      const tags = await tagsOn(page);
      if (tagged) expect(tags.length, `${name} renders semantic tags`).toBeGreaterThan(0);
      total += tags.length;
      for (const tag of tags) {
        expect(tag.radius, `${name} "${tag.text}" is square, not a capsule`).toBe("0px");
        // `inline-flex` is blockified to `flex` when the tag is itself a flex
        // item (CSS display blockification) — both mean the same declaration.
        expect(
          ["inline-flex", "flex"],
          `${name} "${tag.text}" is a flex tag box`,
        ).toContain(tag.display);
        expect(tag.borderWidth, `${name} "${tag.text}" has a border`).toBe("1px");
        expect(Number(tag.fontWeight), `${name} "${tag.text}" weight`).toBeGreaterThanOrEqual(600);
        // labels wrap as whole words, never mid-word
        expect(tag.wordBreak, `${name} "${tag.text}" word-break`).toBe("normal");
        expect(tag.overflowWrap, `${name} "${tag.text}" overflow-wrap`).toBe("normal");
        expect(tag.clipped, `${name} "${tag.text}" is not clipped`).toBe(false);
      }
    }
    expect(total, "tags found across the product").toBeGreaterThan(20);
  });

  test("no capsule-shaped semantic tag survives anywhere", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedFavorites(page);
    for (const { path, ready, name } of SURFACES) {
      await page.goto(path);
      await page.locator(ready).first().waitFor();
      const capsules = await page.$$eval("[data-tag-variant]", (els) =>
        els
          .filter((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) > 4)
          .map((el) => el.textContent?.trim() ?? ""),
      );
      expect(capsules, `${name} has no capsule tags`).toEqual([]);
    }
  });

  test("playstyles are dark-filled with light text on every surface that shows them", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedFavorites(page);
    const seen: string[] = [];
    for (const { path, ready, name } of SURFACES) {
      await page.goto(path);
      await page.locator(ready).first().waitFor();
      const playstyles = (await tagsOn(page)).filter((t) => t.variant === "playstyle");
      if (playstyles.length === 0) continue;
      seen.push(name);
      for (const tag of playstyles) {
        // near-black fill, paper text — identical treatment everywhere
        expect(tag.bg, `${name} "${tag.text}" ink fill`).toBe("rgb(24, 34, 25)");
        expect(tag.color, `${name} "${tag.text}" paper text`).toBe("rgb(244, 242, 234)");
      }
    }
    // discovery, favourites, dossier, comparison and methodology all show them
    expect(seen.length, `playstyle surfaces: ${seen.join(", ")}`).toBeGreaterThanOrEqual(4);
  });

  test("concerns keep warning styling and never look like playstyles", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/players/6");
    await page.getByTestId("player-card").waitFor();
    const concerns = page.locator('[data-testid="concerns"] [data-tag-variant="concern"]');
    const count = await concerns.count();
    expect(count, "the dossier shows at least one concern").toBeGreaterThan(0);
    const styles = await concerns.evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el);
        return { text: el.textContent?.trim(), bg: s.backgroundColor, color: s.color };
      }),
    );
    for (const s of styles) {
      expect(s.color, `${s.text} reads as a warning`).toBe("rgb(156, 46, 34)");
      expect(s.bg, `${s.text} is not ink-filled`).not.toBe("rgb(24, 34, 25)");
    }
    // "Inflated Market" is a concern, not the amber market valuation label
    const inflatedMarket = page.getByText("Inflated Market", { exact: true });
    await expect(inflatedMarket).toHaveAttribute("data-tag-variant", "concern");
  });

  test("market states keep their distinct amber and red meanings", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/compare?a=6&b=4");
    await page.getByTestId("compare-table").waitFor();
    const markets = await page.$$eval('[data-tag-variant="market"]', (els) =>
      els.map((el) => ({ text: el.textContent?.trim(), color: getComputedStyle(el).color })),
    );
    const inflated = markets.find((m) => m.text === "Inflated");
    const highRisk = markets.find((m) => m.text === "High-Risk");
    expect(inflated, "an Inflated market tag is present").toBeTruthy();
    expect(highRisk, "a High-Risk market tag is present").toBeTruthy();
    expect(inflated!.color, "Inflated stays amber").toBe("rgb(154, 90, 11)");
    expect(highRisk!.color, "High-Risk stays red").toBe("rgb(156, 46, 34)");
    expect(inflated!.color).not.toBe(highRisk!.color);
  });

  test("compare market readouts mirror each other around the central rule", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/compare?a=6&b=4");
    await page.getByTestId("compare-table").waitFor();

    const geometry = async (side: "left" | "right") =>
      page.getByTestId(`compare-side-${side}`).getByTestId("market-readout").evaluate((el) => {
        const readout = el.getBoundingClientRect();
        const tag = el.querySelector("[data-tag-variant]")!.getBoundingClientRect();
        const range = el.querySelector(".mono")!.getBoundingClientRect();
        return {
          align: (el as HTMLElement).dataset.marketAlign,
          tagLeft: tag.left - readout.left,
          rangeLeft: range.left - readout.left,
          // one line: both children share a row and the box is a single line tall
          sameRow: Math.abs(tag.top - range.top) <= 6,
          lines: Math.round(readout.height / tag.height),
          text: (el.textContent ?? "").trim(),
        };
      });

    const left = await geometry("left");
    const right = await geometry("right");

    // left column reads tag → range; right column reads range → tag
    expect(left.align).toBe("start");
    expect(left.tagLeft, "left: tag is at the outer (left) edge").toBeLessThan(left.rangeLeft);
    expect(right.align).toBe("end");
    expect(right.rangeLeft, "right: range reads inward, tag hugs the right edge").toBeLessThan(
      right.tagLeft,
    );

    // neither side wraps, whatever the figures
    for (const [name, side] of [["left", left], ["right", right]] as const) {
      expect(side.sameRow, `${name} keeps label and range on one line`).toBe(true);
      expect(side.lines, `${name} is a single line tall`).toBe(1);
    }

    // and the mirrored side still reads the same two facts (figures are
    // fixture-dependent, so assert the shape rather than exact values)
    expect(right.text).toMatch(/^(Undervalued|Fair|Inflated|High-Risk|Unknown)/);
    expect(right.text).toMatch(/€[\d.]+[MK] – €[\d.]+[MK]|From €|Up to €|Unknown$/);
  });

  test("Best and Best-Rated Role stay positive green role statuses", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/players/6");
    await page.getByTestId("player-card").waitFor();

    const bestRated = page.getByText("Best-Rated Role", { exact: true });
    await expect(bestRated).toHaveAttribute("data-tag-variant", "role-status");
    const desk = await bestRated.evaluate((el) => {
      const s = getComputedStyle(el);
      return { radius: s.borderTopLeftRadius, color: s.color };
    });
    expect(desk.radius, "Best-Rated Role uses the new geometry").toBe("0px");
    expect(desk.color, "Best-Rated Role stays positive green").toBe("rgb(19, 64, 43)");

    const best = page.getByText("Best", { exact: true }).first();
    await expect(best).toHaveAttribute("data-tag-variant", "role-status");
    expect(await best.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("0px");
  });

  test("confidence and evidence remain visually separate facts", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/players/6");
    await page.getByTestId("player-card").waitFor();
    const confidence = page.locator('[data-tag-variant="confidence"]').first();
    await expect(confidence).toBeVisible();
    // the monochrome confidence meter bars are untouched by the tag system
    const meter = page.getByTestId("confidence-meter").first();
    await expect(meter).toBeVisible();
    await expect(meter).not.toHaveAttribute("data-tag-variant");
  });

  test("interactive controls were not converted into display tags", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    // filters, age bands, nav links and rail actions stay controls
    const taggedControls = await page.$$eval(
      "button[data-tag-variant], a[data-tag-variant], [role='tab'][data-tag-variant]",
      (els) => els.map((el) => el.textContent?.trim() ?? ""),
    );
    expect(taggedControls, "no control carries a tag variant").toEqual([]);

    await page.goto("/players/6");
    await page.getByTestId("player-card").waitFor();
    const tabs = await page
      .getByTestId("role-selector")
      .getByRole("tab")
      .evaluateAll((els) =>
        els.map((el) => ({
          tagged: el.hasAttribute("data-tag-variant"),
          radius: getComputedStyle(el).borderTopLeftRadius,
        })),
      );
    expect(tabs.length).toBeGreaterThan(1);
    for (const tab of tabs) expect(tab.tagged, "role tabs are controls").toBe(false);
  });

  test("tags stay readable with no page overflow at 390px, 320px and 200% zoom", async ({
    page,
  }) => {
    // 640 is the 200%-zoom equivalent of a 1280 desktop.
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedFavorites(page);
    for (const width of [640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const { path, ready, name } of SURFACES) {
        await page.goto(path);
        await page.locator(ready).first().waitFor();
        expect(await pageOverflow(page), `${name} overflow at ${width}px`).toBeLessThanOrEqual(1);
        for (const tag of await tagsOn(page)) {
          expect(tag.clipped, `${name} "${tag.text}" clipped at ${width}px`).toBe(false);
          expect(tag.radius, `${name} "${tag.text}" square at ${width}px`).toBe("0px");
        }
      }
    }
  });

  test("discovery and My Favorites keep their approved ledger presentation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();

    const row = page.getByTestId("result-row").first();
    // compound coverage/confidence + market boxes, dark playstyles, three lines
    await expect(row.getByTestId("card-status")).toHaveAttribute("data-tag-variant", "evidence");
    await expect(row.getByTestId("market-readout")).toHaveAttribute("data-tag-variant", "market");
    const stack = await row
      .getByTestId("row-status-stack")
      .evaluate((el) => [...el.children].map((c) => c.getAttribute("data-testid")));
    expect(stack).toEqual([
      "status-line-coverage",
      "status-line-market",
      "status-line-playstyles",
    ]);
    const compound = await row
      .getByTestId("card-status")
      .evaluate((el) => getComputedStyle(el).paddingTop);
    expect(compound, "compound padding preserved").toBe("4px");

    // the action rail is unchanged and untagged
    const fav = await row.getByTestId("favorite-action").boundingBox();
    const cmp = await row.getByTestId("compare-action").boundingBox();
    expect(Math.abs(fav!.width - cmp!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(fav!.height - cmp!.height)).toBeLessThanOrEqual(1);
  });
});
