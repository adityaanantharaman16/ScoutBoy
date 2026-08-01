import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavBar } from "@/components/common/NavBar";
import { ResultCard } from "@/components/search/PlayerSearchResults";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import type { PlayerSearchCard } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const SHORTLIST_KEY = "scoutboy.shortlist.v1";

function makeCard(over: Partial<PlayerSearchCard> = {}): PlayerSearchCard {
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
    confidence: "high",
    analysis_status: "analyzed",
    evidence_status: "high_coverage",
    has_rolefit_analysis: true,
    is_high_coverage: true,
    top_playstyles: ["Technical Carrier", "Box Crasher"],
    minutes: 1800,
    represented_minutes: 1800,
    market_label: "inflated",
    expected_asking_low_eur: 58_500_000,
    expected_asking_high_eur: 87_800_000,
    ...over,
  } as PlayerSearchCard;
}

const PROFILE_ONLY: Partial<PlayerSearchCard> = {
  best_role: null,
  best_role_display: null,
  best_role_score: null,
  confidence: "unknown",
  analysis_status: "profile_only",
  evidence_status: "profile_only",
  has_rolefit_analysis: false,
  is_high_coverage: false,
  top_playstyles: [],
  market_label: null,
  expected_asking_low_eur: null,
  expected_asking_high_eur: null,
};

function renderRow(over: Partial<PlayerSearchCard> = {}) {
  return render(
    <ScoutingStateProvider>
      <ResultCard p={makeCard(over)} />
    </ScoutingStateProvider>,
  );
}

beforeEach(() => window.localStorage.clear());

