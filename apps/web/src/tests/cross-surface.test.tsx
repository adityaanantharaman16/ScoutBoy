import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConfidenceReadout,
  EvidenceTag,
  LedgerSkeleton,
  MarketReadout,
  PageHeader,
  ScoreReadout,
} from "@/components/common";
import { PlayerCompareTable } from "@/components/compare/PlayerCompareTable";
import { ResultCard, PlayerSearchResults } from "@/components/search/PlayerSearchResults";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import type {
  CompareResponse,
  CompareSide,
  PlayerCard,
  PlayerSearchCard,
  RoleRatingSummary,
} from "@/lib/api/types";

// ---- hooks are mocked so pages render without a QueryClient ----
const { usePlayerSearchMock, usePlayersByIdsMock, useAllPlayersLiteMock, useCompareMock } = vi.hoisted(
  () => ({
    usePlayerSearchMock: vi.fn(),
    usePlayersByIdsMock: vi.fn(),
    useAllPlayersLiteMock: vi.fn(),
    useCompareMock: vi.fn(),
  }),
);
vi.mock("@/lib/api/hooks", () => ({
  usePlayerSearch: usePlayerSearchMock,
  usePlayersByIds: usePlayersByIdsMock,
  useAllPlayersLite: useAllPlayersLiteMock,
  useCompare: useCompareMock,
}));
// The compare page reads the URL + navigates; mock it so the page renders.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/compare",
}));

import ShortlistPage from "@/app/shortlist/page";
import ComparePage from "@/app/compare/page";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
function makeSearchCard(over: Partial<PlayerSearchCard> = {}): PlayerSearchCard {
  const card = {
    id: 1,
    canonical_name: "Card Player",
    season: "2023/24",
    age: 22,
    club: "Test FC",
    league: "Test League",
    primary_position: "LW",
    position_group: "ATT",
    best_role: "inside_forward",
    best_role_display: "Inside Forward",
    best_role_score: 81.2,
    confidence: "high",
    analysis_status: "analyzed",
    evidence_status: "high_coverage",
    has_rolefit_analysis: true,
    is_high_coverage: true,
    top_playstyles: ["Technical Carrier"],
    minutes: 1200,
    represented_minutes: 1200,
    market_label: "fair",
    expected_asking_low_eur: 1_000_000,
    expected_asking_high_eur: 2_000_000,
    ...over,
  } as PlayerSearchCard;
  // These fixtures describe an UNFILTERED search, where the API's result role
  // context is the player's own best role, so mirror it unless a case sets it
  // explicitly. Role-filtered rows, where the two genuinely differ, are exercised
  // in discovery-ledger.test.tsx.
  return {
    ...card,
    best_role_confidence: over.best_role_confidence ?? card.confidence,
    result_role: over.result_role !== undefined ? over.result_role : card.best_role,
    result_role_display:
      over.result_role_display !== undefined ? over.result_role_display : card.best_role_display,
    result_role_score:
      over.result_role_score !== undefined ? over.result_role_score : card.best_role_score,
    result_role_confidence: over.result_role_confidence ?? card.confidence,
    result_role_source: over.result_role_source ?? "best_role",
  };
}

function summary(role: string, display: string, score: number, confidence = "high", isBest = false): RoleRatingSummary {
  return {
    role_key: role,
    display_name: display,
    final_score: score,
    raw_score: score,
    context_adjusted_score: score,
    confidence,
    rank_in_peer_group: 1,
    is_best: isBest,
  } as unknown as RoleRatingSummary;
}

function side(name: string, over: Partial<CompareSide> = {}): CompareSide {
  return {
    identity: { id: 1, canonical_name: name, club: "Club", league: "League", secondary_positions: [] },
    role_ratings: [summary("shadow_striker", "Shadow Striker", 88, "high", true)],
    substats: [],
    playstyles: [
      { playstyle_key: "box_crasher", display_name: "Box Crasher", category: "attack", tier: null, confidence: "high", is_concern: false, why_applied: {}, supporting_metrics: [] },
    ],
    market: { label: "inflated", expected_asking_low_eur: 50_000_000, expected_asking_high_eur: 70_000_000, confidence: "high", manual_review_required: false, explanation: {} },
    context: null,
    confidence: "high",
    ...over,
  } as unknown as CompareSide;
}

