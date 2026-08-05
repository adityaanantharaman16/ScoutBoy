import { expect, test, type Page } from "@playwright/test";

import { gotoFirstDossier } from "./support/surfaces";

// The behaviours that only a real engine can prove: keyboard operation of the age
// slider, the mirrored inset markers as COMPUTED paint, target sizes, and the
// comparable-player card holding its single-line rows at real viewport widths.

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** True when the element's own box is wider than the text laid out inside it. */
async function isSingleLine(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((el) => {
    const line = parseFloat(getComputedStyle(el).lineHeight) || el.clientHeight;
    return el.scrollHeight <= line * 1.5;
  });
}

test.describe("Age threshold control", () => {
  test("is fully operable from the keyboard, with a visible focus ring", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const slider = page.getByTestId("age-threshold-slider");

    await slider.focus();
    await expect(slider).toBeFocused();
    const outline = await slider.evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(parseFloat(outline)).toBeGreaterThan(0);

    // arrows walk the discrete stops, three years at a time, and never land between
    await expect(slider).toHaveValue("25");
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue("28");
    await expect(page).toHaveURL(/age_max=28/);

    await slider.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveValue("22");
    await expect(page).toHaveURL(/age_max=22/);

    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveValue("19");
    await slider.focus();
    await page.keyboard.press("End");
    await expect(slider).toHaveValue("31");
  });

  test("announces the full semantics, not a bare number", async ({ page }) => {
    await page.goto("/?age_max=25");
    await page.getByTestId("results-ledger").waitFor();
    const slider = page.getByTestId("age-threshold-slider");
    await expect(slider).toHaveAttribute("aria-valuetext", "25 Years And Younger");
    await expect(slider).toHaveAccessibleName("Age threshold");

    await page.getByTestId("age-direction-older").click();
    await expect(page).toHaveURL(/age_min=25/);
    await expect(slider).toHaveAttribute("aria-valuetext", "25 Years And Older");
  });

  test("direction buttons are reachable by keyboard and toggle on Enter", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const older = page.getByTestId("age-direction-older");
    await older.focus();
    await expect(older).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(older).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/age_min=25/);
  });

  test("browser back and forward restore the control exactly", async ({ page }) => {
    // Filter changes use `router.replace`, as every ScoutBoy filter always has, so
    // dragging a slider does not litter the history with a stop per frame. What
    // must survive back/forward is the hydration itself: whatever URL the history
    // entry holds has to rebuild the control faithfully.
    await page.goto("/?age_max=22");
    await page.getByTestId("filter-rail").waitFor();
    await expect(page.getByTestId("age-threshold-value")).toHaveText("22 Years");

    await page.goto("/?age_min=31");
    await page.getByTestId("filter-rail").waitFor();
    await expect(page.getByTestId("age-threshold-value")).toHaveText("31 Years");
    await expect(page.getByTestId("age-direction-older")).toHaveAttribute("aria-pressed", "true");

    await page.goBack();
    await expect(page).toHaveURL(/age_max=22/);
    await expect(page.getByTestId("age-threshold-value")).toHaveText("22 Years");
    await expect(page.getByTestId("age-direction-younger")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("age-threshold-slider")).toHaveValue("22");

    await page.goForward();
    await expect(page).toHaveURL(/age_min=31/);
    await expect(page.getByTestId("age-threshold-value")).toHaveText("31 Years");
    await expect(page.getByTestId("age-direction-older")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("age-threshold-slider")).toHaveValue("31");
  });

  test("meets target-size and reflow expectations at every width and at 200% zoom", async ({
    page,
  }) => {
    for (const [label, width, height] of [
      ["mobile-320", 320, 720],
      ["mobile-390", 390, 844],
      ["tablet-768", 768, 1024],
      // 200% zoom of a 1280px desktop viewport is a 640px CSS viewport
      ["zoom-640", 640, 720],
      ["desktop-1280", 1280, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.getByTestId("results-ledger").waitFor();

      await expect(page.getByTestId("age-threshold-slider"), label).toBeVisible();
      expect(await pageOverflow(page), `overflow at ${label}`).toBeLessThanOrEqual(1);

      for (const id of ["age-direction-younger", "age-direction-older", "age-direction-all"]) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.width, `${id} width at ${label}`).toBeGreaterThanOrEqual(24);
        expect(box.height, `${id} height at ${label}`).toBeGreaterThanOrEqual(24);
      }
      const track = (await page.getByTestId("age-threshold-slider").boundingBox())!;
      expect(track.height, `slider height at ${label}`).toBeGreaterThanOrEqual(24);
    }
  });

  test("uses restrained green for the active side and square geometry throughout", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/?age_max=25");
    await page.getByTestId("results-ledger").waitFor();

    // The accent is the shared ScoutBoy green token, not a new colour: resolve
    // `--pitch` through the engine and compare the painted fill against it.
    const [fillColor, pitchRgb] = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.color = "var(--pitch)";
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      const fill = document.querySelector<HTMLElement>('[data-testid="age-slider-fill"]')!;
      return [getComputedStyle(fill).backgroundColor, rgb];
    });
    expect(fillColor).toBe(pitchRgb);
    await expect(page.getByTestId("age-slider-fill")).toBeVisible();

    // no rounded corner anywhere in the control
    const radii = await page.getByTestId("age-threshold-filter").evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>("*")).flatMap((el) => {
        const s = getComputedStyle(el);
        return [
          s.borderTopLeftRadius,
          s.borderTopRightRadius,
          s.borderBottomRightRadius,
          s.borderBottomLeftRadius,
        ];
      }),
    );
    expect(radii.filter((r) => parseFloat(r) > 0)).toEqual([]);
  });
});

