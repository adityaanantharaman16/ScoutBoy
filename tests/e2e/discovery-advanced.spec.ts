import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 8.2 — Advanced Discovery, proved in a real browser against the committed
 * sample fixture cohort.
 *
 * The Vitest suites own the URL grammar, the unit conversion and the removal
 * bookkeeping. What only a real engine can prove lives here: that a hard-loaded
 * compound link restores every control AND narrows the ledger, that reload and
 * back/forward reproduce it, that a disclosure is operable from the keyboard, that
 * removing a criterion leaves focus somewhere usable, that the rail geometry holds
 * at seven widths without horizontal overflow, and that nothing animates a layout
 * property on the way open.
 *
 * Player identity is asserted by name and by count, never by primary key: the
 * fixture database is rebuilt per run and ids are not part of the contract.
 */

const COMPOUND =
  "/?q=a&position_group=ATT&league=Bundesliga&min_minutes=450&rolefit_min=40&sort=name_asc";

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** The names in the ledger, in order. */
async function ledgerNames(page: Page): Promise<string[]> {
  await page.getByTestId("results-ledger").waitFor();
  return page
    .locator('[data-testid="player-result"]')
    .evaluateAll((els) => els.map((el) => el.textContent!.trim()));
}

/** The total the ledger header reports. */
async function reportedTotal(page: Page): Promise<number> {
  const text = await page.getByTestId("result-count").innerText();
  return Number(/^(\d+)\s+player/.exec(text)?.[1] ?? "-1");
}

async function openAdvanced(page: Page, category?: string) {
  const toggle = page.getByTestId("advanced-filters-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  if (category) {
    const header = page.getByTestId(`advanced-category-toggle-${category}`);
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    await expect(page.getByTestId(`advanced-category-fields-${category}`)).toBeVisible();
  }
}

// ---------------------------------------------------------------------------
// The compact default rail
// ---------------------------------------------------------------------------
test.describe("The collapsed rail", () => {
  test("shows the five core controls and hides the specialized ones", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();

    for (const id of ["search-input", "age-threshold-slider", "position-group-filter", "role-filter", "sort-filter"]) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    for (const id of ["league-filter", "club-filter", "nationality-filter", "min-minutes-filter", "rolefit-min-filter", "rolefit-max-filter", "playstyle-filter", "value-min-filter", "value-max-filter"]) {
      await expect(page.getByTestId(id), id).toBeHidden();
    }
    await expect(page.getByTestId("advanced-filters-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // nothing is narrowing, so the criteria area is absent entirely
    await expect(page.getByTestId("active-criteria")).toHaveCount(0);
  });

  test("populates Playstyle from the Methodology contract, not a local list", async ({ page }) => {
    // The same endpoint the Methodology page renders is the rail's source, so the
    // two must offer exactly the same positive playstyles, by display name.
    await page.goto("/methodology");
    await page.getByTestId("methodology-contents").waitFor();
    const published = await page
      .locator('#playstyles [data-tag-variant="playstyle"]')
      .evaluateAll((els) => els.map((el) => el.textContent!.trim()));
    expect(published.length).toBeGreaterThan(3);

    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "evidence");
    const options = () =>
      page
        .getByTestId("playstyle-filter")
        .locator("option")
        .evaluateAll((els) => els.map((el) => el.textContent!.trim()));
    // The contract is a SEPARATE request from the search, so poll rather than
    // sampling once: an unresolved methodology fetch leaves the select holding
    // only its "Any Playstyle" default, which is correct-but-not-yet-loaded.
    await expect.poll(async () => (await options()).length).toBe(published.length + 1);
    const offered = await options();
    expect(offered[0]).toBe("Any Playstyle");
    expect(offered.slice(1)).toEqual(published);

    // ...and concerns are deliberately NOT offered: `playstyle=` matches a
    // qualifying positive badge, so a concern key would silently return nothing.
    const concerns = await page.goto("/methodology").then(async () => {
      await page.getByTestId("methodology-contents").waitFor();
      return page
        .locator('#playstyles [data-tag-variant="concern"]')
        .evaluateAll((els) => els.map((el) => el.textContent!.trim()));
    });
    expect(concerns.length).toBeGreaterThan(0);
    for (const concern of concerns) expect(offered).not.toContain(concern);
  });
});

