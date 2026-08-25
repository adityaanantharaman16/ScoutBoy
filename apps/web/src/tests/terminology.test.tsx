/**
 * Milestone 8.5 - cross-surface terminology.
 *
 * The canonical lexicon lives in `docs/milestone_8_5_terminology_audit.md`. This
 * suite is the executable half of it: one place that fails when a surface starts
 * calling a stored concept by a second name.
 *
 * Two kinds of assertion, deliberately:
 *
 *  1. **Source scans** over production sources with comments stripped, generated
 *     artifacts and the test tree excluded. Terminology is a property of the
 *     whole product, not of one component, so a scan is the only thing that can
 *     see a word reappearing on a surface nobody thought to render here. Internal
 *     identifiers (`shortlistIds`, `rolefit_min`, `scoutboy.shortlist.v1`, test
 *     ids, route paths) are compatibility-sensitive and stay exactly as they are,
 *     so each permitted spelling is declared explicitly below rather than hidden
 *     behind a loose regex.
 *  2. **Rendered assertions** for the states a scan cannot see - Unrated versus
 *     Profile Only, the two role contexts, the live-region announcements, and the
 *     accessible names that have to agree with their visible labels.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarketReadout } from "@/components/common";
import { PlayerCompareTable } from "@/components/compare/PlayerCompareTable";
import { PlayerCardHeader } from "@/components/player/PlayerCardHeader";
import { MarketValuePanel } from "@/components/player/MarketValuePanel";
import { ResultCard } from "@/components/search/PlayerSearchResults";
import { WhyThisOrder } from "@/components/search/WhyThisOrder";
import {
  FavoriteHeartButton,
  PlayerActionRow,
  ScoutingLiveRegion,
} from "@/components/common/PlayerActions";
import { SORT_OPTIONS } from "@/lib/constants";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import type {
  CompareResponse,
  MarketPanel,
  PlayerCard,
  PlayerSearchCard,
  RankingExplanation,
} from "@/lib/api/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// ---------------------------------------------------------------------------
// the production corpus
// ---------------------------------------------------------------------------

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Tests are not shipped. `schema.gen.ts` is generated and must never be edited. */
const EXCLUDED_DIRS = ["tests"];
const EXCLUDED_FILES = [join("lib", "api", "schema.gen.ts")];

function productionFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(SRC, full);
    if (EXCLUDED_DIRS.some((d) => rel === d || rel.startsWith(d + sep))) continue;
    if (EXCLUDED_FILES.includes(rel)) continue;
    if (entry.isDirectory()) out.push(...productionFiles(full));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Blanks comments while preserving line structure, so reported lines stay real. */
function stripComments(source: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(?<!:)\/\/[^\n]*/g, blank);
}

interface Offence {
  where: string;
  found: string;
}

/** Every production line that still contains one of `needles`, comments excluded. */
function scan(needles: string[], mask: RegExp[] = []): Offence[] {
  const offences: Offence[] = [];
  for (const file of productionFiles()) {
    let body = stripComments(readFileSync(file, "utf8"));
    for (const pattern of mask) body = body.replace(pattern, " ");
    body.split("\n").forEach((line, i) => {
      for (const needle of needles) {
        if (line.includes(needle)) {
          offences.push({ where: `${relative(SRC, file)}:${i + 1}`, found: needle });
        }
      }
    });
  }
  return offences;
}

/** Same, for patterns rather than literals. */
function scanRegex(pattern: RegExp, mask: RegExp[] = []): Offence[] {
  const offences: Offence[] = [];
  for (const file of productionFiles()) {
    let body = stripComments(readFileSync(file, "utf8"));
    for (const m of mask) body = body.replace(m, " ");
    body.split("\n").forEach((line, i) => {
      for (const hit of line.matchAll(new RegExp(pattern.source, pattern.flags + "g"))) {
        offences.push({ where: `${relative(SRC, file)}:${i + 1}`, found: hit[0] });
      }
    });
  }
  return offences;
}

// ---------------------------------------------------------------------------
// 1. RoleFit
// ---------------------------------------------------------------------------

/**
 * `RoleFit` is a product name with one capitalization. Every other spelling in a
 * production source is an INTERNAL identifier - a query parameter, a sort key, a
 * scale constant, a test id or a local variable - and each permitted form is
 * named here so a new one cannot arrive unnoticed.
 */