test.describe("Mirrored selected Compare markers", () => {
  /** The computed inset marker on a pressed rail action, as painted. */
  async function markerShadow(page: Page, testId: string): Promise<string> {
    return page.getByTestId(testId).first().evaluate((el) => getComputedStyle(el).boxShadow);
  }

  for (const [surface, path, ready] of [
    ["Discover", "/", '[data-testid="results-ledger"]'],
    ["My Favorites", "/shortlist", '[data-testid="shortlist-ledger"]'],
  ] as const) {
    for (const width of [390, 1280]) {
      test(`${surface} at ${width}px: Compare marks its right edge, geometry unchanged`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });

        if (surface === "My Favorites") {
          await page.goto("/");
          await page.getByTestId("results-ledger").waitFor();
          await page.getByTestId("favorite-action").first().click();
          await page.goto("/shortlist");
        } else {
          await page.goto("/");
        }
        await page.locator(ready).waitFor();

        const compare = page.getByTestId("compare-action").first();
        const row = page.locator('[data-testid="result-row"], [data-testid="shortlist-record"]').first();
        const leftAction = page
          .locator('[data-testid="favorite-action"], [data-testid="remove-action"]')
          .first();

        // Geometry is captured RELATIVE to the row, because clicking scrolls the
        // control into view and Playwright's boxes are viewport-relative: an
        // absolute y would report the scroll, not a layout shift.
        const geometry = async () => {
          const [c, r, l] = await Promise.all([
            compare.boundingBox(),
            row.boundingBox(),
            leftAction.boundingBox(),
          ]);
          return {
            compare: { w: c!.width, h: c!.height, dx: c!.x - r!.x, dy: c!.y - r!.y },
            left: { w: l!.width, h: l!.height, dx: l!.x - r!.x, dy: l!.y - r!.y },
            row: { w: r!.width, h: r!.height },
          };
        };
        const before = await geometry();

        await compare.click();
        await expect(compare).toHaveAttribute("aria-pressed", "true");

        // Marker sits on the RIGHT: a negative horizontal inset offset. Polled
        // rather than read once, because the marker is a 120ms box-shadow
        // transition and a single sample can land on its first frame.
        await expect.poll(() => markerShadow(page, "compare-action")).toMatch(/-3px 0px 0px/);
        expect(await markerShadow(page, "compare-action")).toContain("inset");

        // and the favourite/remove side keeps the LEFT marker when pressed
        if (surface === "Discover") {
          await leftAction.click();
          await expect
            .poll(() => markerShadow(page, "favorite-action"))
            .toMatch(/ 3px 0px 0px/);
          expect(await markerShadow(page, "favorite-action")).toContain("inset");
          await leftAction.click();
        }

        // nothing moved
        expect(await geometry(), `geometry at ${width}px`).toEqual(before);

        // and the semantics are intact
        await expect(compare).toHaveText("Compare");
        await expect(compare).toHaveAccessibleName(/compare queue$/);
        await expect(page.getByTestId("compare-tray")).toBeVisible();
      });
    }
  }

  test("the comparable-player cards mark Compare on the right, like the home page", async ({
    page,
  }) => {
    await gotoFirstDossier(page);
    await page.getByTestId("similar-group").first().waitFor();

    const cardCompare = page
      .getByTestId("similar-group")
      .first()
      .getByTestId("compare-action")
      .first();
    await cardCompare.click();
    await expect(cardCompare).toHaveAttribute("aria-pressed", "true");

    // Poll past the 120ms marker transition before judging which edge it landed on.
    await expect
      .poll(() => cardCompare.evaluate((el) => getComputedStyle(el).boxShadow))
      .toMatch(/-3px 0px 0px/);
    const shadow = await cardCompare.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toContain("inset");
    // the approved selected background comes with it
    await expect
      .poll(() => cardCompare.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(233, 240, 234)");

    // ...and the heart beside it keeps the mirrored LEFT marker
    const cardHeart = page
      .getByTestId("similar-group")
      .first()
      .getByTestId("favorite-action")
      .first();
    await cardHeart.click();
    await expect
      .poll(() => cardHeart.evaluate((el) => getComputedStyle(el).boxShadow))
      .toMatch(/ 3px 0px 0px/);
    expect(await cardHeart.evaluate((el) => getComputedStyle(el).boxShadow)).not.toMatch(
      /-3px 0px 0px/,
    );
  });

  test("the dossier's own .btn Compare keeps its plain pressed treatment", async ({ page }) => {
    // Only rail actions carry the mirrored marker; the Recruitment Desk / header
    // control is a `.btn` and is deliberately untouched.
    await gotoFirstDossier(page);
    const deskCompare = page.locator("button.btn").filter({ hasText: /^(Compare|Queued)$/ }).first();
    await deskCompare.click();
    await expect(deskCompare).toHaveText("Queued");
    expect(await deskCompare.evaluate((el) => getComputedStyle(el).boxShadow)).not.toMatch(
      /3px 0px 0px/,
    );
  });
});

