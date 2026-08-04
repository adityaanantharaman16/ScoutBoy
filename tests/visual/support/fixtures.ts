import { expect, type Page, type Response } from "@playwright/test";

/**
 * Deterministic fixture identities for the visual suite.
 *
 * `scripts/run_visual.sh` guarantees the API is backed by a freshly migrated
 * database seeded from the committed `sample` provider and recomputed in the same
 * run. What it cannot guarantee is a *primary key*: ids are an artefact of
 * insertion order, not part of the fixture contract. The same two players are ids
 * 7 and 20 in a fresh sample database and ids 6 and 17 in the developer's pilot
 * database — which is precisely how `/compare?a=6&b=17` came to render two
 * different pairs of players in two different runs while the committed baseline
 * silently claimed a third.
 *
 * So scenarios that depend on *which* players they are looking at select them by
 * canonical name through the real controls, and assert what they actually got
 * before anything is captured.
 */

/**
 * A genuinely disjoint pair in the sample cohort: Anton Keller is rated only in
 * forward roles (complete forward, inside forward, pressing forward, shadow
 * striker) and Karim Nasser only in central-midfield roles (ball-winning
 * midfielder, deep-lying playmaker, tempo controller). Neither is unrated, so the
 * neutral state is reached for the right reason. `expectNoSharedRatedRole` proves
 * all of that from the API response rather than trusting this comment.
 */
export const NO_SHARED_ROLE_PAIR = {
  a: "Anton Keller",
  b: "Karim Nasser",
} as const;

/**
 * Drives the real comparison controls to two players chosen by visible name and
 * returns the `/api/compare` response that produced the rendered state.
 *
 * A missing option is reported as a readable list of what the fixture database
 * actually contains, rather than as a selector timeout.
 */
export async function compareByName(page: Page, aName: string, bName: string): Promise<Response> {
  await page.goto("/compare");

  // The selectors are populated asynchronously from `/api/players`, so poll for
  // the cohort instead of racing the placeholder-only first render. A name that
  // never appears is reported alongside the cohort that actually loaded.
  await expect
    .poll(() => page.getByTestId("compare-a").locator("option").allTextContents(), {
      message:
        `fixture players "${aName}" and "${bName}" must both be selectable on /compare — ` +
        "the visual suite requires the committed sample cohort",
      timeout: 15_000,
    })
    .toEqual(expect.arrayContaining([aName, bName]));

  // `useCompare` only fires once both sides are set, so a single compare request
  // follows the second selection.
  const compareResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/compare") && response.request().method() === "GET",
  );
  await page.getByTestId("compare-a").selectOption({ label: aName });
  await page.getByTestId("compare-b").selectOption({ label: bName });

  const response = await compareResponse;
  expect(response.ok(), `compare API must answer for ${aName} vs ${bName}`).toBeTruthy();
  return response;
}

/**
 * Proves, from the response the UI actually rendered, that this is the intended
 * no-shared-role scenario: the two intended players, both genuinely rated, with
 * an empty role intersection and therefore no automatic role.
 */
export async function expectNoSharedRatedRole(
  response: Response,
  aName: string,
  bName: string,
): Promise<void> {
  const body = await response.json();

  expect(body.player_a.identity.canonical_name, "player 1 identity").toBe(aName);
  expect(body.player_b.identity.canonical_name, "player 2 identity").toBe(bName);

  const rolesA: string[] = body.player_a.role_ratings.map(
    (rating: { role_key: string }) => rating.role_key,
  );
  const rolesB: string[] = body.player_b.role_ratings.map(
    (rating: { role_key: string }) => rating.role_key,
  );

  // An unrated player would produce the same neutral state for the wrong reason,
  // so both sides must actually carry ratings.
  expect(rolesA.length, `${aName} must be rated in at least one role`).toBeGreaterThan(0);
  expect(rolesB.length, `${bName} must be rated in at least one role`).toBeGreaterThan(0);
  expect(
    rolesA.filter((role) => rolesB.includes(role)),
    `${aName} (${rolesA.join(", ")}) and ${bName} (${rolesB.join(", ")}) must share no rated role`,
  ).toEqual([]);

  // ...and that the API drew the same conclusion rather than the UI hiding a role.
  expect(body.role_key, "compare API must select no role").toBeNull();
}
