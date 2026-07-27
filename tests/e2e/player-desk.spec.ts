import { expect, test, type Route } from "@playwright/test";

// These states (profile-only, low confidence, unknown audit group, missing
// market) are intentionally NOT present in the committed sample dataset, so we
// synthesise them by intercepting the API and lightly editing the REAL response
// shapes. This keeps the tests honest about contract shape without mutating the
// production seed.

const PLAYER = 6;

async function editJson(route: Route, mutate: (json: any) => void) {
  const response = await route.fetch();
  const json = await response.json();
  mutate(json);
  await route.fulfill({ response, json });
}

test("profile-only players render no role controls or pitch", async ({ page }) => {
  await page.route(`**/api/players/${PLAYER}`, (route) =>
    editJson(route, (j) => {
      j.has_rolefit_analysis = false;
      j.analysis_status = "profile_only";
      j.evidence_status = "profile_only";
      j.confidence = "unknown";
      j.role_ratings = [];
    }),
  );

  await page.goto(`/players/${PLAYER}`);
  await expect(page.getByTestId("player-card")).toBeVisible();
  await expect(page.getByTestId("analysis-unavailable")).toBeVisible();
  // No Recruitment Desk, role selector, or Role Territory for profile-only.
  await expect(page.getByTestId("recruitment-desk")).toHaveCount(0);
  await expect(page.getByTestId("role-selector")).toHaveCount(0);
  await expect(page.getByTestId("role-territory")).toHaveCount(0);
});

test("low selected-role confidence reads uncertain but keeps the high magnitude", async ({ page }) => {
  await page.route(`**/api/players/${PLAYER}`, (route) =>
    editJson(route, (j) => {
      if (Array.isArray(j.role_ratings)) {
        for (const r of j.role_ratings) if (r.is_best) r.confidence = "low";
      }
    }),
  );

  await page.goto(`/players/${PLAYER}`);
  const summary = page.getByTestId("selected-role-summary");
  await expect(summary).toBeVisible();
  // magnitude channel unchanged (a real score is still shown)
  await expect(summary).toContainText(/\d\d\.\d/);
  // confidence channel says low
  await expect(summary.getByTestId("confidence-meter")).toHaveAttribute("data-confidence", "low");
  // the pitch surfaces a reliability caveat, not a zeroed score
  await expect(page.getByTestId("role-territory")).toContainText(/directional, not definitive/i);
});

test("an unknown audit group renders as unknown, never zero", async ({ page }) => {
  await page.route(`**/api/players/${PLAYER}/ratings`, (route) =>
    editJson(route, (j) => {
      const best = j.ratings?.find((r: any) => r.is_best) ?? j.ratings?.[0];
      const audit = j.audits?.find((a: any) => a.role_key === best?.role_key) ?? j.audits?.[0];
      const groups = audit?.metric_breakdown?.groups ?? [];
      if (groups.length > 0) {
        groups[0].group_score = null;
        for (const m of groups[0].metrics ?? []) {
          m.present = false;
          m.score = null;
        }
      }
    }),
  );

  await page.goto(`/players/${PLAYER}`);
  const evidence = page.getByTestId("role-evidence-list");
  await expect(evidence).toBeVisible();
  await expect(evidence).toContainText("unknown");
  await expect(evidence).toContainText(/No measured evidence/i);
});

test("missing market data shows an honest fallback in the rail", async ({ page }) => {
  await page.route(`**/api/players/${PLAYER}`, (route) =>
    editJson(route, (j) => {
      j.market = null;
    }),
  );

  await page.goto(`/players/${PLAYER}`);
  await expect(page.getByTestId("evidence-context-rail")).toContainText(/No market data/i);
});

test("role selection and evidence controls are keyboard operable", async ({ page }) => {
  await page.goto(`/players/${PLAYER}`);
  const selector = page.getByTestId("role-selector");
  const tabs = selector.getByRole("tab");
  await tabs.first().focus();
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toBeFocused();

  // evidence controls are reachable and focusable buttons
  const firstEvidence = page.getByTestId("role-evidence-list").getByRole("button").first();
  await firstEvidence.focus();
  await expect(firstEvidence).toBeFocused();
});

test("reduced-motion mode swaps role content without relying on animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/players/${PLAYER}`);
  const selector = page.getByTestId("role-selector");
  const tabs = selector.getByRole("tab");
  const before = await page.getByTestId("selected-role-summary").textContent();
  await tabs.nth(1).click();
  // content is updated immediately (assertion has no artificial wait for motion)
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  const after = await page.getByTestId("selected-role-summary").textContent();
  expect(after).not.toEqual(before);
});