test.describe("Comparable-player cards", () => {
  for (const [label, width] of [
    ["320px", 320],
    ["390px", 390],
    ["tablet", 768],
    ["desktop", 1280],
  ] as const) {
    test(`identity and market range stay on one line at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoFirstDossier(page);
      await page.getByTestId("similar-group").first().waitFor();

      expect(await isSingleLine(page, '[data-testid="similar-identity"]')).toBe(true);
      expect(await isSingleLine(page, '[data-testid="similar-market"] .mono')).toBe(true);

      // the currency range never breaks between its endpoints
      const wrap = await page
        .locator('[data-testid="similar-market"] .mono')
        .first()
        .evaluate((el) => getComputedStyle(el).whiteSpace);
      expect(wrap).toBe("nowrap");

      expect(await pageOverflow(page), `overflow at ${label}`).toBeLessThanOrEqual(1);
    });
  }

  test("the action bar spans the card and keeps comfortable targets", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoFirstDossier(page);
    const bar = page.getByTestId("card-action-bar").first();
    await bar.waitFor();

    const barBox = (await bar.boundingBox())!;
    const heart = (await bar.getByTestId("favorite-action").boundingBox())!;
    const compare = (await bar.getByTestId("compare-action").boundingBox())!;

    // two side-by-side halves of equal weight, spanning the bar
    expect(Math.abs(heart.width - compare.width)).toBeLessThanOrEqual(2);
    expect(heart.width + compare.width).toBeGreaterThanOrEqual(barBox.width - 4);
    expect(Math.abs(heart.y - compare.y)).toBeLessThanOrEqual(1);
    for (const box of [heart, compare]) expect(box.height).toBeGreaterThanOrEqual(40);
  });

  test("favourite and compare state survives a reload and reaches the other surfaces", async ({
    page,
  }) => {
    await gotoFirstDossier(page);
    const group = page.getByTestId("similar-group").first();
    await group.waitFor();

    const name = await group.getByRole("link").first().textContent();
    await group.getByTestId("favorite-action").first().click();
    await group.getByTestId("compare-action").first().click();
    await expect(group.getByTestId("favorite-action").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("compare-tray")).toContainText(name!);

    await page.reload();
    await page.getByTestId("similar-group").first().waitFor();
    await expect(
      page.getByTestId("similar-group").first().getByTestId("favorite-action").first(),
    ).toHaveAttribute("aria-pressed", "true");

    // the device-local favourite shows up on My Favorites
    await page.goto("/shortlist");
    await expect(page.getByTestId("shortlist-ledger")).toContainText(name!);
  });
});

// ---------------------------------------------------------------------------
// Responsive composition of the filter rail
// ---------------------------------------------------------------------------
// One grid, three column counts, no reordering. These assertions are on MEASURED
// geometry, because the whole point of the correction was dead space that only a
// real layout engine can produce.

/** Every direct child of the filter grid, with its measured box. */
async function gridItems(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('[data-testid="filter-grid"]')!;
    return Array.from(grid.children).map((child) => {
      const el = child as HTMLElement;
      const r = el.getBoundingClientRect();
      return {
        name:
          el.dataset.testid ??
          el.querySelector<HTMLElement>(".label")?.textContent?.trim() ??
          el.tagName.toLowerCase(),
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
      };
    });
  });
}

/** Rows of item names, grouped by shared top edge. */
function rowsOf(items: Array<{ name: string; y: number }>): string[][] {
  const rows: Array<{ y: number; names: string[] }> = [];
  for (const item of items) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= 2);
    if (row) row.names.push(item.name);
    else rows.push({ y: item.y, names: [item.name] });
  }
  return rows.sort((a, b) => a.y - b.y).map((r) => r.names);
}

test.describe("Filter rail responsive layout", () => {
  const PANEL_PADDING = 16; // .card => p-4

  /** Internal content width of the filter panel. */
  async function panelInnerWidth(page: Page): Promise<number> {
    return page.evaluate(
      (pad) =>
        Math.round(
          document.querySelector<HTMLElement>('[data-testid="filter-rail"]')!.getBoundingClientRect()
            .width - pad * 2,
        ),
      PANEL_PADDING,
    );
  }

  for (const [label, width] of [
    ["tablet-768", 768],
    ["tablet-1023", 1023],
    ["small-desktop-640", 640],
  ] as const) {
    test(`${label}: age control spans both columns and the rows are as specified`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.getByTestId("results-ledger").waitFor();

      const items = await gridItems(page);
      expect(rowsOf(items), `rows at ${label}`).toEqual([
        ["Search"],
        ["age-threshold-filter"],
        ["Position group", "threshold-pair"],
        ["Role", "Sort"],
      ]);

      // the two full-width rows really do span the panel's whole interior
      // (2px tolerance: the panel width and each item width round independently)
      const inner = await panelInnerWidth(page);
      for (const name of ["Search", "age-threshold-filter"]) {
        const item = items.find((i) => i.name === name)!;
        expect(item.w, `${name} width at ${label}`).toBeGreaterThanOrEqual(inner - 2);
      }

      // ...and the paired rows are two genuine columns, each about half
      const pg = items.find((i) => i.name === "Position group")!;
      const pair = items.find((i) => i.name === "threshold-pair")!;
      expect(pg.y).toBe(pair.y);
      expect(pg.x).toBeLessThan(pair.x);
      expect(Math.abs(pg.w - pair.w)).toBeLessThanOrEqual(2);

      expect(await pageOverflow(page), `overflow at ${label}`).toBeLessThanOrEqual(1);
    });

    test(`${label}: the slider rail and the direction group fill that full width`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.getByTestId("results-ledger").waitFor();

      const inner = await panelInnerWidth(page);
      const measured = await page.evaluate(() => {
        const q = (s: string) => document.querySelector<HTMLElement>(s)!.getBoundingClientRect();
        const box = q('[data-testid="age-direction-group"]');
        const segments = Array.from(
          document.querySelectorAll<HTMLElement>(".age-direction-action"),
        ).map((s) => {
          const r = s.getBoundingClientRect();
          return { w: Math.round(r.width), align: getComputedStyle(s).justifyContent };
        });
        const youth = [...document.querySelectorAll<HTMLElement>("span")].find(
          (s) => s.textContent === "Youth",
        )!;
        const seasoned = [...document.querySelectorAll<HTMLElement>("span")].find(
          (s) => s.textContent === "Seasoned",
        )!;
        return {
          rail: Math.round(q(".age-slider-rail").width),
          railX: Math.round(q(".age-slider-rail").x),
          input: Math.round(q('[data-testid="age-threshold-slider"]').width),
          box: Math.round(box.width),
          boxX: Math.round(box.x),
          segments,
          youthX: Math.round(youth.getBoundingClientRect().x),
          seasonedRight: Math.round(seasoned.getBoundingClientRect().right),
        };
      });

      // the visible rail stretches across the whole panel interior
      expect(measured.rail, `rail at ${label}`).toBeGreaterThanOrEqual(inner - 2);
      expect(measured.input).toBeGreaterThanOrEqual(inner - 2);
      // the segmented control sits directly below it, same span
      expect(measured.box).toBeGreaterThanOrEqual(inner - 2);
      expect(measured.boxX).toBe(measured.railX);
      // three equal segments with centred labels
      expect(measured.segments).toHaveLength(3);
      const widths = measured.segments.map((s) => s.w);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      for (const s of measured.segments) expect(s.align).toBe("center");
      // Youth / Seasoned pinned to the scale's two ends
      expect(measured.youthX).toBe(measured.railX);
      expect(measured.seasonedRight).toBe(measured.railX + measured.rail);
    });
  }

  for (const width of [320, 375, 390]) {
    test(`${width}px: one clean column in the required order, no overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.getByTestId("results-ledger").waitFor();

      const items = await gridItems(page);
      // every control on its own row, in the logical sequence
      expect(rowsOf(items)).toEqual([
        ["Search"],
        ["age-threshold-filter"],
        ["Position group"],
        ["threshold-pair"],
        ["Role"],
        ["Sort"],
      ]);
      // all the same width: no control squeezed to keep a second column
      const inner = await panelInnerWidth(page);
      for (const item of items) {
        expect(item.w, `${item.name} at ${width}px`).toBeGreaterThanOrEqual(inner - 2);
      }
      expect(await pageOverflow(page), `overflow at ${width}px`).toBeLessThanOrEqual(1);
      // and no select collapsed to an unreadable width
      const selectWidths = await page
        .locator('[data-testid="filter-rail"] select')
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
      for (const w of selectWidths) expect(w).toBeGreaterThanOrEqual(120);
    });
  }

  test("lg desktop keeps the approved one-column sticky rail, ledger-aligned", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();

    // one item per row, in the same logical order as every other width
    const items = await gridItems(page);
    expect(rowsOf(items)).toEqual([
      ["Search"],
      ["age-threshold-filter"],
      ["Position group"],
      ["threshold-pair"],
      ["Role"],
      ["Sort"],
    ]);

    await expect(page.getByTestId("filter-column")).toHaveCSS("position", "sticky");
    await expect(page.getByTestId("filter-column")).toHaveCSS("top", "16px");

    // the rail still starts level with the results ledger
    const rail = (await page.getByTestId("filter-rail").boundingBox())!;
    const ledger = (await page.getByTestId("results-ledger").boundingBox())!;
    expect(Math.round(rail.y)).toBe(Math.round(ledger.y));
    // and it is still the narrow column, not a full-width panel
    expect(rail.width).toBeLessThanOrEqual(280);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Slider track and tick geometry, as painted
// ---------------------------------------------------------------------------
test.describe("Age slider geometry", () => {
  /** Rail box, its interior (inside the border), and every tick box. */
  async function sliderBoxes(page: Page) {
    return page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>(".age-slider-rail")!;
      const rr = rail.getBoundingClientRect();
      const cs = getComputedStyle(rail);
      const bt = parseFloat(cs.borderTopWidth);
      const bb = parseFloat(cs.borderBottomWidth);
      return {
        rail: { top: rr.top, bottom: rr.bottom, height: rr.height, left: rr.left, width: rr.width },
        interior: { top: rr.top + bt, bottom: rr.bottom - bb },
        ticks: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="age-slider-stop"]')).map(
          (t) => {
            const b = t.getBoundingClientRect();
            return {
              stop: Number(t.dataset.ageStop),
              active: t.dataset.ageStopActive === "true",
              top: b.top,
              bottom: b.bottom,
              height: b.height,
              centre: b.left + b.width / 2,
            };
          },
        ),
      };
    });
  }

  test("uses a materially thicker track than the original hairline", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const { rail } = await sliderBoxes(page);
    expect(rail.height).toBeGreaterThanOrEqual(12);
    expect(rail.height).toBeLessThanOrEqual(14);
    // the retired rail was 6px; this must read as a track, not a divider
    expect(rail.height).toBeGreaterThan(9);
  });

  test("contains every tick inside the track, touching neither border", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const { rail, interior, ticks } = await sliderBoxes(page);
    expect(ticks).toHaveLength(5);

    for (const tick of ticks) {
      const where = `stop ${tick.stop}`;
      // wholly within the rail's own box
      expect(tick.top, where).toBeGreaterThan(rail.top);
      expect(tick.bottom, where).toBeLessThan(rail.bottom);
      // and strictly inside the border, top and bottom
      expect(tick.top, where).toBeGreaterThan(interior.top);
      expect(tick.bottom, where).toBeLessThan(interior.bottom);
      // short, centred indicator: a third to a half of the track
      expect(tick.height / rail.height, where).toBeGreaterThanOrEqual(1 / 3);
      expect(tick.height / rail.height, where).toBeLessThanOrEqual(1 / 2);
      const above = tick.top - interior.top;
      const below = interior.bottom - tick.bottom;
      expect(Math.abs(above - below), `${where} centring`).toBeLessThanOrEqual(0.5);
    }
  });

  test("aligns the first and last ticks with the thumb's real travel endpoints", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const slider = page.getByTestId("age-threshold-slider");

    // Measured against the FILL edge, which tracks the thumb centre exactly.
    async function fillEdge(): Promise<number> {
      return page.evaluate(() => {
        const f = document.querySelector<HTMLElement>('[data-testid="age-slider-fill"]')!;
        const r = f.getBoundingClientRect();
        return f.classList.contains("age-slider-fill-younger") ? r.right : r.left;
      });
    }

    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveValue("19");
    const first = (await sliderBoxes(page)).ticks[0];
    expect(Math.abs((await fillEdge()) - first.centre)).toBeLessThanOrEqual(1);

    await page.keyboard.press("End");
    await expect(slider).toHaveValue("31");
    const last = (await sliderBoxes(page)).ticks[4];
    expect(Math.abs((await fillEdge()) - last.centre)).toBeLessThanOrEqual(1);
  });

  test("keeps the five stops evenly spaced and marks the active one", async ({ page }) => {
    await page.goto("/?age_max=22");
    await page.getByTestId("results-ledger").waitFor();
    const { ticks } = await sliderBoxes(page);
    expect(ticks.map((t) => t.stop)).toEqual([19, 22, 25, 28, 31]);

    const gaps = ticks.slice(1).map((t, i) => t.centre - ticks[i].centre);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);

    // exactly one active stop, with identical geometry to the rest
    const active = ticks.filter((t) => t.active);
    expect(active).toHaveLength(1);
    expect(active[0].stop).toBe(22);
    for (const t of ticks) expect(t.height).toBe(ticks[0].height);
  });

  test("still works from the keyboard with the value text and URL intact", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const slider = page.getByTestId("age-threshold-slider");
    await expect(slider).toHaveAccessibleName("Age threshold");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue("28");
    // no direction was active, so moving the slider applies the default reading
    await expect(slider).toHaveAttribute("aria-valuetext", "28 Years And Younger");
    await expect(page).toHaveURL(/age_max=28/);
    // the thicker track is still a comfortable pointer target
    const box = (await slider.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(24);
  });
});