// ---------------------------------------------------------------------------
// Context search, against the real fixture-backed API
//
// No mocked frontend filtering anywhere here: these drive the production build
// against the committed sample cohort and read the rows the database returned.
// Clubs the sample does not contain (Tottenham and the rest of the alias registry)
// are covered by `apps/api/app/tests/test_discovery_context_search.py` against an
// isolated synthetic database, rather than by inventing production players.
// ---------------------------------------------------------------------------
test.describe("Context search", () => {
  test("nationality matches a partial country", async ({ page }) => {
    await page.goto("/?page_size=100&nationality=England");
    const full = await ledgerNames(page);
    expect(full.length).toBeGreaterThan(0);

    // The defect: `Eng` used to return nothing, because the predicate was equality.
    for (const partial of ["Eng", "eng", "ENGLAND", "gland"]) {
      await page.goto(`/?page_size=100&nationality=${partial}`);
      expect(await ledgerNames(page), partial).toEqual(full);
    }
  });

  test("nationality is typeable and readable in the rail", async ({ page }) => {
    await page.goto("/?page_size=100");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "context");
    await page.getByTestId("nationality-filter").pressSequentially("Eng", { delay: 40 });
    await expect(page).toHaveURL(/nationality=Eng/);
    expect((await ledgerNames(page)).length).toBeGreaterThan(0);
    await expect(page.getByTestId("active-criteria-summary")).toContainText("Nationality: Eng");
  });

  test("league matches a country as well as a code and a name", async ({ page }) => {
    // "England" appears only in the stored competition country, so this can only
    // succeed through the Phase 8.2 addition.
    await page.goto("/?page_size=100&league=England");
    const byCountry = await ledgerNames(page);
    expect(byCountry.length).toBeGreaterThan(0);

    await page.goto("/?page_size=100&league=eng");
    const byCode = await ledgerNames(page);
    expect(byCode).toEqual(byCountry);

    // every returned row really is in an English competition
    await page.getByTestId("results-ledger").waitFor();
    for (const row of await page.locator('[data-testid="result-row"]').all()) {
      const text = await row.innerText();
      expect(text).toMatch(/Premier League|Championship/);
    }

    // ...and the other top-five countries answer too
    for (const [needle, league] of [
      ["Spain", /La Liga/],
      ["Italy", /Serie A/],
      ["Germany", /Bundesliga/],
      ["France", /Ligue 1|Ligue 2/],
      ["Portugal", /Primeira Liga/],
    ] as const) {
      await page.goto(`/?page_size=100&league=${needle}`);
      await page.getByTestId("results-ledger").waitFor();
      const rows = await page.locator('[data-testid="result-row"]').all();
      expect(rows.length, needle).toBeGreaterThan(0);
      for (const row of rows) expect(await row.innerText(), needle).toMatch(league);
    }
  });

  test("the portgual misspelling resolves to Portugal", async ({ page }) => {
    await page.goto("/?page_size=100&league=Portugal");
    const portugal = await ledgerNames(page);
    expect(portugal.length).toBeGreaterThan(0);

    await page.goto("/?page_size=100&league=portgual");
    expect(await ledgerNames(page)).toEqual(portugal);
    await expect(page.getByTestId("active-criteria-summary")).toContainText("League: portgual");
  });

  test("a club abbreviation finds the club, through Club and through Search", async ({ page }) => {
    // PSG is in the committed sample, so this is real fixture data end to end.
    await page.goto("/?page_size=100&club=Paris");
    const byName = await ledgerNames(page);
    expect(byName.length).toBeGreaterThan(0);

    for (const alias of ["psg", "PSG", "P.S.G.", "Paris SG"]) {
      await page.goto(`/?page_size=100&club=${encodeURIComponent(alias)}`);
      expect(await ledgerNames(page), alias).toEqual(byName);
      for (const row of await page.locator('[data-testid="result-row"]').all()) {
        expect(await row.innerText(), alias).toContain("Paris Saint-Germain");
      }
    }

    // ...and the same abbreviation typed into the main search box
    await page.goto("/?page_size=100&q=psg");
    expect(await ledgerNames(page)).toEqual(byName);
  });

  test("a club abbreviation is typeable and stays readable as typed", async ({ page }) => {
    await page.goto("/?page_size=100");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "context");
    await page.getByTestId("club-filter").pressSequentially("psg", { delay: 40 });
    await expect(page).toHaveURL(/club=psg/);
    expect((await ledgerNames(page)).length).toBeGreaterThan(0);
    // The rail reports what the scout asked for, not the clubs it resolved to.
    await expect(page.getByTestId("active-criteria-summary")).toContainText("Club: psg");
  });

  test("a multi-word club name can be typed one character at a time", async ({ page }) => {
    await page.goto("/?page_size=100");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "context");
    const club = page.getByTestId("club-filter");
    // Trimming a controlled input naively would swallow the space after "Paris".
    await club.pressSequentially("Paris Saint-Germain", { delay: 30 });
    await expect(club).toHaveValue("Paris Saint-Germain");
    await expect(page).toHaveURL(/club=Paris\+Saint-Germain/);
    expect((await ledgerNames(page)).length).toBeGreaterThan(0);
  });

  test("outer whitespace never reaches the URL or the summary", async ({ page }) => {
    await page.goto("/?page_size=100");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "context");
    const club = page.getByTestId("club-filter");
    await club.pressSequentially("  Paris  ", { delay: 20 });
    await expect(page).toHaveURL(/club=Paris(&|$)/);
    await expect(page.getByTestId("active-criteria-summary")).toContainText("Club: Paris");
    expect((await ledgerNames(page)).length).toBeGreaterThan(0);
    // ...and blurring settles the visible field on the trimmed value
    await page.getByTestId("league-filter").click();
    await expect(club).toHaveValue("Paris");
  });

  test("Context filters compose with the rest of the request", async ({ page }) => {
    await page.goto("/?page_size=100&club=psg&league=France");
    const both = await ledgerNames(page);
    expect(both.length).toBeGreaterThan(0);
    await expect(page.getByTestId("result-count")).toContainText("2 active criteria");

    await page.goto("/?page_size=100&club=psg&league=Italy");
    await expect(page.getByText("No players match these filters")).toBeVisible();
    // ...and the zero-result state is still recoverable in place
    await page.getByTestId("active-criteria-toggle").click();
    await page.getByTestId("remove-criterion-league").click();
    expect(await ledgerNames(page)).toEqual(both.slice(0, both.length));
  });

  test("the Context helper copy states all three rules", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "context");
    const help = page.locator("#advanced-context-help");
    await expect(help).toContainText("League matches name, country, or code");
    await expect(help).toContainText("Club accepts names and common aliases");
    await expect(help).toContainText("Nationality matches any part of the country");
    await expect(help).toContainText("All ignore case");
  });
});