const ROLEFIT_INTERNAL_SPELLINGS: RegExp[] = [
  /rolefit_min|rolefit_max|rolefit_desc|rolefit_asc|rolefit_score/g,
  /ROLEFIT_SCALE_MIN|ROLEFIT_SCALE_MAX/g,
  /rolefit-min-filter|rolefit-max-filter|row-rolefit|similar-rolefit/g,
  /has_rolefit_analysis|orders_by_rolefit/g,
  /parseRoleFitThreshold|setRoleFit/g,
  /roleFitMin|roleFitMax|roleFit\b/g,
];

describe("RoleFit is spelled one way", () => {
  it("uses no other capitalization in production copy", () => {
    const offences = scanRegex(
      /[Rr]ole\s?[Ff]it|ROLEFIT|rolefit|roleFit|Rolefit/,
      ROLEFIT_INTERNAL_SPELLINGS,
    ).filter((o) => o.found !== "RoleFit");
    expect(offences).toEqual([]);
  });

  it("never substitutes an ambiguous word for the stored rating", () => {
    // "Score" alone was the leaderboard's column header, one column away from
    // "RoleFit Confidence"; "fit" was the Compare role helper's word for the
    // same stored rating.
    const leaderboard = stripComments(
      readFileSync(join(SRC, "app", "roles", "[roleId]", "page.tsx"), "utf8"),
    );
    expect(leaderboard).toContain("<th className=\"text-right\">RoleFit Score</th>");
    expect(leaderboard).not.toContain("<th className=\"text-right\">Score</th>");

    const compare = stripComments(readFileSync(join(SRC, "app", "compare", "page.tsx"), "utf8"));
    expect(compare).toContain("strongest joint RoleFit");
    expect(compare).not.toContain("strongest joint fit");
  });
});

// ---------------------------------------------------------------------------
// 2. Best Role versus Selected / Result Role
// ---------------------------------------------------------------------------

function searchCard(over: Partial<PlayerSearchCard> = {}): PlayerSearchCard {
  return {
    id: 7,
    canonical_name: "Anton Keller",
    season: "2023/24",
    age: 21,
    club: "Stuttgart",
    league: "Bundesliga",
    primary_position: "CF",
    position_group: "ATT",
    best_role: "shadow_striker",
    best_role_display: "Shadow Striker",
    best_role_score: 88.4,
    best_role_confidence: "high",
    result_role: "shadow_striker",
    result_role_display: "Shadow Striker",
    result_role_score: 88.4,
    result_role_confidence: "high",
    result_role_source: "best_role",
    confidence: "high",
    analysis_status: "analyzed",
    evidence_status: "high_coverage",
    has_rolefit_analysis: true,
    is_high_coverage: true,
    top_playstyles: ["Technical Carrier"],
    minutes: 1800,
    represented_minutes: 1800,
    market_label: "inflated",
    expected_asking_low_eur: 58_500_000,
    expected_asking_high_eur: 87_800_000,
    ...over,
  } as PlayerSearchCard;
}

/** A role-filtered row whose two role contexts genuinely disagree. */
const SELECTED_ROLE_ROW: Partial<PlayerSearchCard> = {
  result_role: "touchline_winger",
  result_role_display: "Touchline Winger",
  result_role_score: 54.8,
  result_role_confidence: "low",
  result_role_source: "selected_role",
  confidence: "low",
};

function renderRow(over: Partial<PlayerSearchCard> = {}) {
  return render(
    <ScoutingStateProvider>
      <ResultCard p={searchCard(over)} />
    </ScoutingStateProvider>,
  );
}