// ---------------------------------------------------------------------------
// Leaderboard actions
// ---------------------------------------------------------------------------
test.describe("Leaderboard heart/Compare bar", () => {
  const ROLE = "/roles/touchline_winger";

  test("desktop: the bar sits in the Actions column without widening the document", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(ROLE);
    await page.getByTestId("leaderboard-table").waitFor();

    const bar = page.getByTestId("leaderboard-table").getByTestId("card-action-bar").first();
    await expect(bar).toBeVisible();
    // inside a real table cell, with the table's semantics intact
    expect(await bar.evaluate((el) => el.closest("td") !== null)).toBe(true);
    await expect(page.getByTestId("leaderboard-table").locator("tbody tr")).toHaveCount(6);

    const halves = await bar.evaluate((el) =>
      Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().width)),
    );
    expect(halves).toHaveLength(2);
    expect(Math.abs(halves[0] - halves[1])).toBeLessThanOrEqual(1);
    const box = (await bar.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("mobile: a full-width bar beneath each row's information", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ROLE);
    await page.getByTestId("leaderboard-ledger").waitFor();

    const row = page.getByTestId("leaderboard-ledger").locator("article").first();
    const bar = row.getByTestId("card-action-bar");
    const rowBox = (await row.boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    // spans the row's content width and is its last block
    expect(barBox.width).toBeGreaterThanOrEqual(rowBox.width - 33);
    expect(barBox.y).toBeGreaterThan(rowBox.y);
    // rank order and the evidence channels survive
    await expect(row).toContainText("#1");
    await expect(row.getByTestId("score-readout")).toBeVisible();
    await expect(row.getByTestId("confidence-readout")).toBeVisible();
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  for (const [label, width, container] of [
    ["desktop", 1280, "leaderboard-table"],
    ["mobile", 390, "leaderboard-ledger"],
  ] as const) {
    test(`${label}: selecting either action changes paint only`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(ROLE);
      await page.getByTestId(container).waitFor();

      // Both renderings are in the DOM at once; scope to the one this width shows,
      // or the click lands on a `display: none` bar.
      const bar = page.getByTestId(container).getByTestId("card-action-bar").first();
      const heart = bar.getByTestId("favorite-action");
      const compare = bar.getByTestId("compare-action");

      const geometry = async () =>
        bar.evaluate((el) => {
          const b = el.getBoundingClientRect();
          return {
            w: Math.round(b.width),
            h: Math.round(b.height),
            halves: Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().width)),
          };
        });
      const before = await geometry();

      await heart.click();
      await compare.click();
      await expect(heart).toHaveAttribute("aria-pressed", "true");
      await expect(compare).toHaveAttribute("aria-pressed", "true");

      // the approved selected background, and a flat inset marker
      await expect.poll(() => heart.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        "rgb(233, 240, 234)",
      );
      await expect
        .poll(() => compare.evaluate((el) => getComputedStyle(el).boxShadow))
        .toContain("inset");
      await expect(bar.getByTestId("favorite-heart")).toHaveAttribute("data-filled", "true");
      await expect(compare).toHaveText("Compare");

      expect(await geometry(), `${label} geometry`).toEqual(before);
      // the shared tray and live region still respond
      await expect(page.getByTestId("compare-tray")).toBeVisible();
    });
  }

  test("shows no retired action wording and persists across a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(ROLE);
    await page.getByTestId("leaderboard-table").waitFor();
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(
      /Shortlisted|Shortlist|Queued|vs Compare/,
    );

    const tableHeart = () =>
      page.getByTestId("leaderboard-table").getByTestId("favorite-action").first();
    await tableHeart().click();
    await expect(tableHeart()).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await page.getByTestId("leaderboard-table").waitFor();
    await expect(tableHeart()).toHaveAttribute("aria-pressed", "true");
    // and it reached My Favorites
    await page.goto("/shortlist");
    await expect(page.getByTestId("shortlist-ledger")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Dossier section rhythm
// ---------------------------------------------------------------------------
test.describe("Dossier spacing before Scouting Notes", () => {
  /** Gap in px between the bottom of one numbered section and the top of the next. */
  async function sectionGaps(page: Page) {
    return page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll<HTMLElement>("section")).filter((s) =>
        /^\d\d \//.test(s.textContent!.trim()),
      );
      const boxes = sections.map((s) => {
        const r = s.getBoundingClientRect();
        return {
          number: s.querySelector<HTMLElement>(".label")!.textContent!.trim().slice(0, 2),
          top: r.top + window.scrollY,
          bottom: r.bottom + window.scrollY,
        };
      });
      const gaps: Record<string, number> = {};
      for (let i = 1; i < boxes.length; i += 1) {
        gaps[`${boxes[i - 1].number}->${boxes[i].number}`] = Math.round(
          boxes[i].top - boxes[i - 1].bottom,
        );
      }
      return gaps;
    });
  }

  for (const [label, width] of [
    ["desktop", 1280],
    ["mobile", 390],
    ["narrow-320", 320],
  ] as const) {
    test(`${label}: a deliberate 32px major-section gap before Scouting Notes`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoFirstDossier(page);
      await page.getByTestId("similar-group").first().waitFor();

      const gaps = await sectionGaps(page);
      // the reported bug: 06 was flush against the 04/05 grid at 0px
      expect(gaps["05->06"], `05->06 at ${label}`).toBe(32);
      // and it matches the rhythm on either side of it
      expect(gaps["06->07"], `06->07 at ${label}`).toBe(32);
      expect(gaps["03->04"], `03->04 at ${label}`).toBe(32);
      expect(gaps["07->08"], `07->08 at ${label}`).toBe(32);
      expect(gaps["08->09"], `08->09 at ${label}`).toBe(32);
    });
  }

  test("does not double the gap inside the 04/05 pair when it stacks", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoFirstDossier(page);
    await page.getByTestId("similar-group").first().waitFor();
    // stacked: the pair keeps its own 24px grid gap, not 32 and not 56
    expect((await sectionGaps(page))["04->05"]).toBe(24);
  });

  test("keeps Market Value and Context & Coverage equal-height on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoFirstDossier(page);
    const market = (await page.locator("#market-full").boundingBox())!;
    const context = (await page.locator("#context-full").boundingBox())!;
    expect(Math.round(market.height)).toBe(Math.round(context.height));
    // genuinely side by side
    expect(Math.round(market.y)).toBe(Math.round(context.y));
  });
});