function makeCompare(over: Partial<CompareResponse> = {}): CompareResponse {
  return {
    season: "2023/24",
    role_key: "shadow_striker",
    role_display: "Shadow Striker",
    player_a: side("Anton Keller"),
    player_b: side("Jack Whitmore", { role_ratings: [summary("shadow_striker", "Shadow Striker", 54, "medium", true)] }),
    stat_rows: [
      { metric: "np_xg", display: "Non-penalty xG", unit: "per90", a_per90: 0.5, a_percentile: 0.9, a_score: 90, b_per90: 0.2, b_percentile: 0.4, b_score: 40 },
      { metric: "aerials", display: "Aerial duels won %", unit: "pct", a_per90: 15, a_percentile: 0.5, a_score: null, b_per90: 15, b_percentile: 0.5, b_score: 50 },
    ],
    role_comparison: {},
    why_higher: "Anton Keller rates higher as Shadow Striker (88.0 vs 54.0), driven by shot threat.",
    confidence_warnings: [],
    ...over,
  } as unknown as CompareResponse;
}

function makePlayerCard(over: Partial<PlayerCard> = {}): PlayerCard {
  return {
    identity: { id: 6, canonical_name: "Anton Keller", club: "Stuttgart", league: "Bundesliga", age: 21, primary_position: "CF", secondary_positions: [] },
    season: "2023/24",
    confidence: "high",
    analysis_status: "analyzed",
    evidence_status: "high_coverage",
    has_rolefit_analysis: true,
    is_high_coverage: true,
    role_ratings: [summary("shadow_striker", "Shadow Striker", 90, "high", true)],
    playstyles: [
      { playstyle_key: "box_crasher", display_name: "Box Crasher", category: "attack", tier: null, confidence: "high", is_concern: false, why_applied: {}, supporting_metrics: [] },
    ],
    concerns: [],
    market: { label: "inflated", expected_asking_low_eur: 58_000_000, expected_asking_high_eur: 87_000_000, confidence: "high", manual_review_required: false, explanation: {} },
    strengths: [],
    concerns_text: [],
    context: null,
    data_sources: [],
    face_stats: [],
    substats: [],
    ...over,
  } as unknown as PlayerCard;
}

const noop = () => {};

// ---------------------------------------------------------------------------
// Discovery — result rows + ledger states
// ---------------------------------------------------------------------------
describe("Discovery result rows (honesty states)", () => {
  const renderCard = (card: PlayerSearchCard) =>
    render(
      <ScoutingStateProvider>
        <ResultCard p={card} />
      </ScoutingStateProvider>,
    );

  it("keeps a low-confidence analyzed player's score but flags confidence low", () => {
    renderCard(makeSearchCard({ confidence: "low", best_role_score: 84.0 }));
    expect(screen.getByText("84.0")).toBeInTheDocument();
    const status = screen.getByTestId("card-status");
    expect(status).toHaveTextContent("Low Confidence");
    expect(within(status).getByTestId("confidence-meter").getAttribute("data-confidence")).toBe("low");
  });

  it("renders a missing market as Unknown, never €0", () => {
    renderCard(makeSearchCard({ market_label: null, expected_asking_low_eur: null, expected_asking_high_eur: null }));
    const market = screen.getByTestId("market-readout");
    expect(market).toHaveTextContent("Unknown");
    expect(market).not.toHaveTextContent("€0");
  });

  it("preserves a partial market range as From/Up to, never €0", () => {
    renderCard(makeSearchCard({ expected_asking_low_eur: 12_000_000, expected_asking_high_eur: null }));
    const market = screen.getByTestId("market-readout");
    expect(market).toHaveTextContent("From €12.0M");
    expect(market).not.toHaveTextContent("€0");
  });

  it("shows an honest empty-playstyles note for analyzed players", () => {
    renderCard(makeSearchCard({ top_playstyles: [] }));
    expect(screen.getByTestId("no-playstyles")).toHaveTextContent("No qualifying playstyles");
  });
});