// ---------------------------------------------------------------------------
// Disclosure behaviour
// ---------------------------------------------------------------------------
test.describe("Progressive disclosure", () => {
  test("opens and closes from the keyboard with Enter and with Space", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const toggle = page.getByTestId("advanced-filters-toggle");

    await toggle.focus();
    await expect(toggle).toBeFocused();
    // a visible focus ring, not a delayed or absent one
    expect(
      parseFloat(await toggle.evaluate((el) => getComputedStyle(el).outlineWidth)),
    ).toBeGreaterThan(0);

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press(" ");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press(" ");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("opens each category from the keyboard, one at a time", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page);

    const market = page.getByTestId("advanced-category-toggle-market");
    await market.focus();
    await page.keyboard.press("Enter");
    await expect(market).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("advanced-category-toggle-context")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    const evidence = page.getByTestId("advanced-category-toggle-evidence");
    await evidence.focus();
    await page.keyboard.press(" ");
    await expect(evidence).toHaveAttribute("aria-expanded", "true");
    await expect(market).toHaveAttribute("aria-expanded", "false");
    // exactly one category open at any moment
    expect(
      await page
        .locator('[data-testid^="advanced-category-toggle-"][aria-expanded="true"]')
        .count(),
    ).toBe(1);
  });

  test("closing a disclosure changes neither the URL nor the ledger", async ({ page }) => {
    await page.goto("/?league=Bundesliga");
    await page.getByTestId("results-ledger").waitFor();
    const before = await ledgerNames(page);
    const url = page.url();

    await openAdvanced(page, "market");
    await page.getByTestId("advanced-category-toggle-market").click();
    await page.getByTestId("advanced-filters-toggle").click();

    expect(page.url()).toBe(url);
    expect(await ledgerNames(page)).toEqual(before);
    // ...and the value is still in the control and still in the request
    await openAdvanced(page, "context");
    await expect(page.getByTestId("league-filter")).toHaveValue("Bundesliga");
  });

  test("traps focus nowhere: Tab walks straight out of an open region", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "market");

    await page.getByTestId("value-max-filter").focus();
    // Escape is not required for an inline disclosure, but it must not swallow it
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("advanced-category-fields-market")).toBeVisible();

    // tabbing forward leaves the region rather than cycling inside it
    const inside = async () =>
      page.evaluate(
        () => !!document.activeElement?.closest('[data-testid="advanced-filters"]'),
      );
    let escaped = false;
    for (let i = 0; i < 8 && !escaped; i += 1) {
      await page.keyboard.press("Tab");
      escaped = !(await inside());
    }
    expect(escaped, "focus never left the advanced region").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compound filtering, hard load, reload, back/forward