// ---------------------------------------------------------------------------
// Leaderboard desktop presentation
// ---------------------------------------------------------------------------
test.describe("Leaderboard desktop table presentation", () => {
  const ROLE = "/roles/touchline_winger";

  /** Number of line boxes the element's own text occupies. */
  async function textLineBoxes(page: Page, selector: string, nth = 0): Promise<number> {
    return page.locator(selector).nth(nth).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getClientRects().length;
    });
  }

  for (const width of [1024, 1280, 1440]) {
    test(`${width}px: every expected-asking range stays on one line`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(ROLE);
      await page.getByTestId("leaderboard-table").waitFor();

      const cells = page.locator('[data-testid="leaderboard-table"] tbody tr td:nth-child(6)');
      const count = await cells.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        await expect(cells.nth(i)).toHaveCSS("white-space", "nowrap");
        expect(
          await textLineBoxes(
            page,
            '[data-testid="leaderboard-table"] tbody tr td:nth-child(6)',
            i,
          ),
          `row ${i + 1} at ${width}px`,
        ).toBe(1);
      }
      // and the table still fits without the document scrolling sideways
      expect(await pageOverflow(page), `overflow at ${width}px`).toBeLessThanOrEqual(1);
    });
  }

  test("the Compare label is a step smaller than the default rail action", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(ROLE);
    await page.getByTestId("leaderboard-table").waitFor();

    const compare = page
      .getByTestId("leaderboard-table")
      .getByTestId("compare-action")
      .first();
    await expect(compare).toHaveCSS("font-size", "12px");

    // the label fits its half on one line, with room to spare
    expect(
      await textLineBoxes(page, '[data-testid="leaderboard-table"] [data-testid="compare-action"]'),
    ).toBe(1);
    const box = (await compare.boundingBox())!;
    const label = await compare.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().width;
    });
    expect(label).toBeLessThan(box.width - 12);

    // ...and the shared 44px target survives the smaller type
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("the mobile ledger keeps the default label size", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ROLE);
    await page.getByTestId("leaderboard-ledger").waitFor();
    await expect(
      page.getByTestId("leaderboard-ledger").getByTestId("compare-action").first(),
    ).toHaveCSS("font-size", "14px");
  });

  test("a selected Compare marks its right edge, matching the home page exactly", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    /**
     * The SETTLED painted marker on a pressed Compare, for one surface.
     *
     * Polled on the marker's own offset, not merely on "inset": the unselected
     * value is `rgba(0, 0, 0, 0) 0px 0px 0px 0px inset`, so an "inset" poll would
     * pass on the transition's first frame and compare two half-drawn shadows.
     */
    async function compareMarker(container: string): Promise<string> {
      const compare = page.getByTestId(container).getByTestId("compare-action").first();
      await compare.click();
      await expect(compare).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(() => compare.evaluate((el) => getComputedStyle(el).boxShadow))
        .toMatch(/-3px 0px 0px/);
      return compare.evaluate((el) => getComputedStyle(el).boxShadow);
    }

    // the home page, as the reference
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const home = await compareMarker("results-ledger");

    // the leaderboard must paint the identical marker
    await page.goto(ROLE);
    await page.getByTestId("leaderboard-table").waitFor();
    const leaderboard = await compareMarker("leaderboard-table");

    expect(leaderboard).toBe(home);
    expect(leaderboard).toMatch(/-3px 0px 0px/);
  });
});