describe("Discovery results pane states", () => {
  afterEach(() => usePlayerSearchMock.mockReset());
  const filters = { scope: "analyzed", sort: "rolefit_desc", page: 1 };

  it("shows a structural skeleton while loading (page identity preserved elsewhere)", () => {
    usePlayerSearchMock.mockReturnValue({ isLoading: true });
    render(<PlayerSearchResults filters={filters} ageSummary="All Ages" onPage={noop} onCanonicalPage={noop} />);
    expect(screen.getByTestId("ledger-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("ledger-skeleton")).toHaveAttribute("role", "status");
  });

  it("shows an honest empty state with no fabricated rows", () => {
    usePlayerSearchMock.mockReturnValue({ isLoading: false, isError: false, data: { items: [], total: 0, page: 1, page_size: 12, total_pages: 0 } });
    render(<PlayerSearchResults filters={filters} ageSummary="All Ages" onPage={noop} onCanonicalPage={noop} />);
    expect(screen.getByText(/No players match these filters/)).toBeInTheDocument();
  });

  it("shows an alert on request failure", () => {
    usePlayerSearchMock.mockReturnValue({ isLoading: false, isError: true, error: new Error("boom") });
    render(<PlayerSearchResults filters={filters} ageSummary="All Ages" onPage={noop} onCanonicalPage={noop} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Compare — two-sided balance sheet
// ---------------------------------------------------------------------------
describe("Compare balance sheet", () => {
  it("shows both sides' scores, the role spine, and the why_higher conclusion", () => {
    render(<PlayerCompareTable data={makeCompare()} />);
    expect(screen.getByTestId("compare-role")).toHaveTextContent("Shadow Striker");
    const left = screen.getByTestId("compare-side-left");
    const right = screen.getByTestId("compare-side-right");
    expect(within(left).getByText("88.0")).toBeInTheDocument();
    expect(within(right).getByText("54.0")).toBeInTheDocument();
    expect(screen.getByTestId("why-higher")).toHaveTextContent("rates higher as Shadow Striker");
  });

  it("shows both sides' stored scores for an automatically selected shared role", () => {
    // The API only selects a role both players are rated in, so both sides must
    // read a stored score and role-level confidence — never an unavailable badge.
    const data = makeCompare({
      player_a: side("Anton Keller", {
        role_ratings: [
          summary("inside_forward", "Inside Forward", 91, "high", true),
          summary("touchline_winger", "Touchline Winger", 74, "high"),
        ],
      }),
      player_b: side("Jack Whitmore", {
        role_ratings: [
          summary("touchline_winger", "Touchline Winger", 72, "medium", true),
          summary("shadow_striker", "Shadow Striker", 66, "medium"),
        ],
      }),
      role_key: "touchline_winger",
      role_display: "Touchline Winger",
      why_higher: "Anton Keller rates higher as Touchline Winger (74.0 vs 72.0), driven by carrying.",
    });
    render(<PlayerCompareTable data={data} />);
    expect(screen.getByTestId("compare-role")).toHaveTextContent("Touchline Winger");
    const left = screen.getByTestId("compare-side-left");
    const right = screen.getByTestId("compare-side-right");
    expect(within(left).getByText("74.0")).toBeInTheDocument();
    expect(within(right).getByText("72.0")).toBeInTheDocument();
    expect(screen.queryByText("Not rated in this role")).not.toBeInTheDocument();
    expect(screen.getByTestId("compare-role-note")).toHaveTextContent("RoleFit score and confidence");
  });

  it("shows an explicit unavailable state when a side lacks the selected role", () => {
    const data = makeCompare({
      player_b: side("Jack Whitmore", { role_ratings: [summary("inside_forward", "Inside Forward", 60)] }),
    });
    render(<PlayerCompareTable data={data} />);
    expect(screen.getByTestId("compare-unavailable-right")).toHaveTextContent("Not rated in this role");
  });

  it("shows a neutral no-shared-role state without blaming or scoring either side", () => {
    const data = makeCompare({
      role_key: null,
      role_display: null,
      role_comparison: {},
      why_higher:
        "No shared rated role is available for these players. Select a role to inspect the available analysis.",
      player_a: side("Anton Keller", {
        role_ratings: [summary("inside_forward", "Inside Forward", 88, "high", true)],
        context: ctx(),
      }),
      player_b: side("Jack Whitmore", {
        role_ratings: [summary("ball_playing_cb", "Ball-Playing CB", 71, "medium", true)],
        context: ctx({ minutes: 900, appearances: 12, starts: 10 }),
      }),
    });
    render(<PlayerCompareTable data={data} />);
    // the visible heading is exactly title case — all four words capitalized
    const heading = screen.getByTestId("compare-role");
    expect(heading.textContent).toBe("No Shared Rated Role");
    expect(heading.textContent).not.toBe("No shared rated role");
    expect(screen.getByTestId("compare-no-shared-role")).toBeInTheDocument();
    // the explanatory prose stays sentence case (the API constant is untouched)
    expect(screen.getByTestId("why-higher").textContent).toBe(
      "No shared rated role is available for these players. Select a role to inspect the available analysis.",
    );
    // no role was selected, so neither side is labelled unrated
    expect(screen.queryByText("Not rated in this role")).not.toBeInTheDocument();
    expect(screen.queryByTestId("compare-unavailable-left")).not.toBeInTheDocument();
    expect(screen.queryByTestId("compare-unavailable-right")).not.toBeInTheDocument();
    // and no score or role confidence is fabricated for either side
    for (const testId of ["compare-side-left", "compare-side-right"]) {
      const column = screen.getByTestId(testId);
      expect(within(column).queryByText("88.0")).not.toBeInTheDocument();
      expect(within(column).queryByText("71.0")).not.toBeInTheDocument();
      expect(within(column).queryByTestId("confidence-readout")).not.toBeInTheDocument();
      // market stays available on both sides
      expect(within(column).getByTestId("market-readout")).toBeInTheDocument();
    }
    // the non-role evidence stays usable
    expect(screen.getByTestId("compare-context-left")).toHaveTextContent("Minutes");
    expect(screen.getByTestId("compare-context-right")).toHaveTextContent("900");
    expect(screen.getByTestId("compare-metric-ledger")).toBeInTheDocument();
  });

  it("renders confidence warnings as labelled notices, not bare amber text", () => {
    render(<PlayerCompareTable data={makeCompare({ confidence_warnings: ["Shared-role minutes are thin."] })} />);
    const warnings = screen.getByTestId("confidence-warnings");
    expect(within(warnings).getByText("Confidence warning")).toBeInTheDocument();
    expect(within(warnings).getByText(/Shared-role minutes are thin/)).toBeInTheDocument();
  });

  it("renders null metric scores as Unknown, never zero", () => {
    render(<PlayerCompareTable data={makeCompare()} />);
    const ledger = screen.getByTestId("compare-metric-ledger");
    const aerialRow = within(ledger).getByText("Aerial duels won %").closest("tr")!;
    expect(within(aerialRow).getByText("Unknown")).toBeInTheDocument();
    expect(within(aerialRow).queryByText("0")).not.toBeInTheDocument();
  });

  it("does not crush the role spine with very long player names", () => {
    const longName = "Maximiliano-Wolfgang von Habsburg-Lothringen-Schönbürg III";
    const data = makeCompare({ player_a: side(longName) });
    render(<PlayerCompareTable data={data} />);
    expect(screen.getByTestId("compare-role")).toHaveTextContent("Shadow Striker");
    expect(screen.getByText(longName)).toBeInTheDocument();
  });

  // ---- evidence context (supplied per side; never recomputed or graded) ----
  function ctx(over: Partial<NonNullable<CompareSide["context"]>> = {}): NonNullable<CompareSide["context"]> {
    return {
      minutes: 1550,
      appearances: 20,
      starts: 18,
      sample_confidence: "medium",
      translation_risk: "League 'ger_bundesliga' strength ×1.02 (low translation risk)",
      limitations: [],
      uses_event_data: true,
      uses_basic_statistics: false,
      uses_modeled_values: false,
      uses_demo_data: false,
      explanation: {},
      ...over,
    } as NonNullable<CompareSide["context"]>;
  }

  it("shows a compact, parallel evidence-context summary from supplied fields on both sides", () => {
    const data = makeCompare({
      player_a: side("Anton Keller", { context: ctx() }),
      player_b: side("Jack Whitmore", {
        role_ratings: [summary("shadow_striker", "Shadow Striker", 54, "medium", true)],
        context: ctx({ minutes: 1800, appearances: 23, starts: 20, sample_confidence: "high" }),
      }),
    });
    render(<PlayerCompareTable data={data} />);
    const left = screen.getByTestId("compare-context-left");
    const right = screen.getByTestId("compare-context-right");
    // structurally parallel: both carry the same heading + labels
    for (const block of [left, right]) {
      expect(within(block).getByText("Evidence context")).toBeInTheDocument();
      expect(block).toHaveTextContent("Minutes");
      expect(block).toHaveTextContent("Sample confidence");
    }
    expect(left).toHaveTextContent("1550");
    expect(left).toHaveTextContent("20 apps · 18 starts");
    expect(left).toHaveTextContent("Medium"); // supplied value, title-cased — not a new grade
    expect(right).toHaveTextContent("1800");
    expect(right).toHaveTextContent("High");
  });

  it("shows an explicit fallback when a side's context is entirely absent", () => {
    const data = makeCompare({
      player_a: side("Anton Keller", { context: ctx() }),
      player_b: side("Jack Whitmore", {
        role_ratings: [summary("shadow_striker", "Shadow Striker", 54, "medium", true)],
        context: null,
      }),
    });
    render(<PlayerCompareTable data={data} />);
    expect(screen.getByTestId("compare-context-right")).toHaveTextContent("Evidence context unavailable");
    // the populated side is unaffected
    expect(screen.getByTestId("compare-context-left")).toHaveTextContent("Minutes");
  });

  it("omits missing context fields instead of fabricating them (never zero)", () => {
    const data = makeCompare({
      player_a: side("Anton Keller", {
        context: ctx({ minutes: 1200, appearances: null, starts: null, sample_confidence: null, translation_risk: null }),
      }),
    });
    render(<PlayerCompareTable data={data} />);
    const left = screen.getByTestId("compare-context-left");
    expect(left).toHaveTextContent("Minutes");
    expect(left).toHaveTextContent("1200");
    // absent fields are omitted — not rendered, and never coerced to 0
    expect(left).not.toHaveTextContent("apps");
    expect(left).not.toHaveTextContent("Sample confidence");
    expect(left).not.toHaveTextContent("0 apps");
  });

  it("preserves a genuine numeric zero (0 is a real value, not missing)", () => {
    const data = makeCompare({
      player_a: side("Anton Keller", { context: ctx({ minutes: 0, appearances: 0, starts: 0 }) }),
    });
    render(<PlayerCompareTable data={data} />);
    const left = screen.getByTestId("compare-context-left");
    expect(left).toHaveTextContent("Minutes 0");
    expect(left).toHaveTextContent("0 apps · 0 starts");
  });

  it("keeps long source and limitation text present (wrapping, not dropped)", () => {
    const longLimit =
      "Event data covers only a partial slice of this competition, so pressing and off-ball volumes may be understated relative to a full-season sample.";
    const data = makeCompare({
      player_a: side("Anton Keller", {
        context: ctx({
          data_source: "StatsBomb Open Data (Bayer Leverkusen 2023/24 slice)",
          data_type: "event data",
          limitations: [longLimit],
        }),
      }),
    });
    render(<PlayerCompareTable data={data} />);
    const left = screen.getByTestId("compare-context-left");
    expect(left).toHaveTextContent("StatsBomb Open Data (Bayer Leverkusen 2023/24 slice)");
    expect(left).toHaveTextContent(longLimit);
  });
});

describe("Compare page role control", () => {
  beforeEach(() => {
    useAllPlayersLiteMock.mockReturnValue({ data: { items: [] } });
    useCompareMock.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null });
  });

  it("describes the Automatic-role policy as a shared-role, strongest-joint-fit choice", () => {
    render(<ComparePage />);
    expect(screen.getByRole("option", { name: "Automatic Role" })).toBeInTheDocument();
    // the lowercase form is gone entirely
    expect(screen.queryByRole("option", { name: "Automatic role" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Chooses the shared rated role where both players have the strongest joint fit\./,
      ),
    ).toBeInTheDocument();
    // the superseded asymmetric fallback copy is gone, as are the older
    // "most comparable" / "best shared" implications
    expect(screen.queryByText(/falling back to Player B/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/best-rated role/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/most comparable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/best shared/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// My Favorites — saved players on the shared ledger
// ---------------------------------------------------------------------------
describe("My Favorites saved players", () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePlayersByIdsMock.mockReset();
  });

  const renderShortlist = () => render(<ScoutingStateProvider><ShortlistPage /></ScoutingStateProvider>);

  const resolve = (over: Partial<PlayerCard> = {}, ids = [6]) => {
    window.localStorage.setItem("scoutboy.shortlist.v1", JSON.stringify(ids));
    usePlayersByIdsMock.mockReturnValue([
      { data: makePlayerCard(over), isLoading: false, isError: false },
    ]);
  };

  it("titles the page Saved Players under the My Favorites eyebrow", () => {
    usePlayersByIdsMock.mockReturnValue([]);
    renderShortlist();
    expect(screen.getByRole("heading", { name: "Saved Players" })).toBeInTheDocument();
    expect(screen.getByText("My Favorites")).toBeInTheDocument();
    expect(screen.queryByText("Saved decisions")).not.toBeInTheDocument();
  });

  it("shows an empty state with a path back to discovery", () => {
    usePlayersByIdsMock.mockReturnValue([]);
    renderShortlist();
    expect(screen.getByText(/No players saved yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /discovery/i })).toBeInTheDocument();
  });

  it("renders a resolved saved player on the ledger row, keeping the browser-local count", () => {
    resolve();
    renderShortlist();
    const record = screen.getByTestId("shortlist-record");
    expect(record.className).toContain("ledger-row");
    expect(within(record).getByText("90.0")).toBeInTheDocument();
    expect(within(record).getByTestId("score-caption")).toHaveTextContent("Shadow Striker");
    expect(within(record).getByTestId("market-readout")).toHaveTextContent("€58.0M");
    expect(screen.getByTestId("shortlist-ledger")).toBeInTheDocument();
    expect(screen.getByTestId("page-meta")).toHaveTextContent("1 resolved player · saved on this device");
  });

  it("uses the ledger status variants, not the old Evidence:/RoleFit confidence: presentation", () => {
    resolve();
    renderShortlist();
    const record = screen.getByTestId("shortlist-record");
    expect(record).not.toHaveTextContent("Evidence:");
    expect(record).not.toHaveTextContent("RoleFit confidence:");
    expect(within(record).queryByTestId("evidence-tag")).not.toBeInTheDocument();
    expect(within(record).queryByTestId("confidence-readout")).not.toBeInTheDocument();
    const status = within(record).getByTestId("card-status");
    expect(status).toHaveTextContent("High Data Coverage");
    expect(status).toHaveTextContent("High Confidence");
    expect(status).toHaveAttribute("data-tag-variant", "evidence");
    expect(status.className).toContain("display-tag-compound");
    // playstyles use the shared dark playstyle tag
    const badge = within(record).getByText("Box Crasher");
    expect(badge).toHaveAttribute("data-tag-variant", "playstyle");
    expect(badge.className).toContain("display-tag");
    expect(badge.className).not.toContain("chip");
  });

  it("stacks coverage, market and playstyles as three distinct lines in order", () => {
    resolve();
    renderShortlist();
    const stack = within(screen.getByTestId("shortlist-record")).getByTestId("row-status-stack");
    expect([...stack.children].map((el) => el.getAttribute("data-testid"))).toEqual([
      "status-line-coverage",
      "status-line-market",
      "status-line-playstyles",
    ]);
  });

  it("sources coverage and confidence independently on a saved row", () => {
    // high evidence coverage on the card, low confidence on the best rating
    resolve({
      evidence_status: "high_coverage",
      role_ratings: [summary("shadow_striker", "Shadow Striker", 90, "low", true)],
    });
    renderShortlist();
    const status = within(screen.getByTestId("shortlist-record")).getByTestId("card-status");
    expect(status).toHaveTextContent("High Data Coverage");
    expect(status).toHaveTextContent("Low Confidence");
    expect(status).toHaveAccessibleName("Evidence coverage: high. RoleFit confidence: low.");
  });

  it("wraps a long saved role on word boundaries without truncating it", () => {
    resolve({
      role_ratings: [summary("deep_lying_playmaker", "Deep-Lying Playmaker", 79.7, "high", true)],
    });
    renderShortlist();
    const caption = within(screen.getByTestId("shortlist-record")).getByTestId("score-caption");
    expect(caption.textContent).toBe("Deep-Lying Playmaker");
    expect(
      [...caption.querySelectorAll("span.whitespace-nowrap")].map((el) => el.textContent),
    ).toEqual(["Deep-Lying", "Playmaker"]);
  });

  it("keeps profile-only saved players honest (no fake score/confidence)", () => {
    resolve(
      { has_rolefit_analysis: false, role_ratings: [], evidence_status: "profile_only", playstyles: [], market: null },
      [9],
    );
    renderShortlist();
    const record = screen.getByTestId("shortlist-record");
    // the hero carries the honest Profile Only tag (the coverage unit says it too)
    expect(within(record).getByTestId("row-rolefit")).toHaveTextContent("Profile Only");
    expect(within(record).queryByTestId("score-readout")).not.toBeInTheDocument();
    expect(within(record).queryByTestId("confidence-meter")).not.toBeInTheDocument();
    expect(within(record).queryByText("0.0")).not.toBeInTheDocument();
    const market = within(record).getByTestId("market-readout");
    expect(market).toHaveTextContent("Unknown");
    expect(market).not.toHaveTextContent("€0");
    expect(within(record).getByTestId("profile-only-card")).toHaveTextContent("Analysis unavailable");
  });

  it("keeps a partial saved market range honest, never €0", () => {
    resolve({
      market: {
        label: "fair",
        expected_asking_low_eur: 20_000_000,
        expected_asking_high_eur: null,
        confidence: "medium",
        manual_review_required: false,
        explanation: {},
      } as unknown as PlayerCard["market"],
    });
    renderShortlist();
    const market = within(screen.getByTestId("shortlist-record")).getByTestId("market-readout");
    expect(market).toHaveTextContent("From €20.0M");
    expect(market).not.toHaveTextContent("€0");
  });

  it("offers Remove and Compare in the rail, with no visible vs", () => {
    resolve();
    renderShortlist();
    const rail = within(screen.getByTestId("shortlist-record")).getByTestId("action-rail");
    const remove = within(rail).getByTestId("remove-action");
    const compare = within(rail).getByTestId("compare-action");
    expect(remove.textContent).toBe("Remove");
    expect(compare.textContent).toBe("Compare");
    expect(rail).not.toHaveTextContent("vs");
    // no heart: the player is already saved
    expect(within(rail).queryByTestId("favorite-heart")).not.toBeInTheDocument();
    // Remove is the top/left half, Compare the bottom/right half
    expect([...within(rail).getByTestId("action-rail-box").children]).toEqual([remove, compare]);
  });

  it("names Remove per player and drops it from browser-local saved state", () => {
    resolve();
    renderShortlist();
    const remove = screen.getByTestId("remove-action");
    expect(remove).toHaveAccessibleName("Remove Anton Keller from My Favorites");
    fireEvent.click(remove);
    expect(JSON.parse(window.localStorage.getItem("scoutboy.shortlist.v1")!)).toEqual([]);
  });

  it("keeps compare-queue behaviour and pressed state on a saved row", () => {
    resolve();
    renderShortlist();
    const compare = screen.getByTestId("compare-action");
    expect(compare).toHaveAccessibleName("Add Anton Keller to compare queue");
    expect(compare).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(compare);
    expect(compare).toHaveAttribute("aria-pressed", "true");
    expect(compare).toHaveAccessibleName("Remove Anton Keller from compare queue");
    // toggling must not change the visible copy (no layout shift)
    expect(compare.textContent).toBe("Compare");
  });

  it("surfaces stale saved ids with a removal path", () => {
    window.localStorage.setItem("scoutboy.shortlist.v1", JSON.stringify([6, 999]));
    usePlayersByIdsMock.mockReturnValue([
      { data: makePlayerCard(), isLoading: false, isError: false },
      { data: undefined, isLoading: false, isError: true },
    ]);
    renderShortlist();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be resolved and may be stale/);
    expect(screen.getByRole("button", { name: /Remove stale id 999/ })).toBeInTheDocument();
  });

  it("shows a structural skeleton while saved players resolve", () => {
    window.localStorage.setItem("scoutboy.shortlist.v1", JSON.stringify([6]));
    usePlayersByIdsMock.mockReturnValue([{ data: undefined, isLoading: true, isError: false }]);
    renderShortlist();
    expect(screen.getByTestId("ledger-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Saved Players" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Shared readouts + status primitives
// ---------------------------------------------------------------------------
describe("Shared readout primitives", () => {
  it("ScoreReadout renders the missing sentinel, never zero", () => {
    const { rerender } = render(<ScoreReadout score={null} />);
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByText("0.0")).not.toBeInTheDocument();
    rerender(<ScoreReadout score={82.4} caption="Inside Forward" />);
    expect(screen.getByText("82.4")).toBeInTheDocument();
    expect(screen.getByText("Inside Forward")).toBeInTheDocument();
  });

  it("MarketReadout preserves partial ranges and never renders €0", () => {
    const { rerender } = render(<MarketReadout label="inflated" low={1_000_000} high={2_000_000} />);
    expect(screen.getByTestId("market-readout")).toHaveTextContent("Inflated");
    expect(screen.getByTestId("market-readout")).toHaveTextContent("€1.0M – €2.0M");
    rerender(<MarketReadout label={null} low={null} high={null} />);
    expect(screen.getByTestId("market-readout")).toHaveTextContent("Unknown");
    expect(screen.getByTestId("market-readout")).not.toHaveTextContent("€0");
  });

  it("EvidenceTag and ConfidenceReadout are labelled, distinct channels", () => {
    render(
      <div>
        <EvidenceTag status="profile_only" />
        <ConfidenceReadout level="low" />
      </div>,
    );
    expect(screen.getByTestId("evidence-tag")).toHaveTextContent("Evidence:");
    expect(screen.getByTestId("evidence-tag")).toHaveTextContent("Profile Only");
    const conf = screen.getByTestId("confidence-readout");
    expect(conf).toHaveTextContent("RoleFit confidence:");
    expect(within(conf).getByTestId("confidence-meter").getAttribute("data-confidence")).toBe("low");
  });

  it("LedgerSkeleton is a polite status region with an accessible label and no fabricated values", () => {
    render(<LedgerSkeleton rows={3} label="Loading players…" />);
    const skeleton = screen.getByTestId("ledger-skeleton");
    expect(skeleton).toHaveAttribute("role", "status");
    expect(skeleton).toHaveTextContent("Loading players…");
    // no numbers/names fabricated inside the placeholder
    expect(skeleton.textContent?.replace("Loading players…", "").trim()).toBe("");
  });

  it("PageHeader renders eyebrow, title, and an optional metadata line", () => {
    render(<PageHeader eyebrow="Role leaderboard" title="Touchline Winger" meta="ATT · 6 rated players · 2023/24" />);
    expect(screen.getByRole("heading", { name: "Touchline Winger" })).toBeInTheDocument();
    expect(screen.getByTestId("page-meta")).toHaveTextContent("6 rated players");
  });
});