// ---------------------------------------------------------------------------
test.describe("Compound URL-backed filtering", () => {
  test("a hard-loaded compound link restores every control and narrows the ledger", async ({
    page,
  }) => {
    await page.goto("/?page_size=100");
    const unfiltered = await ledgerNames(page);
    expect(unfiltered.length).toBeGreaterThan(3);

    await page.goto(`${COMPOUND}&page_size=100`);
    const filtered = await ledgerNames(page);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(unfiltered.length);

    // every control agrees with the URL that produced the ledger
    await expect(page.getByTestId("search-input")).toHaveValue("a");
    await expect(page.getByTestId("position-group-filter")).toHaveValue("ATT");
    await expect(page.getByTestId("sort-filter")).toHaveValue("name_asc");
    await openAdvanced(page, "context");
    await expect(page.getByTestId("league-filter")).toHaveValue("Bundesliga");
    await openAdvanced(page, "evidence");
    await expect(page.getByTestId("min-minutes-filter")).toHaveValue("450");
    await expect(page.getByTestId("rolefit-min-filter")).toHaveValue("40");

    // AND semantics: every returned row satisfies every predicate at once
    for (const row of await page.locator('[data-testid="result-row"]').all()) {
      const text = await row.innerText();
      expect(text.toLowerCase()).toContain("a");
      expect(text).toContain("Bundesliga");
      const mins = Number(/(\d+)\s*min/.exec(text)?.[1] ?? "0");
      expect(mins).toBeGreaterThanOrEqual(450);
      const score = Number(
        await row.locator('[data-testid="score-readout"] > div').first().innerText(),
      );
      expect(score).toBeGreaterThanOrEqual(40);
    }
    // ...and the sort still applies on top of the predicates
    expect(filtered).toEqual([...filtered].sort((a, b) => a.localeCompare(b, "en")));
  });

  test("the active state of a hard-loaded advanced filter is obvious immediately", async ({
    page,
  }) => {
    await page.goto("/?value_min=1000000");
    await page.getByTestId("results-ledger").waitFor();
    // Advanced Filters opens onto the category the URL is actually using
    await expect(page.getByTestId("advanced-filters-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByTestId("advanced-category-toggle-market")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByTestId("value-min-filter")).toHaveValue("1");
    await expect(page.getByTestId("active-criteria-count")).toHaveText("1 Active Criterion");
    await expect(page.getByTestId("result-count")).toContainText("1 active criterion");
  });

  test("reload reproduces the same request and the same ledger", async ({ page }) => {
    await page.goto(`${COMPOUND}&page_size=100`);
    const before = await ledgerNames(page);
    const total = await reportedTotal(page);

    await page.reload();
    expect(await ledgerNames(page)).toEqual(before);
    expect(await reportedTotal(page)).toBe(total);
    await openAdvanced(page, "context");
    await expect(page.getByTestId("league-filter")).toHaveValue("Bundesliga");
  });

  test("browser back and forward restore the same state", async ({ page }) => {
    await page.goto("/?league=Bundesliga");
    await page.getByTestId("results-ledger").waitFor();
    const bundesliga = await ledgerNames(page);

    await page.goto("/?min_minutes=1500");
    await page.getByTestId("results-ledger").waitFor();
    const minutes = await ledgerNames(page);
    expect(minutes).not.toEqual(bundesliga);

    await page.goBack();
    await expect(page).toHaveURL(/league=Bundesliga/);
    expect(await ledgerNames(page)).toEqual(bundesliga);
    await openAdvanced(page, "context");
    await expect(page.getByTestId("league-filter")).toHaveValue("Bundesliga");
    await expect(page.getByTestId("min-minutes-filter")).toHaveValue("");

    await page.goForward();
    await expect(page).toHaveURL(/min_minutes=1500/);
    expect(await ledgerNames(page)).toEqual(minutes);
    await openAdvanced(page, "evidence");
    await expect(page.getByTestId("min-minutes-filter")).toHaveValue("1500");
    await expect(page.getByTestId("league-filter")).toHaveValue("");
  });

  test("typing an advanced predicate adds no history entry per keystroke", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    const depth = await page.evaluate(() => history.length);

    await openAdvanced(page, "context");
    await page.getByTestId("club-filter").pressSequentially("Lever", { delay: 20 });
    await expect(page).toHaveURL(/club=Lever/);
    expect(await page.evaluate(() => history.length)).toBe(depth);
  });
});

// ---------------------------------------------------------------------------
// Expected asking, in the browser
// ---------------------------------------------------------------------------
test.describe("Expected-asking bounds", () => {
  test("types millions, requests absolute EUR, and narrows honestly", async ({ page }) => {
    await page.goto("/?page_size=100");
    const all = await ledgerNames(page);

    await openAdvanced(page, "market");
    await page.getByTestId("value-min-filter").fill("40");
    await expect(page).toHaveURL(/value_min=40000000/);

    const narrowed = await ledgerNames(page);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThan(all.length);
    // the control still reads in millions
    await expect(page.getByTestId("value-min-filter")).toHaveValue("40");
    // and the readable summary uses the shared currency formatter
    await page.getByTestId("active-criteria-toggle").click();
    await expect(page.getByTestId("active-criterion").first()).toContainText("€40.0M");
  });

  test("never sends a minimum above a maximum, whichever side is edited", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/players?")) requests.push(r.url());
    });

    await page.goto("/?value_max=30000000");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "market");
    await page.getByTestId("value-min-filter").fill("50");
    await expect(page).toHaveURL(/value_min=50000000/);
    await expect(page).toHaveURL(/value_max=50000000/);
    await expect(page.getByTestId("value-max-filter")).toHaveValue("50");

    await page.getByTestId("value-max-filter").fill("12");
    await expect(page).toHaveURL(/value_min=12000000/);
    await expect(page.getByTestId("value-min-filter")).toHaveValue("12");

    // No request ever carried an inverted range, which the API answers with a 422.
    for (const url of requests) {
      const params = new URL(url).searchParams;
      const min = params.get("value_min");
      const max = params.get("value_max");
      if (min != null && max != null) expect(Number(min), url).toBeLessThanOrEqual(Number(max));
    }
    // ...and the ledger is a real result, never a validation error
    await expect(page.getByText("Failed to load players")).toHaveCount(0);
  });

  test("survives real sequential typing of a decimal", async ({ page }) => {
    // The parser always understood "12.5"; the CONTROL did not. As a plain controlled
    // number input the intermediate "12." was sanitized back to "12" before the "5"
    // could be typed. `fill()` sets the whole value at once and cannot show this, so
    // this presses one key at a time — which is how the defect was found.
    await page.goto("/?page_size=100");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "market");

    const min = page.getByTestId("value-min-filter");
    await min.click();
    await min.pressSequentially("12.5", { delay: 40 });
    await expect(min).toHaveValue("12.5");
    await expect(page).toHaveURL(/value_min=12500000/);

    // ...and the same for the maximum, with a leading zero and a long decimal
    const max = page.getByTestId("value-max-filter");
    await max.click();
    await max.pressSequentially("120.75", { delay: 40 });
    await expect(max).toHaveValue("120.75");
    await expect(page).toHaveURL(/value_max=120750000/);
    await expect(page.getByText("Failed to load players")).toHaveCount(0);
  });

  test("supports keyboard editing, paste, and clearing", async ({ page }) => {
    await page.goto("/?value_min=12500000");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "market");
    const min = page.getByTestId("value-min-filter");
    await expect(min).toHaveValue("12.5");

    // backspace through the decimal and retype it
    await min.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await expect(min).toHaveValue("12.");
    await page.keyboard.press("Backspace");
    await min.pressSequentially(".75", { delay: 40 });
    await expect(min).toHaveValue("12.75");
    await expect(page).toHaveURL(/value_min=12750000/);

    // paste replaces the whole value in one input event
    await min.selectText();
    await page.keyboard.insertText("30.25");
    await expect(min).toHaveValue("30.25");
    await expect(page).toHaveURL(/value_min=30250000/);

    // clearing removes the bound entirely
    await min.selectText();
    await page.keyboard.press("Backspace");
    await expect(min).toHaveValue("");
    await expect(page).not.toHaveURL(/value_min/);
  });

  test("a malformed draft is held but never sent, and snaps back on blur", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/players?")) requests.push(r.url());
    });

    await page.goto("/?value_min=40000000");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "market");
    const min = page.getByTestId("value-min-filter");

    await min.selectText();
    await page.keyboard.insertText("1.2.3");
    await expect(min).toHaveValue("1.2.3");
    await expect(min).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/value_min=40000000/);

    await page.getByTestId("value-max-filter").click(); // blur
    await expect(min).toHaveValue("40");
    await expect(min).not.toHaveAttribute("aria-invalid", "true");

    for (const url of requests) {
      const value = new URL(url).searchParams.get("value_min");
      expect(value === null || Number.isFinite(Number(value)), url).toBe(true);
    }
  });

  test("a typed decimal survives reload and back/forward", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "market");
    await page.getByTestId("value-min-filter").pressSequentially("12.5", { delay: 40 });
    await expect(page).toHaveURL(/value_min=12500000/);

    await page.reload();
    await openAdvanced(page, "market");
    await expect(page.getByTestId("value-min-filter")).toHaveValue("12.5");

    await page.goto("/?value_min=30250000");
    await openAdvanced(page, "market");
    await expect(page.getByTestId("value-min-filter")).toHaveValue("30.25");
    await page.goBack();
    await openAdvanced(page, "market");
    await expect(page.getByTestId("value-min-filter")).toHaveValue("12.5");
  });

  test("removing the criterion clears a drafted field", async ({ page }) => {
    await page.goto("/?value_min=40000000");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "market");
    await page.getByTestId("value-min-filter").selectText();
    await page.keyboard.insertText("9.");
    await expect(page.getByTestId("value-min-filter")).toHaveValue("9.");

    await page.getByTestId("active-criteria-toggle").click();
    await page.getByTestId("remove-criterion-value_min").click();
    await expect(page.getByTestId("value-min-filter")).toHaveValue("");
    await expect(page).not.toHaveURL(/value_min/);
  });

  test("keeps a RoleFit floor and ceiling coherent and still filtering", async ({ page }) => {
    await page.goto("/?page_size=100");
    await openAdvanced(page, "evidence");
    await page.getByTestId("rolefit-min-filter").fill("40");
    await page.getByTestId("rolefit-max-filter").fill("70");
    await expect(page).toHaveURL(/rolefit_min=40/);
    await expect(page).toHaveURL(/rolefit_max=70/);

    for (const row of await page.locator('[data-testid="result-row"]').all()) {
      const score = Number(
        await row.locator('[data-testid="score-readout"] > div').first().innerText(),
      );
      expect(score).toBeGreaterThanOrEqual(40);
      expect(score).toBeLessThanOrEqual(70);
    }

    // pushing the floor past the ceiling moves the ceiling, and still returns rows
    await page.getByTestId("rolefit-min-filter").fill("80");
    await expect(page).toHaveURL(/rolefit_max=80/);
    await expect(page.getByText("Failed to load players")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Active criteria: removal, reset, recovery
// ---------------------------------------------------------------------------
test.describe("Active criteria", () => {
  test("removes one criterion, keeps the rest, and resets the page", async ({ page }) => {
    await page.goto("/?q=a&club=e&min_minutes=450&page_size=2&page=2");
    await page.getByTestId("results-ledger").waitFor();
    await expect(page.getByTestId("result-count")).toContainText("page 2 of");

    await page.getByTestId("active-criteria-toggle").click();
    await expect(page.getByTestId("active-criterion")).toHaveCount(3);
    await page.getByTestId("remove-criterion-club").click();

    await expect(page).not.toHaveURL(/club=/);
    await expect(page).toHaveURL(/q=a/);
    await expect(page).toHaveURL(/min_minutes=450/);
    await expect(page).not.toHaveURL(/[?&]page=/);
    await expect(page.getByTestId("result-count")).toContainText("page 1 of");
    await expect(page.getByTestId("active-criterion")).toHaveCount(2);
  });

  test("leaves focus somewhere usable after a removal", async ({ page }) => {
    await page.goto("/?league=Bundesliga&club=Bayer&min_minutes=450");
    await page.getByTestId("results-ledger").waitFor();
    await page.getByTestId("active-criteria-toggle").click();

    const remove = page.getByTestId("remove-criterion-club");
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("active-criterion")).toHaveCount(2);

    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        body: el === document.body || el == null,
        inRail: !!el?.closest('[data-testid="filter-rail"]'),
        testid: el?.dataset.testid ?? "",
      };
    });
    expect(focus.body, "focus fell back to <body>").toBe(false);
    expect(focus.inRail).toBe(true);
  });

  test("Clear All returns to the clean root URL and the full cohort", async ({ page }) => {
    await page.goto("/?page_size=100");
    const all = await ledgerNames(page);

    await page.goto(
      "/?q=a&age_max=25&position_group=ATT&league=Bundesliga&min_minutes=450&rolefit_min=40&sort=name_asc&page_size=100",
    );
    const narrowed = await ledgerNames(page);
    expect(narrowed.length).toBeLessThan(all.length);

    await page.getByTestId("clear-all-filters").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("active-criteria")).toHaveCount(0);
    await expect(page.getByTestId("sort-filter")).toHaveValue("rolefit_desc");
    // the default page size is back, so the ledger reports the default pagination
    await expect(page.getByTestId("result-count")).toContainText("page 1 of");
    expect(await reportedTotal(page)).toBe(all.length);
  });

  test("Clear All strips a legacy scope-bearing URL from the canonical address", async ({
    page,
  }) => {
    await page.goto("/?scope=all_records&universe=mvp&age_band=u23&league=Bundesliga");
    await page.getByTestId("results-ledger").waitFor();
    await page.getByTestId("clear-all-filters").click();
    await expect(page).toHaveURL(/\/$/);
    expect(new URL(page.url()).search).toBe("");
  });

  test("Clear All does not disturb favourites or the compare queue", async ({ page }) => {
    await page.goto("/?league=Bundesliga");
    await page.getByTestId("results-ledger").waitFor();
    const name = (await page.getByTestId("player-result").first().innerText()).trim();
    await page.getByTestId("favorite-action").first().click();
    await page.getByTestId("compare-action").first().click();

    await page.getByTestId("clear-all-filters").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("compare-tray")).toContainText(name);
    await page.goto("/shortlist");
    await expect(page.getByTestId("shortlist-ledger")).toContainText(name);
  });

  test("a zero-result ledger is recoverable without a reload", async ({ page }) => {
    await page.goto("/?league=Bundesliga&club=NoSuchClubAnywhere");
    await expect(page.getByText("No players match these filters")).toBeVisible();
    // the rail is untouched and says how to get out
    await expect(page.getByTestId("filter-rail")).toBeVisible();
    await expect(page.getByText(/Remove one of the 2 active criteria/)).toBeVisible();

    await page.getByTestId("active-criteria-toggle").click();
    await page.getByTestId("remove-criterion-club").click();
    await expect(page.getByTestId("results-ledger")).toBeVisible();
    expect((await ledgerNames(page)).length).toBeGreaterThan(0);
  });

  test("Clear All also recovers a zero-result ledger", async ({ page }) => {
    await page.goto("/?club=NoSuchClubAnywhere&rolefit_min=99");
    await expect(page.getByText("No players match these filters")).toBeVisible();
    await page.getByTestId("clear-all-filters").click();
    await expect(page.getByTestId("results-ledger")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("truncates a very long value instead of widening the rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const needle = "Maximiliaan-Van-Der-Steenhuizen-Oppenheimer".repeat(2);
    await page.goto(`/?q=${needle}`);
    await page.getByTestId("filter-rail").waitFor();

    const rail = (await page.getByTestId("filter-rail").boundingBox())!;
    expect(rail.width).toBeLessThanOrEqual(280);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

    const summary = page.getByTestId("active-criteria-summary");
    await expect(summary).toHaveCSS("text-overflow", "ellipsis");
    // it really is clipped rather than laid out wider than its box
    expect(
      await summary.evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);

    await page.getByTestId("active-criteria-toggle").click();
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    expect((await page.getByTestId("filter-rail").boundingBox())!.width).toBeLessThanOrEqual(280);
  });
});

