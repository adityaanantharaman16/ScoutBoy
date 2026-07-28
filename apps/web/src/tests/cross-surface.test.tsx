import { render, screen, within } from "@testing-library/react";
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
  return {
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
    const conf = screen.getByTestId("card-confidence");
    expect(conf).toHaveTextContent("RoleFit confidence:");
    expect(within(conf).getByTestId("confidence-meter").getAttribute("data-confidence")).toBe("low");
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
  const filters = { scope: "analyzed", age_band: "all", sort: "rolefit_desc", page: 1 };

  it("shows a structural skeleton while loading (page identity preserved elsewhere)", () => {
    usePlayerSearchMock.mockReturnValue({ isLoading: true });
    render(<PlayerSearchResults filters={filters} selectedScope="Analyzed" selectedAgeBand="All ages" onPage={noop} />);
    expect(screen.getByTestId("ledger-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("ledger-skeleton")).toHaveAttribute("role", "status");
  });

  it("shows an honest empty state with no fabricated rows", () => {
    usePlayerSearchMock.mockReturnValue({ isLoading: false, isError: false, data: { items: [], total: 0, page: 1, page_size: 12, total_pages: 0 } });
    render(<PlayerSearchResults filters={filters} selectedScope="Analyzed" selectedAgeBand="All ages" onPage={noop} />);
    expect(screen.getByText(/No players match these filters/)).toBeInTheDocument();
  });

  it("shows an alert on request failure", () => {
    usePlayerSearchMock.mockReturnValue({ isLoading: false, isError: true, error: new Error("boom") });
    render(<PlayerSearchResults filters={filters} selectedScope="Analyzed" selectedAgeBand="All ages" onPage={noop} />);
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

  it("shows an explicit unavailable state when a side lacks the selected role", () => {
    const data = makeCompare({
      player_b: side("Jack Whitmore", { role_ratings: [summary("inside_forward", "Inside Forward", 60)] }),
    });
    render(<PlayerCompareTable data={data} />);
    expect(screen.getByTestId("compare-unavailable-right")).toHaveTextContent("Not rated in this role");
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

  it("describes the Automatic-role fallback accurately (A's best role, then B's)", () => {
    render(<ComparePage />);
    expect(
      screen.getByText(/Uses Player A.s best-rated role, falling back to Player B.s\./),
    ).toBeInTheDocument();
    // the inaccurate "most comparable" / "best shared" implications are gone
    expect(screen.queryByText(/most comparable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/best shared/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Shortlist — saved-decision ledger
// ---------------------------------------------------------------------------
describe("Shortlist saved decisions", () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePlayersByIdsMock.mockReset();
  });

  const renderShortlist = () => render(<ScoutingStateProvider><ShortlistPage /></ScoutingStateProvider>);

  it("shows an empty state with a path back to discovery", () => {
    usePlayersByIdsMock.mockReturnValue([]);
    renderShortlist();
    expect(screen.getByText(/No players saved yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /discovery/i })).toBeInTheDocument();
  });

  it("renders a resolved saved record with score, confidence, evidence, and market", () => {
    window.localStorage.setItem("scoutboy.shortlist.v1", JSON.stringify([6]));
    usePlayersByIdsMock.mockReturnValue([{ data: makePlayerCard(), isLoading: false, isError: false }]);
    renderShortlist();
    const record = screen.getByTestId("shortlist-record");
    expect(within(record).getByText("90.0")).toBeInTheDocument();
    expect(within(record).getByText("Shadow Striker")).toBeInTheDocument();
    expect(within(record).getByTestId("evidence-tag")).toHaveTextContent("High Coverage");
    expect(within(record).getByTestId("confidence-readout")).toBeInTheDocument();
    expect(within(record).getByTestId("market-readout")).toHaveTextContent("€58.0M");
  });

  it("keeps profile-only saved players honest (no fake score/confidence)", () => {
    window.localStorage.setItem("scoutboy.shortlist.v1", JSON.stringify([9]));
    usePlayersByIdsMock.mockReturnValue([
      { data: makePlayerCard({ has_rolefit_analysis: false, role_ratings: [], evidence_status: "profile_only", playstyles: [], market: null }), isLoading: false, isError: false },
    ]);
    renderShortlist();
    const record = screen.getByTestId("shortlist-record");
    expect(within(record).getByText("Profile only")).toBeInTheDocument();
    expect(within(record).queryByTestId("confidence-readout")).not.toBeInTheDocument();
    expect(within(record).getByTestId("market-readout")).toHaveTextContent("Unknown");
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
});

// ---------------------------------------------------------------------------
// Shared readouts + status primitives
// ---------------------------------------------------------------------------
describe("Shared readout primitives", () => {
  it("ScoreReadout renders the missing sentinel, never zero", () => {
    const { rerender } = render(<ScoreReadout score={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
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
