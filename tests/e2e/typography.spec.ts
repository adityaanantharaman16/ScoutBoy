import { expect, test, type Page } from "@playwright/test";

// Typography contract: one self-hosted proportional family (Inter Variable) across
// every surface, the mono stack only where the product is deliberately tabular, no
// serif stack anywhere, and no external font request at runtime. Assertions are on
// computed styles and geometry rather than screenshots so they stay deterministic.

const SERIF_FACES = [
  "Iowan Old Style",
  "Palatino Linotype",
  "Palatino",
  "Georgia",
  "Times New Roman",
];

async function computedFont(page: Page, testId: string): Promise<string> {
  return page
    .getByTestId(testId)
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
}

/** Resolved family of the first element matching a raw selector. */
async function computedFontFor(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
}

function expectInter(family: string, what: string) {
  expect(family, `${what} resolves to Inter`).toContain("InterVariable");
  for (const serif of SERIF_FACES) {
    expect(family, `${what} has no ${serif} fallback`).not.toContain(serif);
  }
}

test.describe("Unified Inter typography", () => {
  test("the variable font is self-hosted, swap-displayed, and fetched from our own origin", async ({
    page,
  }) => {
    const fontRequests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") fontRequests.push(request.url());
    });

    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    await page.evaluate(() => document.fonts.ready);

    // the face actually loaded and is usable
    expect(
      await page.evaluate(() => document.fonts.check('700 32px InterVariable')),
      "InterVariable is available to the renderer",
    ).toBe(true);

    // every font byte comes from this origin — no Google Fonts, no CDN
    expect(fontRequests.length, "at least one self-hosted font was fetched").toBeGreaterThan(0);
    const origin = new URL(page.url()).origin;
    for (const url of fontRequests) {
      expect(url, "font is served from the app origin").toContain(origin);
      expect(url).not.toMatch(/fonts\.(googleapis|gstatic)\.com|use\.typekit|cdn\./);
    }

    // and the @font-face rules declare swap
    const descriptors = await page.evaluate(() =>
      [...document.fonts].map((f) => `${f.family}|${f.display}`),
    );
    const inter = descriptors.filter((d) => d.startsWith("InterVariable"));
    expect(inter.length, "InterVariable @font-face rules are present").toBeGreaterThan(0);
    for (const descriptor of inter) {
      expect(descriptor, "font-display: swap").toContain("|swap");
    }
  });

  test("discovery resolves Inter for the brand, page heading, player name and RoleFit score", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    await page.evaluate(() => document.fonts.ready);

    expectInter(await computedFontFor(page, "body"), "body");
    expectInter(await computedFontFor(page, 'nav a[href="/"]'), "navigation brand");
    expectInter(await computedFontFor(page, "h1"), "page heading");
    expectInter(await computedFont(page, "player-result"), "player name");

    const row = page.getByTestId("result-row").first();
    const score = row.getByTestId("score-readout").locator("div").first();
    expectInter(await score.evaluate((el) => getComputedStyle(el).fontFamily), "RoleFit score");

    // hierarchy survives the face swap: the score is still the largest thing in
    // the row and the eyebrow keeps its uppercase tracked treatment
    const scoreSize = await score.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const nameSize = await row
      .getByTestId("player-result")
      .evaluate((el) => parseFloat(getComputedStyle(el.firstElementChild ?? el).fontSize));
    expect(scoreSize).toBeGreaterThan(nameSize);
    const eyebrow = await row.locator(".label").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { transform: s.textTransform, tracking: s.letterSpacing, weight: s.fontWeight };
    });
    expect(eyebrow.transform).toBe("uppercase");
    expect(parseFloat(eyebrow.tracking)).toBeGreaterThan(0);
    expect(Number(eyebrow.weight)).toBeGreaterThanOrEqual(700);
  });

  test("no surface keeps a serif stack, and mono stays only where it is deliberate", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const path of ["/", "/roles/touchline_winger", "/methodology", "/shortlist"]) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const serify = await page.evaluate((faces) => {
        const hits: string[] = [];
        for (const el of document.querySelectorAll("body *")) {
          const family = getComputedStyle(el).fontFamily;
          if (faces.some((f) => family.includes(f))) hits.push(`${el.tagName}.${el.className}`);
        }
        return hits;
      }, SERIF_FACES);
      expect(serify, `no serif-stacked element on ${path}`).toEqual([]);

      // the mono channel is still present and still monospaced
      const monoCount = await page.locator(".mono, .font-mono").count();
      if (monoCount > 0) {
        const family = await computedFontFor(page, ".mono, .font-mono");
        expect(family, `${path} mono channel`).toMatch(/ui-monospace|SF Mono|Menlo|monospace/);
      }
    }
  });

  test("player dossier identity and scores resolve Inter with role tabs still symmetrical", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByTestId("player-result").first().click();
    await page.getByTestId("player-card").waitFor();
    await page.evaluate(() => document.fonts.ready);

    expectInter(await computedFont(page, "player-name"), "dossier player name");
    const summary = page.getByTestId("selected-role-summary");
    expectInter(
      await summary.locator("span").first().evaluate((el) => getComputedStyle(el).fontFamily),
      "dossier RoleFit score",
    );

    // Inter's metrics must not desymmetrise the role tabs
    const tabs = await page
      .getByTestId("role-selector")
      .getByRole("tab")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(tabs.length).toBeGreaterThan(1);
    expect(Math.max(...tabs) - Math.min(...tabs), "role tabs stay equal width").toBeLessThanOrEqual(1);
    expect(await pageOverflowOf(page)).toBeLessThanOrEqual(1);
  });

  test("comparison names and the central role heading resolve Inter with balanced columns", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/compare");
    await page.getByTestId("compare-a").selectOption({ index: 1 });
    await page.getByTestId("compare-b").selectOption({ index: 2 });
    await page.getByTestId("compare-table").waitFor();
    await page.evaluate(() => document.fonts.ready);

    expectInter(await computedFont(page, "compare-role"), "compare role heading");
    const left = page.getByTestId("compare-side-left");
    expectInter(
      await left.locator("div").first().evaluate((el) => getComputedStyle(el).fontFamily),
      "compare player name",
    );

    const [lw, rw] = await Promise.all([
      left.evaluate((el) => el.getBoundingClientRect().width),
      page.getByTestId("compare-side-right").evaluate((el) => el.getBoundingClientRect().width),
    ]);
    expect(Math.abs(lw - rw), "compare columns stay balanced").toBeLessThanOrEqual(1);
    expect(await pageOverflowOf(page)).toBeLessThanOrEqual(1);
  });

  test("Inter metrics keep the ledger aligned and long roles wrapping on word boundaries", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/?position_group=MID");
    await page.getByTestId("results-ledger").waitFor();
    await page.evaluate(() => document.fonts.ready);

    const rows = await page.getByTestId("result-row").evaluateAll((els) =>
      els.map((row) => {
        const hero = row.querySelector('[data-testid="row-rolefit"]')!.getBoundingClientRect();
        const caption = row.querySelector('[data-testid="score-caption"]') as HTMLElement | null;
        const lh = caption ? parseFloat(getComputedStyle(caption).lineHeight) : 0;
        return {
          role: caption?.textContent ?? "",
          heroX: hero.x,
          heroW: hero.width,
          lines: caption && lh ? Math.round(caption.getBoundingClientRect().height / lh) : 0,
          clipped: caption ? caption.scrollWidth > caption.clientWidth + 1 : false,
          words: caption
            ? [...caption.querySelectorAll("span")].map((s) => s.textContent ?? "")
            : [],
        };
      }),
    );
    expect(rows.length).toBeGreaterThan(2);

    // dividers still line up under Inter's glyph widths
    const xs = rows.map((r) => r.heroX);
    expect(Math.max(...xs) - Math.min(...xs), "RoleFit dividers align").toBeLessThanOrEqual(1);
    const ws = rows.map((r) => r.heroW);
    expect(Math.max(...ws) - Math.min(...ws), "RoleFit track width stable").toBeLessThanOrEqual(1);

    // the two hyphenated long roles still break only between words
    for (const name of ["Deep-Lying Playmaker", "Ball-Winning Midfielder"]) {
      const row = rows.find((r) => r.role === name);
      expect(row, `${name} is present in the MID ledger`).toBeTruthy();
      expect(row!.lines, `${name} wraps to more than one line`).toBeGreaterThan(1);
      expect(row!.clipped, `${name} is not clipped`).toBe(false);
      expect(row!.words, `${name} breaks only between words`).toEqual(name.split(" "));
    }
    for (const row of rows) {
      expect(row.clipped, `${row.role} is not clipped`).toBe(false);
    }
  });

  test("navigation, identities and rails hold their geometry at 1280/640/390/320", async ({
    page,
  }) => {
    for (const width of [1280, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.getByTestId("results-ledger").waitFor();
      await page.evaluate(() => document.fonts.ready);

      // the always-visible counter never wraps or collides with the brand
      const counter = await page.getByTestId("favorites-counter").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { h: r.height, lh: parseFloat(getComputedStyle(el).lineHeight), right: r.right };
      });
      expect(counter.h, `counter stays one line at ${width}px`).toBeLessThan(counter.lh * 2);
      expect(counter.right, `counter stays inside the viewport at ${width}px`).toBeLessThanOrEqual(width + 1);

      // identities and clubs do not spill their row
      const spill = await page.getByTestId("result-row").evaluateAll((rows) =>
        rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length,
      );
      expect(spill, `no row overflows at ${width}px`).toBe(0);

      // both action halves stay symmetrical
      const rail = await page
        .getByTestId("result-row")
        .first()
        .evaluate((row) => {
          const a = row.querySelector('[data-testid="favorite-action"]')!.getBoundingClientRect();
          const b = row.querySelector('[data-testid="compare-action"]')!.getBoundingClientRect();
          return { dw: Math.abs(a.width - b.width), dh: Math.abs(a.height - b.height), h: a.height };
        });
      expect(rail.dw, `rail halves equal width at ${width}px`).toBeLessThanOrEqual(1);
      expect(rail.dh, `rail halves equal height at ${width}px`).toBeLessThanOrEqual(1);
      expect(rail.h, `44px target at ${width}px`).toBeGreaterThanOrEqual(44);

      expect(await pageOverflowOf(page), `discovery overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test("every surface reflows without horizontal overflow at 640/390/320 under Inter", async ({
    page,
  }) => {
    const surfaces = [
      { path: "/", ready: '[data-testid="results-ledger"]' },
      { path: "/roles/touchline_winger", ready: "h1" },
      { path: "/compare", ready: "h1" },
      { path: "/shortlist", ready: "h1" },
      { path: "/methodology", ready: '[data-testid="methodology-contents"]' },
    ];
    for (const width of [640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const { path, ready } of surfaces) {
        await page.goto(path);
        await page.locator(ready).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        expect(await pageOverflowOf(page), `${path} at ${width}px`).toBeLessThanOrEqual(1);
      }
    }
  });

  test("My Favorites rows stay aligned and the rail symmetrical under Inter", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/?position_group=MID");
    await page.getByTestId("results-ledger").waitFor();
    for (const index of [0, 1, 2]) {
      await page.getByTestId("result-row").nth(index).getByTestId("favorite-action").click();
    }
    await page.goto("/shortlist");
    await expect(page.getByTestId("shortlist-record")).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);

    expectInter(await computedFont(page, "shortlist-player"), "saved player name");
    const rows = await page.getByTestId("shortlist-record").evaluateAll((els) =>
      els.map((row) => {
        const hero = row.querySelector('[data-testid="row-rolefit"]')!.getBoundingClientRect();
        const a = row.querySelector('[data-testid="remove-action"]')!.getBoundingClientRect();
        const b = row.querySelector('[data-testid="compare-action"]')!.getBoundingClientRect();
        return { heroX: hero.x, dw: Math.abs(a.width - b.width), dh: Math.abs(a.height - b.height) };
      }),
    );
    const xs = rows.map((r) => r.heroX);
    expect(Math.max(...xs) - Math.min(...xs), "saved RoleFit dividers align").toBeLessThanOrEqual(1);
    for (const row of rows) {
      expect(row.dw).toBeLessThanOrEqual(1);
      expect(row.dh).toBeLessThanOrEqual(1);
    }
    expect(await pageOverflowOf(page)).toBeLessThanOrEqual(1);
  });

  test("the font swap causes no meaningful cumulative layout shift", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    await page.evaluate(() => document.fonts.ready);
    // settle any post-load shift before reading the accumulated score
    await page.waitForTimeout(600);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    // Core Web Vitals treats <= 0.1 as "good"; the self-hosted face must stay well inside it.
    expect(cls, "cumulative layout shift after the font loads").toBeLessThanOrEqual(0.1);
  });
});

async function pageOverflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