// ---------------------------------------------------------------------------
// Responsive geometry
// ---------------------------------------------------------------------------
const VIEWPORTS = [
  { name: "narrow-320", width: 320, height: 720 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "zoom-640", width: 640, height: 720 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 900 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "desktop-1440", width: 1440, height: 900 },
] as const;

test.describe("Responsive geometry", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: collapsed and expanded both fit without horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/?q=a&league=e&rolefit_max=95&value_min=1000000");
      await page.getByTestId("results-ledger").waitFor();

      expect(await pageOverflow(page), `collapsed @ ${vp.name}`).toBeLessThanOrEqual(1);

      await page.getByTestId("active-criteria-toggle").click();
      expect(await pageOverflow(page), `criteria @ ${vp.name}`).toBeLessThanOrEqual(1);

      for (const category of ["context", "evidence", "market"]) {
        // Idempotent: this URL already opened Advanced Filters onto Context, so a
        // blind click would CLOSE the very category being measured.
        await openAdvanced(page, category);
        expect(
          await pageOverflow(page),
          `${category} @ ${vp.name}`,
        ).toBeLessThanOrEqual(1);

        // nothing inside the open category is clipped or collapsed to nothing
        const boxes = await page
          .locator(`[data-testid="advanced-category-fields-${category}"] .input`)
          .evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return { w: Math.round(r.width), h: Math.round(r.height) };
            }),
          );
        expect(boxes.length).toBeGreaterThan(0);
        for (const box of boxes) {
          expect(box.w, `field width @ ${vp.name}`).toBeGreaterThanOrEqual(100);
          expect(box.h, `field height @ ${vp.name}`).toBeGreaterThanOrEqual(24);
        }
      }
    });

    test(`${vp.name}: every rail control keeps a usable target and a visible name`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/?league=e&value_min=1000000");
      await page.getByTestId("results-ledger").waitFor();
      await page.getByTestId("active-criteria-toggle").click();
      await page.getByTestId("advanced-category-toggle-context").click();

      const offenders = await page.evaluate(() => {
        const rail = document.querySelector<HTMLElement>('[data-testid="filter-rail"]')!;
        const bad: string[] = [];
        for (const el of Array.from(
          rail.querySelectorAll<HTMLElement>("button, input, select"),
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue; // inside a closed region
          const id = el.dataset.testid ?? el.tagName;
          if (r.width < 24 || r.height < 24) bad.push(`${id} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return bad;
      });
      expect(offenders, `targets @ ${vp.name}`).toEqual([]);

      // the disclosure rows and the remove actions all carry accessible names
      for (const id of ["advanced-filters-toggle", "active-criteria-toggle", "clear-all-filters", "remove-criterion-league"]) {
        await expect(page.getByTestId(id), `${id} @ ${vp.name}`).not.toHaveAccessibleName("");
      }
    });
  }

  test("the rail and the ledger keep a shared top edge on every desktop width", async ({
    page,
  }) => {
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/?league=Bundesliga");
      await page.getByTestId("results-ledger").waitFor();

      const rail = (await page.getByTestId("filter-rail").boundingBox())!;
      const ledger = (await page.getByTestId("results-ledger").boundingBox())!;
      expect(Math.abs(rail.y - ledger.y), `alignment @ ${width}`).toBeLessThanOrEqual(1);
      expect(rail.width, `rail track @ ${width}`).toBeGreaterThanOrEqual(240);
      expect(rail.width, `rail track @ ${width}`).toBeLessThanOrEqual(280);

      // ...and it stays aligned once the criteria list is open
      await page.getByTestId("active-criteria-toggle").click();
      const railOpen = (await page.getByTestId("filter-rail").boundingBox())!;
      const ledgerOpen = (await page.getByTestId("results-ledger").boundingBox())!;
      expect(Math.abs(railOpen.y - ledgerOpen.y), `alignment open @ ${width}`).toBeLessThanOrEqual(
        1,
      );
      expect(railOpen.width, `rail track open @ ${width}`).toBeLessThanOrEqual(280);
    }
  });

  test("focus order follows visual order in the expanded rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/?league=Bundesliga");
    await page.getByTestId("results-ledger").waitFor();
    await page.getByTestId("active-criteria-toggle").click();
    await page.getByTestId("advanced-category-toggle-context").click();

    await page.getByTestId("active-criteria-toggle").focus();
    const seen: Array<{ id: string; y: number; x: number }> = [];
    for (let i = 0; i < 16; i += 1) {
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest('[data-testid="filter-rail"]')) return null;
        const r = el.getBoundingClientRect();
        return { id: el.dataset.testid ?? el.tagName, y: Math.round(r.y), x: Math.round(r.x) };
      });
      if (!info) break;
      seen.push(info);
      await page.keyboard.press("Tab");
    }

    expect(seen.length).toBeGreaterThan(8);
    // Each stop is at or below the previous one; ties are resolved left to right.
    // A single narrow column means no control may ever be visited out of order.
    for (let i = 1; i < seen.length; i += 1) {
      const previous = seen[i - 1];
      const current = seen[i];
      const forward = current.y > previous.y || (current.y === previous.y && current.x >= previous.x);
      expect(forward, `${previous.id} -> ${current.id}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------
test.describe("Disclosure motion", () => {
  test("animates no layout property when a region opens", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/?league=Bundesliga");
    await page.getByTestId("results-ledger").waitFor();
    await openAdvanced(page, "evidence");

    const LAYOUT = [
      "height",
      "width",
      "top",
      "left",
      "right",
      "bottom",
      "margin",
      "padding",
      "grid-template-columns",
      "grid-template-rows",
      "inset",
      "flex",
      "font-size",
    ];
    const declared = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('[data-testid="filter-rail"]')!;
      return Array.from(rail.querySelectorAll<HTMLElement>("*"))
        .concat(rail)
        .flatMap((el) => {
          const s = getComputedStyle(el);
          return [s.transitionProperty, s.animationName].filter(
            (v) => v && v !== "none" && v !== "all",
          );
        });
    });
    for (const value of declared) {
      for (const prop of LAYOUT) {
        expect(value.split(/,\s*/), `animated ${prop}`).not.toContain(prop);
      }
    }
  });

  test("opens immediately under reduced motion, with the same final state", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByTestId("results-ledger").waitFor();

    await page.getByTestId("advanced-filters-toggle").click();
    // no animation to wait out: the fields are laid out in the same frame
    await expect(page.getByTestId("advanced-category-fields-context")).toBeVisible();
    expect(
      (await page.getByTestId("league-filter").boundingBox())!.height,
    ).toBeGreaterThan(24);
    const animations = await page.evaluate(
      () =>
        document
          .querySelector('[data-testid="filter-rail"]')!
          .getAnimations({ subtree: true }).length,
    );
    expect(animations).toBe(0);
  });
});