describe("Best Role and Result Role are two named contexts", () => {
  it("shows the Result Role on a role-filtered row, never the Best Role figures", () => {
    renderRow(SELECTED_ROLE_ROW);
    const hero = screen.getByTestId("row-rolefit");
    expect(hero).toHaveTextContent("54.8");
    expect(hero).toHaveTextContent("Touchline Winger");
    // the player's own best stored role never leaks into the result context
    expect(hero).not.toHaveTextContent("88.4");
    expect(hero).not.toHaveTextContent("Shadow Striker");
  });

  it("names the dossier's own best stored role Best Role, and its score Best RoleFit", () => {
    render(
      <ScoutingStateProvider>
        <PlayerCardHeader card={playerCard()} />
      </ScoutingStateProvider>,
    );
    expect(screen.getByText("Best RoleFit")).toBeInTheDocument();
    expect(screen.getByText("Best Role")).toBeInTheDocument();
    // and it reads the best rating's own figures
    expect(screen.getByText("90.0")).toBeInTheDocument();
    expect(screen.getByText("Shadow Striker")).toBeInTheDocument();
  });

  it("labels a comparable player's figure Best RoleFit, because that is the field", () => {
    const similar = stripComments(
      readFileSync(join(SRC, "components", "player", "SimilarPlayers.tsx"), "utf8"),
    );
    expect(similar).toContain("Best RoleFit");
    expect(similar).toContain("player.best_role_score");
  });

  it("describes neither context as a recommendation", () => {
    expect(
      scan(["recommended role", "suggested role", "recommends", "best signing"]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. RoleFit Confidence versus Evidence Coverage
// ---------------------------------------------------------------------------

describe("RoleFit Confidence and Evidence Coverage stay two channels", () => {
  it("has retired every Data Coverage spelling", () => {
    expect(scan(["Data Coverage", "data coverage"])).toEqual([]);
  });

  it("names both channels in Title Case wherever they label a value", () => {
    expect(scan(["RoleFit confidence", "Evidence coverage"])).toEqual([]);
  });

  it("renders the compound status as two separate facts, in the canonical words", () => {
    renderRow();
    const status = screen.getByTestId("card-status");
    expect(status).toHaveTextContent("High Evidence Coverage");
    expect(status).toHaveTextContent("High RoleFit Confidence");
    expect(status).toHaveAccessibleName(
      "Evidence Coverage: high. RoleFit Confidence: high.",
    );
  });

  it("keeps high coverage from implying high confidence", () => {
    renderRow({ evidence_status: "high_coverage", result_role_confidence: "low", confidence: "low" });
    const status = screen.getByTestId("card-status");
    expect(status).toHaveTextContent("High Evidence Coverage");
    expect(status).toHaveTextContent("Low RoleFit Confidence");
    expect(status).toHaveAccessibleName("Evidence Coverage: high. RoleFit Confidence: low.");
  });

  it("keeps the market model's own confidence under a different name", () => {
    const panel = stripComments(
      readFileSync(join(SRC, "components", "player", "MarketValuePanel.tsx"), "utf8"),
    );
    expect(panel).toContain("Valuation Confidence");
    expect(panel).not.toContain("RoleFit Confidence");
  });
});

// ---------------------------------------------------------------------------
// 4. Minutes
// ---------------------------------------------------------------------------

describe("Minutes are named for what they are", () => {
  it("calls the displayed statistic Minutes Played and the filter Minimum Minutes", () => {
    const filters = stripComments(
      readFileSync(join(SRC, "components", "search", "AdvancedFilters.tsx"), "utf8"),
    );
    expect(filters).toContain('<span className="label">Minimum Minutes</span>');
    expect(filters).toContain("Whole Minutes Played");

    const context = stripComments(
      readFileSync(join(SRC, "components", "player", "ContextPanel.tsx"), "utf8"),
    );
    expect(context).toContain("Minutes Played");

    const compare = stripComments(
      readFileSync(join(SRC, "components", "compare", "PlayerCompareTable.tsx"), "utf8"),
    );
    expect(compare).toContain('label: "Minutes Played"');
  });

  it("never reads a missing minutes figure as zero", () => {
    renderRow({ minutes: null, represented_minutes: null } as Partial<PlayerSearchCard>);
    const identity = screen.getByTestId("row-identity");
    expect(identity).toHaveTextContent("- min played");
    expect(identity).not.toHaveTextContent("0 min played");
  });
});

// ---------------------------------------------------------------------------
// 5. Market information
// ---------------------------------------------------------------------------

function market(over: Partial<MarketPanel> = {}): MarketPanel {
  return {
    public_value_eur: 40_000_000,
    model_value_low_eur: 30_000_000,
    model_value_high_eur: 45_000_000,
    expected_asking_low_eur: 50_000_000,
    expected_asking_high_eur: 70_000_000,
    confidence: "high",
    label: "inflated",
    manual_review_required: false,
    version: "market-v1",
    explanation: {},
    ...over,
  } as unknown as MarketPanel;
}

describe("Market concepts stay three distinct reads", () => {
  it("names Public Market Value, Model Value Range and Expected Asking Range separately", () => {
    render(<MarketValuePanel market={market()} />);
    expect(screen.getByText("Public Market Value")).toBeInTheDocument();
    expect(screen.getByText("Model Value Range")).toBeInTheDocument();
    expect(screen.getByText("Expected Asking Range")).toBeInTheDocument();
    expect(screen.getByTestId("market-chart")).toHaveAccessibleName(
      /Public Market Value .*\. Model Value Range .*\. Expected Asking Range /,
    );
  });

  it("never collapses them into a generic value", () => {
    render(<MarketValuePanel market={market()} />);
    const panel = screen.getByTestId("market-panel");
    expect(panel).not.toHaveTextContent("Market value:");
    expect(panel).not.toHaveTextContent("Estimated value");
  });

  it("orders by Expected Asking under that name, in the Sort control and the rail alike", () => {
    expect(SORT_OPTIONS.map((s) => s.label)).toContain("Expected Asking (High → Low)");
    expect(SORT_OPTIONS.map((s) => s.label)).toContain("Expected Asking (Low → High)");
    expect(SORT_OPTIONS.map((s) => s.label).join(" ")).not.toContain("Asking Price");
  });

  it("reports an absent market record as Unknown, never as zero", () => {
    render(<MarketValuePanel market={null} />);
    expect(screen.getByTestId("market-panel")).toHaveTextContent("Market information unknown");
    expect(screen.getByTestId("market-panel")).not.toHaveTextContent("€0");
  });

  it("keeps a partial range partial rather than substituting a zero endpoint", () => {
    render(<MarketReadout label="fair" low={20_000_000} high={null} />);
    expect(screen.getByTestId("market-readout")).toHaveTextContent("From €20.0M");
    expect(screen.getByTestId("market-readout")).not.toHaveTextContent("€0");
  });
});

// ---------------------------------------------------------------------------
// 6. Rated / Unrated / Unknown / Unavailable / Unsupported
// ---------------------------------------------------------------------------

function roleSummary(over: Record<string, unknown> = {}) {
  return {
    role_key: "shadow_striker",
    display_name: "Shadow Striker",
    final_score: 90,
    raw_score: 88,
    context_adjusted_score: 89,
    confidence: "high",
    rank_in_peer_group: 1,
    is_best: true,
    ...over,
  } as never;
}

function playerCard(over: Partial<PlayerCard> = {}): PlayerCard {
  return {
    identity: {
      id: 6,
      canonical_name: "Anton Keller",
      age: 21,
      club: "Stuttgart",
      league: "Bundesliga",
      nationality: "Germany",
      primary_position: "CF",
      secondary_positions: [],
      preferred_foot: "Right",
      height_cm: 183,
    },
    season: "2023/24",
    confidence: "high",
    analysis_status: "analyzed",
    evidence_status: "high_coverage",
    has_rolefit_analysis: true,
    is_high_coverage: true,
    role_ratings: [roleSummary()],
    playstyles: [],
    concerns: [],
    market: market(),
    context: null,
    ...over,
  } as unknown as PlayerCard;
}

const UNRATED_CARD: Partial<PlayerCard> = {
  confidence: "unknown",
  analysis_status: "profile_only",
  evidence_status: "profile_only",
  has_rolefit_analysis: false,
  is_high_coverage: false,
  role_ratings: [],
};

describe("The five data and capability states mean five different things", () => {
  it("Unrated: no stored RoleFit, including the honest profile-only case", () => {
    renderRow({
      best_role: null,
      best_role_display: null,
      best_role_score: null,
      best_role_confidence: "unknown",
      result_role: null,
      result_role_display: null,
      result_role_score: null,
      result_role_confidence: "unknown",
      confidence: "unknown",
      analysis_status: "profile_only",
      evidence_status: "profile_only",
      has_rolefit_analysis: false,
      is_high_coverage: false,
      top_playstyles: [],
    });
    // the RoleFit slot reports RATING STATUS
    expect(screen.getByTestId("row-rolefit")).toHaveTextContent("Unrated");
    expect(screen.getByTestId("row-rolefit")).not.toHaveTextContent("Profile Only");
    // the status unit beside it separately reports EVIDENCE COVERAGE
    expect(screen.getByTestId("card-status")).toHaveTextContent("Profile Only");
    // and the playstyle line explains the absence by the rating, not by a failure
    expect(screen.getByTestId("profile-only-card")).toHaveTextContent("Unrated: no playstyles");
    // never a fabricated score
    expect(screen.queryByTestId("score-readout")).not.toBeInTheDocument();
    expect(screen.getByTestId("result-row")).not.toHaveTextContent("0.0");
  });

  it("Unrated on the dossier header, in all three slots that depend on a rating", () => {
    render(
      <ScoutingStateProvider>
        <PlayerCardHeader card={playerCard(UNRATED_CARD)} />
      </ScoutingStateProvider>,
    );
    expect(screen.getAllByText("Unrated").length).toBe(3);
    expect(screen.queryByText("Profile only")).not.toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("Unrated in a comparison, when a Selected Role has no stored rating for a side", () => {
    render(<PlayerCompareTable data={compareResponse()} />);
    expect(screen.getByTestId("compare-unavailable-right")).toHaveTextContent(
      "Unrated in this role",
    );
    expect(screen.queryByText("Not rated in this role")).not.toBeInTheDocument();
  });

  it("Unknown: a value that was never observed", () => {
    render(<MarketReadout label={null} low={null} high={null} />);
    expect(screen.getByTestId("market-readout")).toHaveTextContent("Unknown");
  });

  it("Unavailable: a referenced resource that cannot be supplied right now", () => {
    // Stale saved references, failed loads and an identity provider that never
    // answered are the three that legitimately say Unavailable.
    const favorites = stripComments(
      readFileSync(join(SRC, "components", "saved", "FavoritesPanel.tsx"), "utf8"),
    );
    expect(favorites).toContain("Those players are unavailable");

    const comparisons = stripComments(
      readFileSync(join(SRC, "components", "saved", "ComparisonsPanel.tsx"), "utf8"),
    );
    expect(comparisons).toContain("(no longer available)");

    const nav = stripComments(readFileSync(join(SRC, "components", "common", "NavBar.tsx"), "utf8"));
    expect(nav).toContain("Accounts unavailable");
  });

  it("Unsupported: a requested capability outside the configured product", () => {
    // A role key the configuration does not carry is unsupported, not missing.
    const compare = stripComments(readFileSync(join(SRC, "app", "compare", "page.tsx"), "utf8"));
    expect(compare).toContain("is not a supported role");

    const views = stripComments(
      readFileSync(join(SRC, "components", "saved", "ViewsPanel.tsx"), "utf8"),
    );
    expect(views).toContain("no longer supported");

    const comparisons = stripComments(
      readFileSync(join(SRC, "components", "saved", "ComparisonsPanel.tsx"), "utf8"),
    );
    expect(comparisons).toContain("no longer supported. Opening it uses");
  });

  it("never uses one state's word for another state's meaning", () => {
    // The retired conflations, each of which described a rating-status fact with
    // a resource-availability word.
    expect(scan(["Analysis unavailable", "Not rated in this role"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. My Favorites
// ---------------------------------------------------------------------------

/**
 * The compatibility-sensitive internal spellings of the favourites collection.
 * The route, the storage key, the test ids, the component name and the state
 * hooks are all read by existing bookmarks, stored data and existing tests, so
 * Milestone 8.5 leaves every one of them alone. Anything NOT in this list is
 * user-visible copy and must say My Favorites.
 */
const FAVORITES_INTERNAL_SPELLINGS: RegExp[] = [
  /shortlistIds|isShortlisted|toggleShortlist|removeShortlist|SHORTLIST_KEY/g,
  /ShortlistButton|ShortlistPage/g,
  /scoutboy\.shortlist\.v1/g,
  /"shortlist-[a-z-]+"/g,
  /\/shortlist/g,
];

describe("My Favorites is the one user-visible name for the collection", () => {
  it("leaves no user-visible shortlist wording anywhere in production copy", () => {
    expect(scanRegex(/shortlist/i, FAVORITES_INTERNAL_SPELLINGS)).toEqual([]);
  });

  it("announces both guest favourite changes as My Favorites", () => {
    render(
      <ScoutingStateProvider>
        <ScoutingLiveRegion />
        <FavoriteHeartButton player={{ id: 11, name: "Anton Keller" }} />
      </ScoutingStateProvider>,
    );
    const live = document.querySelector("[aria-live='polite']")!;

    fireEvent.click(screen.getByTestId("favorite-action"));
    expect(live).toHaveTextContent("Anton Keller added to My Favorites. Saved on this device.");
    expect(live).not.toHaveTextContent("shortlist");

    fireEvent.click(screen.getByTestId("favorite-action"));
    expect(live).toHaveTextContent("Anton Keller removed from My Favorites. Saved on this device.");
    expect(live).not.toHaveTextContent("shortlist");
  });

  it("names the text action after the collection, and contains its visible label", () => {
    render(
      <ScoutingStateProvider>
        <PlayerActionRow player={{ id: 12, name: "Jack Whitmore" }} />
      </ScoutingStateProvider>,
    );
    const button = screen.getByRole("button", { name: /My Favorites/ });
    expect(button).toHaveTextContent("Favorite");
    // WCAG 2.2 SC 2.5.3: the accessible name contains the visible label.
    expect(button.getAttribute("aria-label")).toContain("Favorite");
    expect(button.getAttribute("aria-label")).toContain("My Favorites");

    fireEvent.click(button);
    const pressed = screen.getByRole("button", { name: /My Favorites/ });
    expect(pressed).toHaveTextContent("Favorited");
    expect(pressed.getAttribute("aria-label")).toContain("Favorited");
  });

  it("names the icon-only rail action after the collection too", () => {
    render(
      <ScoutingStateProvider>
        <FavoriteHeartButton player={{ id: 13, name: "Sekou Diallo" }} />
      </ScoutingStateProvider>,
    );
    expect(screen.getByTestId("favorite-action")).toHaveAccessibleName(
      "Add Sekou Diallo to My Favorites",
    );
  });

  it("keeps the legacy route honest: one name, and a pointer rather than a contradiction", () => {
    const page = stripComments(readFileSync(join(SRC, "app", "shortlist", "page.tsx"), "utf8"));
    expect(page).toContain('title="My Favorites"');
    expect(page).toContain("My Favorites now lives under");
    // the retired third name for the same collection
    expect(page).not.toContain("Saved Players");
    const layout = readFileSync(join(SRC, "app", "shortlist", "layout.tsx"), "utf8");
    expect(layout).toContain('title: "My Favorites - ScoutBoy"');
  });
});

// ---------------------------------------------------------------------------
// 8. Saved Discovery Views and Saved Comparison Setups
// ---------------------------------------------------------------------------

describe("Saved work names the object it actually stores", () => {
  it("calls a saved Discovery configuration a saved Discovery view", () => {
    const views = stripComments(
      readFileSync(join(SRC, "components", "saved", "ViewsPanel.tsx"), "utf8"),
    );
    expect(views).toContain("Open the saved Discovery view ");
    expect(views).toContain("Rename the saved Discovery view ");
    expect(views).toContain("Rename this saved Discovery view");
    // and the compact action stays compact
    expect(views).toContain("Rename View");
  });

  it("calls a saved comparison a SETUP wherever it explains what was stored", () => {
    const comparisons = stripComments(
      readFileSync(join(SRC, "components", "saved", "ComparisonsPanel.tsx"), "utf8"),
    );
    expect(comparisons).toContain("Open the saved comparison setup ");
    expect(comparisons).toContain("Rename the saved comparison setup ");
    expect(comparisons).toContain("Saved setup, opens with current analysis");

    const control = stripComments(
      readFileSync(join(SRC, "components", "saved", "SaveComparisonControl.tsx"), "utf8"),
    );
    expect(control).toContain("Saved this comparison setup as ");
    // and the compact action stays compact
    expect(control).toContain("Save Comparison");
  });

  it("never implies a saved comparison holds a frozen result", () => {
    const savedSurfaces = [
      join("components", "saved", "ComparisonsPanel.tsx"),
      join("components", "saved", "SaveComparisonControl.tsx"),
    ].map((rel) => stripComments(readFileSync(join(SRC, rel), "utf8")));
    for (const body of savedSurfaces) {
      for (const forbidden of ["snapshot", "frozen", "saved result", "stored analysis", "report"]) {
        expect(body.toLowerCase()).not.toContain(forbidden);
      }
    }
    // The hub is the one place any of those words may appear, and only inside
    // the sentence that DENIES them.
    const hub = stripComments(readFileSync(join(SRC, "app", "saved", "page.tsx"), "utf8"));
    expect(hub).toContain("no score, conclusion or snapshot is stored");
    expect(hub.toLowerCase().match(/snapshot/g)).toHaveLength(1);
    for (const forbidden of ["frozen", "saved result", "stored analysis", "report"]) {
      expect(hub.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("keeps My Favorites, Views and Comparisons as the hub's three section names", () => {
    const hub = stripComments(readFileSync(join(SRC, "app", "saved", "page.tsx"), "utf8"));
    expect(hub).toContain('favorites: "My Favorites"');
    expect(hub).toContain('views: "Views"');
    expect(hub).toContain('comparisons: "Comparisons"');
  });
});

// ---------------------------------------------------------------------------
// 9. Ordering explanations
// ---------------------------------------------------------------------------

function ranking(over: Partial<RankingExplanation> = {}): RankingExplanation {
  return {
    sort: "rolefit_desc",
    sort_label: "RoleFit",
    direction: "descending",
    direction_label: "highest first",
    summary: "Ordered by RoleFit, highest first.",
    keys: [
      {
        position: 1,
        key: "rated_first",
        label: "Rated Before Unrated",
        direction: "ascending",
        direction_label: "Known first",
        role: "placement",
        unit: "rating_status",
        rule: "Players with a stored RoleFit rating for this role context are placed before players without one.",
      },
      {
        position: 2,
        key: "result_role_score",
        label: "RoleFit Score",
        direction: "descending",
        direction_label: "Highest first",
        role: "measure",
        unit: "rolefit_score",
        rule: "The applicable role context's stored RoleFit score, highest first.",
      },
    ],
    role_context: {
      source: "best_role",
      role_key: null,
      role_display: null,
      label: "Best Role for each player",
      detail:
        "No role is selected, so the RoleFit on each result is that player's own stored Best Role, which may differ from row to row.",
    },
    missing_values: "A player with no stored rating is placed after every rated player.",
    tie_breakers: [],
    limitation:
      "This explains ordering, not recruitment suitability. It reports the stored values the database sorted by; it does not rate, rank or recommend a signing.",
    ...over,
  } as unknown as RankingExplanation;
}

describe("Why This Order explains ordering, not suitability", () => {
  it("is titled for the ordering and says so in its accessible name", () => {
    render(<WhyThisOrder ranking={ranking()} />);
    expect(screen.getByText("Why This Order")).toBeInTheDocument();
    expect(screen.getByTestId("why-this-order-toggle")).toHaveAccessibleName(
      "Why this order. Ordered by RoleFit, highest first.",
    );
  });

  it("carries no advisory or per-player wording of its own", () => {
    const source = stripComments(
      readFileSync(join(SRC, "components", "search", "WhyThisOrder.tsx"), "utf8"),
    );
    for (const forbidden of [
      "recommend",
      "suggested",
      "why this player",
      "suitab",
      "best signing",
      "should sign",
      "priority",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("renders the backend's Best Role context verbatim, without renaming it", () => {
    render(<WhyThisOrder ranking={ranking()} />);
    fireEvent.click(screen.getByTestId("why-this-order-toggle"));
    const context = screen.getByTestId("ranking-role-context");
    expect(context).toHaveTextContent("Best Role for each player");
    expect(context).toHaveTextContent("that player's own stored Best Role");
  });

  it("keeps the ordering explainer distinct from the two other Why surfaces", () => {
    // Three different questions, three different names, no cross-talk.
    const order = stripComments(
      readFileSync(join(SRC, "components", "search", "WhyThisOrder.tsx"), "utf8"),
    );
    const score = stripComments(
      readFileSync(join(SRC, "components", "player", "AuditAccordion.tsx"), "utf8"),
    );
    const valuation = stripComments(
      readFileSync(join(SRC, "components", "player", "MarketValuePanel.tsx"), "utf8"),
    );
    expect(order).toContain("Why This Order");
    expect(score).toContain("Why This Score");
    expect(valuation).toContain("Why This Valuation");
    expect(order).not.toContain("Why This Score");
    expect(score).not.toContain("Why This Order");
  });
});

// ---------------------------------------------------------------------------
// 10. Empty, loading, error, stale and restored states
// ---------------------------------------------------------------------------

describe("Transient states use the lexicon too", () => {
  it("names the collection in every empty state that belongs to one", () => {
    const favorites = stripComments(
      readFileSync(join(SRC, "components", "saved", "FavoritesPanel.tsx"), "utf8"),
    );
    expect(favorites).toContain("No players in My Favorites yet.");
    expect(favorites).toContain('label="Loading My Favorites…"');

    const views = stripComments(
      readFileSync(join(SRC, "components", "saved", "ViewsPanel.tsx"), "utf8"),
    );
    expect(views).toContain("No saved Discovery views yet.");

    const comparisons = stripComments(
      readFileSync(join(SRC, "components", "saved", "ComparisonsPanel.tsx"), "utf8"),
    );
    expect(comparisons).toContain("No saved comparison setups yet.");
  });

  it("explains a URL that carried something the product cannot honour", () => {
    const compare = stripComments(readFileSync(join(SRC, "app", "compare", "page.tsx"), "utf8"));
    expect(compare).toContain("Part of this link could not be used");
    expect(compare).toContain("is not a supported role, so this comparison opened with Automatic Role.");
  });

  it("keeps loading labels honest about what is loading", () => {
    const results = stripComments(
      readFileSync(join(SRC, "components", "search", "PlayerSearchResults.tsx"), "utf8"),
    );
    expect(results).toContain('label="Finding players…"');
    expect(results).toContain("No players match these filters.");
  });
});

// ---------------------------------------------------------------------------
// 11. Accessible names agree with visible labels
// ---------------------------------------------------------------------------

describe("Accessible names name the visible concept", () => {
  it("leads a leaderboard link's accessible name with its visible label", () => {
    const panel = stripComments(
      readFileSync(join(SRC, "components", "player", "RoleRatingsPanel.tsx"), "utf8"),
    );
    expect(panel).toContain("View Leaderboard: ${r.display_name}");
    expect(panel).toContain("View Leaderboard →");
    expect(panel).not.toContain("View the ${r.display_name} leaderboard");
  });

  it("keeps the compound ledger unit's description in the same words as its segments", () => {
    renderRow();
    const status = screen.getByTestId("card-status");
    const name = status.getAttribute("aria-label")!;
    // Both channel names appear in the description exactly as the visible unit
    // and every other surface spell them.
    expect(name).toContain("Evidence Coverage:");
    expect(name).toContain("RoleFit Confidence:");
  });
});

// ---------------------------------------------------------------------------
// 12. helpers for the compare fixture
// ---------------------------------------------------------------------------

function compareSide(name: string, roles: unknown[]) {
  return {
    identity: {
      id: name.length,
      canonical_name: name,
      age: 21,
      club: "Stuttgart",
      league: "Bundesliga",
      nationality: "Germany",
      primary_position: "CF",
      secondary_positions: [],
    },
    role_ratings: roles,
    substats: [],
    playstyles: [],
    market: market(),
    context: null,
    confidence: "high",
  };
}

function compareResponse(): CompareResponse {
  return {
    season: "2023/24",
    role_key: "shadow_striker",
    role_display: "Shadow Striker",
    player_a: compareSide("Anton Keller", [roleSummary()]),
    player_b: compareSide("Jack Whitmore", [
      roleSummary({ role_key: "inside_forward", display_name: "Inside Forward", final_score: 60 }),
    ]),
    stat_rows: [],
    role_comparison: {},
    why_higher: "Anton Keller rates higher as Shadow Striker (90.0 vs 60.0).",
    confidence_warnings: [],
  } as unknown as CompareResponse;
}