// ---------------------------------------------------------------------------
// compound coverage + confidence status
// ---------------------------------------------------------------------------
describe("Discovery compound coverage/confidence status", () => {
  it("drops the Evidence: and RoleFit confidence: prefixes", () => {
    renderRow();
    const row = screen.getByTestId("result-row");
    expect(row).not.toHaveTextContent("Evidence:");
    expect(row).not.toHaveTextContent("RoleFit confidence:");
    expect(screen.queryByTestId("evidence-tag")).not.toBeInTheDocument();
    expect(screen.queryByTestId("confidence-readout")).not.toBeInTheDocument();
  });

  it("states coverage and confidence as two equally weighted facts in one unit", () => {
    renderRow();
    const status = screen.getByTestId("card-status");
    expect(status).toHaveTextContent("High Data Coverage");
    expect(status).toHaveTextContent("High Confidence");
    expect(within(status).getByTestId("confidence-meter")).toBeInTheDocument();
    expect(status).toHaveAccessibleName("Evidence coverage: high. RoleFit confidence: high.");
    // sharp-edged compound tag, not a pill
    expect(status).toHaveAttribute("data-tag-variant", "evidence");
    expect(status.className).toContain("display-tag-compound");
    expect(status.className).not.toContain("chip");
  });

  it("sources coverage and confidence independently (high coverage, low confidence)", () => {
    renderRow({ evidence_status: "high_coverage", confidence: "low" });
    const status = screen.getByTestId("card-status");
    // both facts stay visible; neither is inferred from the other
    expect(status).toHaveTextContent("High Data Coverage");
    expect(status).toHaveTextContent("Low Confidence");
    expect(within(status).getByTestId("confidence-meter")).toHaveAttribute(
      "data-confidence",
      "low",
    );
    expect(status).toHaveAccessibleName("Evidence coverage: high. RoleFit confidence: low.");
  });

  it("keeps limited coverage with high confidence readable as two facts", () => {
    renderRow({ evidence_status: "analyzed_limited", confidence: "high" });
    const status = screen.getByTestId("card-status");
    expect(status).toHaveTextContent("Limited Data Coverage");
    expect(status).toHaveTextContent("High Confidence");
    expect(status).toHaveAccessibleName("Evidence coverage: limited. RoleFit confidence: high.");
  });

  it("keeps the confidence glyph monochrome, never the score palette", () => {
    renderRow({ best_role_score: 92.1, confidence: "low" });
    const meter = within(screen.getByTestId("card-status")).getByTestId("confidence-meter");
    expect(meter.className).not.toMatch(/text-(elite|pitch|accent)/);
    // the high score keeps its own band colour, separately
    expect(screen.getByText("92.1").className).toContain("text-elite");
  });

  it("shows an unknown confidence as explicitly neutral, not as low", () => {
    renderRow({ confidence: "unknown" });
    const status = screen.getByTestId("card-status");
    expect(status).toHaveTextContent("Unknown Confidence");
    expect(within(status).getByTestId("confidence-meter")).toHaveAttribute(
      "data-confidence",
      "unknown",
    );
  });

  it("shows an unknown coverage as explicitly neutral", () => {
    renderRow({ evidence_status: "unknown" });
    const status = screen.getByTestId("card-status");
    expect(status).toHaveTextContent("Unknown Data Coverage");
    expect(status).toHaveAccessibleName("Evidence coverage: unknown. RoleFit confidence: high.");
  });

  it("gives profile-only rows a neutral status with no fabricated confidence", () => {
    renderRow(PROFILE_ONLY);
    const status = screen.getByTestId("card-status");
    expect(status).toHaveTextContent("Profile Only");
    expect(within(status).queryByTestId("confidence-meter")).not.toBeInTheDocument();
    expect(status).not.toHaveTextContent("Confidence");
    expect(status).toHaveAccessibleName(
      "Evidence coverage: profile only. RoleFit confidence: not available.",
    );
    // and no score is invented for the hero
    expect(screen.queryByText("0.0")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// three deliberate status lines
// ---------------------------------------------------------------------------
describe("Discovery status structure", () => {
  it("stacks coverage, market and playstyles as three distinct containers in order", () => {
    renderRow();
    const stack = screen.getByTestId("row-status-stack");
    const lines = [...stack.children].map((el) => el.getAttribute("data-testid"));
    expect(lines).toEqual([
      "status-line-coverage",
      "status-line-market",
      "status-line-playstyles",
    ]);
  });

  it("keeps the market box out of the coverage line by structure, not by wrapping", () => {
    renderRow();
    const coverage = screen.getByTestId("status-line-coverage");
    const market = screen.getByTestId("status-line-market");
    expect(within(coverage).queryByTestId("market-readout")).not.toBeInTheDocument();
    expect(coverage).not.toHaveTextContent("Inflated");
    expect(within(market).getByTestId("market-readout")).toBeInTheDocument();
    // separate block-level siblings — neither is a flex child of the other
    expect(market.parentElement).toBe(coverage.parentElement);
    expect(coverage.contains(market)).toBe(false);
  });

  it("keeps the three lines in order for a profile-only row too", () => {
    renderRow(PROFILE_ONLY);
    const lines = [...screen.getByTestId("row-status-stack").children].map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(lines).toEqual([
      "status-line-coverage",
      "status-line-market",
      "status-line-playstyles",
    ]);
  });
});

// ---------------------------------------------------------------------------
// long role names in the fixed RoleFit track
// ---------------------------------------------------------------------------
describe("Discovery RoleFit role caption", () => {
  it("keeps a long role name complete and applies the word-boundary treatment", () => {
    renderRow({ best_role: "deep_lying_playmaker", best_role_display: "Deep-Lying Playmaker" });
    const caption = screen.getByTestId("score-caption");
    // complete text, no truncation and no ellipsis
    expect(caption).toHaveTextContent("Deep-Lying Playmaker");
    expect(caption.textContent).toBe("Deep-Lying Playmaker");
    expect(caption.textContent).not.toContain("…");
    expect(caption.textContent).not.toContain("...");
    // one non-wrapping span per space-delimited word, so breaks can only fall on
    // spaces and "Deep-Lying" cannot split at its hyphen
    const words = [...caption.querySelectorAll("span.whitespace-nowrap")].map(
      (el) => el.textContent,
    );
    expect(words).toEqual(["Deep-Lying", "Playmaker"]);
  });

  it("keeps a hyphenated first word intact for Ball-Winning Midfielder", () => {
    renderRow({
      best_role: "ball_winning_midfielder",
      best_role_display: "Ball-Winning Midfielder",
    });
    const caption = screen.getByTestId("score-caption");
    expect(caption.textContent).toBe("Ball-Winning Midfielder");
    const words = [...caption.querySelectorAll("span.whitespace-nowrap")].map(
      (el) => el.textContent,
    );
    expect(words).toEqual(["Ball-Winning", "Midfielder"]);
  });

  it("leaves a single-word role and the score band untouched", () => {
    renderRow({ best_role_display: "Advanced 8", best_role_score: 74.2 });
    const caption = screen.getByTestId("score-caption");
    expect(caption.textContent).toBe("Advanced 8");
    expect(screen.getByText("74.2").className).toContain("text-pitch");
  });
});

// ---------------------------------------------------------------------------
// market status
// ---------------------------------------------------------------------------
describe("Discovery market status", () => {
  it("puts the risk label and the price range inside one sharp status unit", () => {
    renderRow();
    const market = screen.getByTestId("market-readout");
    expect(market).toHaveTextContent("Inflated");
    expect(market).toHaveTextContent("€58.5M – €87.8M");
    expect(market).toHaveAttribute("data-tag-variant", "market");
    expect(market.className).toContain("display-tag-compound");
    expect(market.className).not.toContain("chip");
    // amber risk colour preserved
    expect(market.className).toContain("text-accent-amber");
  });

  it("preserves the established high-risk colour", () => {
    renderRow({ market_label: "high-risk" });
    const market = screen.getByTestId("market-readout");
    expect(market).toHaveTextContent("High-Risk");
    expect(market.className).toContain("text-accent-red");
  });

  it("keeps a partial range honest and never renders €0", () => {
    const { rerender } = renderRow({
      market_label: "fair",
      expected_asking_low_eur: 20_000_000,
      expected_asking_high_eur: null,
    });
    let market = screen.getByTestId("market-readout");
    expect(market).toHaveTextContent("Fair");
    expect(market).toHaveTextContent("From €20.0M");
    expect(market).not.toHaveTextContent("€0");

    rerender(
      <ScoutingStateProvider>
        <ResultCard
          p={makeCard({
            market_label: "fair",
            expected_asking_low_eur: null,
            expected_asking_high_eur: 20_000_000,
          })}
        />
      </ScoutingStateProvider>,
    );
    market = screen.getByTestId("market-readout");
    expect(market).toHaveTextContent("Up to €20.0M");
    expect(market).not.toHaveTextContent("€0");
  });

  it("renders a missing market as a neutral Unknown · Unknown unit", () => {
    renderRow(PROFILE_ONLY);
    const market = screen.getByTestId("market-readout");
    expect(market).toHaveTextContent("Unknown");
    expect(market).not.toHaveTextContent("€0");
    expect(market).toHaveAttribute("data-market-label", "unknown");
  });
});

// ---------------------------------------------------------------------------
// playstyles
// ---------------------------------------------------------------------------
describe("Discovery playstyle line", () => {
  it("renders playstyles in supplied order inside a dedicated container", () => {
    renderRow();
    const line = screen.getByTestId("status-line-playstyles");
    const labels = within(line)
      .getAllByText(/Technical Carrier|Box Crasher/)
      .map((el) => el.textContent);
    expect(labels).toEqual(["Technical Carrier", "Box Crasher"]);
  });

  it("never shares its container with market, coverage or confidence", () => {
    renderRow();
    const line = screen.getByTestId("status-line-playstyles");
    expect(within(line).queryByTestId("market-readout")).not.toBeInTheDocument();
    expect(within(line).queryByTestId("card-status")).not.toBeInTheDocument();
    expect(within(line).queryByTestId("confidence-meter")).not.toBeInTheDocument();
    // and neither status line carries playstyles
    expect(screen.getByTestId("status-line-coverage")).not.toHaveTextContent("Technical Carrier");
    expect(screen.getByTestId("status-line-market")).not.toHaveTextContent("Technical Carrier");
  });

  it("uses the shared dark playstyle tag, not a rounded chip", () => {
    renderRow();
    const badge = within(screen.getByTestId("status-line-playstyles")).getByText("Technical Carrier");
    expect(badge).toHaveAttribute("data-tag-variant", "playstyle");
    expect(badge.className).toContain("display-tag");
    expect(badge.className).toContain("bg-ink");
    expect(badge.className).not.toContain("chip");
  });

  it("keeps the no-qualifying-playstyles note on the dedicated line, not as a badge", () => {
    renderRow({ top_playstyles: [] });
    const line = screen.getByTestId("status-line-playstyles");
    const note = within(line).getByTestId("no-playstyles");
    expect(note).toHaveTextContent("No qualifying playstyles");
    expect(note).not.toHaveAttribute("data-tag-variant");
    expect(note.className).not.toContain("display-tag");
  });

  it("keeps the profile-only analysis fallback on the dedicated line", () => {
    renderRow(PROFILE_ONLY);
    const line = screen.getByTestId("status-line-playstyles");
    const note = within(line).getByTestId("profile-only-card");
    expect(note).toHaveTextContent("Analysis unavailable");
    expect(note).not.toHaveAttribute("data-tag-variant");
    expect(note.className).not.toContain("display-tag");
    expect(within(line).queryByTestId("no-playstyles")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// action rail
// ---------------------------------------------------------------------------
describe("Discovery action rail", () => {
  it("names the favourite action per player and tracks its pressed state", () => {
    renderRow();
    const favorite = screen.getByTestId("favorite-action");
    expect(favorite).toHaveAccessibleName("Add Anton Keller to My Favorites");
    expect(favorite).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(favorite);
    expect(favorite).toHaveAccessibleName("Remove Anton Keller from My Favorites");
    expect(favorite).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a heart icon only — no Shortlist text, plus sign or emoji", () => {
    renderRow();
    const favorite = screen.getByTestId("favorite-action");
    expect(within(favorite).getByTestId("favorite-heart")).toBeInTheDocument();
    expect(favorite.textContent).toBe("");
    const rail = screen.getByTestId("action-rail");
    expect(rail).not.toHaveTextContent("Shortlist");
    expect(rail).not.toHaveTextContent("Shortlisted");
    expect(rail).not.toHaveTextContent("+");
    expect(rail).not.toHaveTextContent(/[♥❤]/);
  });

  it("keeps the heart's geometry identical between inactive and active", () => {
    renderRow();
    const favorite = screen.getByTestId("favorite-action");
    const heart = () => screen.getByTestId("favorite-heart");
    const geometry = (el: Element) => ({
      tag: el.tagName,
      viewBox: el.getAttribute("viewBox"),
      width: el.getAttribute("width"),
      height: el.getAttribute("height"),
      strokeWidth: el.getAttribute("stroke-width"),
      paths: el.querySelectorAll("path").length,
      d: el.querySelector("path")?.getAttribute("d"),
    });

    const inactive = geometry(heart());
    const inactiveButtonClass = favorite.className;
    expect(heart()).toHaveAttribute("data-filled", "false");
    expect(heart()).toHaveAttribute("fill", "none");

    fireEvent.click(favorite);
    expect(heart()).toHaveAttribute("data-filled", "true");
    expect(heart()).toHaveAttribute("fill", "currentColor");
    // only the fill changed: same element, same box, same class list
    expect(geometry(heart())).toEqual(inactive);
    expect(favorite.className).toBe(inactiveButtonClass);
  });

  it("labels the compare action Compare with no visible vs", () => {
    renderRow();
    const compare = screen.getByTestId("compare-action");
    expect(compare).toHaveTextContent("Compare");
    expect(compare.textContent).toBe("Compare");
    expect(screen.getByTestId("action-rail")).not.toHaveTextContent("vs");
    expect(compare).toHaveAccessibleName("Add Anton Keller to compare queue");
    expect(compare).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(compare);
    expect(compare).toHaveAttribute("aria-pressed", "true");
    expect(compare.textContent).toBe("Compare");
    expect(compare).toHaveAccessibleName("Remove Anton Keller from compare queue");
  });
});

// ---------------------------------------------------------------------------
// composition + terminology
// ---------------------------------------------------------------------------
describe("Discovery row composition", () => {
  it("keeps the three regions and the hero's score/role together", () => {
    renderRow();
    const row = screen.getByTestId("result-row");
    expect(row.className).toContain("ledger-row");
    const hero = within(row).getByTestId("row-rolefit");
    expect(hero).toHaveTextContent("RoleFit");
    expect(within(hero).getByText("88.4")).toBeInTheDocument();
    expect(within(hero).getByTestId("score-caption")).toHaveTextContent("Shadow Striker");
    expect(within(row).getByTestId("row-identity")).toHaveTextContent("Anton Keller");
    expect(within(row).getByTestId("action-rail")).toBeInTheDocument();
    // the hero is not wrapped in a card/panel of its own
    expect(hero.className).not.toContain("card");
    expect(hero.className).not.toContain("territory-surface");
  });
});

describe("My Favorites terminology", () => {
  const renderNav = () =>
    render(
      <ScoutingStateProvider>
        <NavBar />
      </ScoutingStateProvider>,
    );

  it("labels the navigation destination and counter My Favorites", () => {
    renderNav();
    const link = screen.getByTestId("nav-shortlist");
    expect(link).toHaveTextContent("My Favorites");
    expect(link).not.toHaveTextContent("Shortlist");
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
      "My Favorites 0 · saved on this device",
    );
  });

  it("keeps the /shortlist route and the stable nav test id", () => {
    renderNav();
    expect(screen.getByTestId("nav-shortlist")).toHaveAttribute("href", "/shortlist");
    // no test id is derived from the new label (which would contain a space)
    expect(screen.queryByTestId("nav-my favorites")).not.toBeInTheDocument();
  });

  it("stores favourited ids under the unchanged local-storage key, in order", () => {
    render(
      <ScoutingStateProvider>
        <ResultCard p={makeCard({ id: 7 })} />
        <ResultCard p={makeCard({ id: 3, canonical_name: "Jack Whitmore" })} />
        <NavBar />
      </ScoutingStateProvider>,
    );
    const [first, second] = screen.getAllByTestId("favorite-action");
    fireEvent.click(first);
    fireEvent.click(second);
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([7, 3]);
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
      "My Favorites 2 · saved on this device",
    );

    fireEvent.click(first);
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([3]);
  });
});
