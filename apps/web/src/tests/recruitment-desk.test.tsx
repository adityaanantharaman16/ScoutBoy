import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConfidenceMeter } from "@/components/player/ConfidenceMeter";
import { RecruitmentDesk } from "@/components/player/RecruitmentDesk";
import { RoleTerritory } from "@/components/player/RoleTerritory";
import type {
  AuditBreakdown,
  AuditGroupView,
  PlayerCard,
  RoleRatingDetail,
  RoleRatingSummary,
} from "@/lib/api/types";
import { orderGroupsByWeight } from "@/lib/audit/roleAudit";
import { territoryForGroup } from "@/lib/territory/roleTerritoryMap";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

// ---- deterministic fixtures (no production data) ----

function group(
  key: string,
  weight: number,
  score: number | null,
  metrics: AuditGroupView["metrics"] = [{ display: "Metric A", score, present: score != null }],
): AuditGroupView {
  return { key, weight, normalized_weight: weight, group_score: score, metrics };
}

const SS_GROUPS: AuditGroupView[] = [
  group("box_presence", 0.25, 94, [{ display: "Touches in box", score: 94, present: true }]),
  group("shot_threat", 0.2, 91, [{ display: "Non-penalty xG", score: 91, present: true }]),
  group("arrival_carrying", 0.15, 81, [
    { display: "Carries into penalty area", score: 81, present: true },
    { display: "Missing metric", score: null, present: false },
  ]),
  group("possession_security", 0.05, 44), // non-spatial
  group("finishing_confidence", 0.1, null), // non-spatial + unknown
];

const IF_GROUPS: AuditGroupView[] = [
  group("box_presence", 0.3, 88),
  group("defensive_contribution", 0.2, 59),
];

function audit(role: string, groups: AuditGroupView[], confLevel = "high", confScore = 0.92): AuditBreakdown {
  return {
    role_key: role,
    metric_breakdown: { raw_score: 80, groups },
    context_breakdown: {},
    confidence_breakdown: { score: confScore, level: confLevel },
    penalties: { total: 0, items: [] },
    explanation_text: `Explanation for ${role}.`,
  } as unknown as AuditBreakdown;
}

function summary(
  role: string,
  display: string,
  score: number,
  isBest: boolean,
  confidence = "high",
  rank: number | null = 1,
): RoleRatingSummary {
  return {
    role_key: role,
    display_name: display,
    final_score: score,
    raw_score: score,
    context_adjusted_score: score,
    confidence,
    rank_in_peer_group: rank,
    is_best: isBest,
  } as unknown as RoleRatingSummary;
}

function makeCard(overrides: Partial<PlayerCard> = {}): PlayerCard {
  return {
    identity: {
      id: 6,
      canonical_name: "Anton Keller",
      club: "Stuttgart",
      league: "Bundesliga",
      age: 21,
      primary_position: "CF",
      secondary_positions: ["AM"],
      nationality: "Germany",
      preferred_foot: "R",
      height_cm: 182,
    },
    season: "2023/24",
    evidence_status: "high_coverage",
    has_rolefit_analysis: true,
    role_ratings: [
      summary("inside_forward", "Inside Forward", 72.3, false, "high", 3),
      summary("shadow_striker", "Shadow Striker", 90.0, true, "high", 1),
    ],
    context: { minutes: 1550, appearances: 20, overall_rating_confidence: "high" },
    market: {
      label: "inflated",
      expected_asking_low_eur: 58_000_000,
      expected_asking_high_eur: 87_000_000,
      manual_review_required: false,
    },
    ...overrides,
  } as unknown as PlayerCard;
}

function makeRatings(overrides: Partial<RoleRatingDetail> = {}): RoleRatingDetail {
  return {
    player_id: 6,
    season: "2023/24",
    rating_version: "rolefit-v2",
    ratings: [
      summary("shadow_striker", "Shadow Striker", 90.0, true, "high", 1),
      summary("inside_forward", "Inside Forward", 72.3, false, "high", 3),
    ],
    audits: [audit("shadow_striker", SS_GROUPS), audit("inside_forward", IF_GROUPS)],
    ...overrides,
  } as unknown as RoleRatingDetail;
}

function renderDesk(card = makeCard(), ratings: RoleRatingDetail | undefined = makeRatings(), extra = {}) {
  return render(
    <ScoutingStateProvider>
      <RecruitmentDesk card={card} ratings={ratings} {...extra} />
    </ScoutingStateProvider>,
  );
}

describe("Presentation-only territory map", () => {
  it("keeps non-spatial groups off the pitch (returns null)", () => {
    expect(territoryForGroup("possession_security")).toBeNull();
    expect(territoryForGroup("finishing_confidence")).toBeNull();
    expect(territoryForGroup("shot_volume")).toBeNull();
    // unmapped/future keys are not guessed onto the pitch
    expect(territoryForGroup("some_new_group")).toBeNull();
  });

  it("places defensibly spatial groups on abstract territories", () => {
    expect(territoryForGroup("box_presence")).toBe("att_box");
    expect(territoryForGroup("shot_threat")).toBe("att_third");
    expect(territoryForGroup("defensive_contribution")).toBe("def_third");
  });
});

describe("orderGroupsByWeight", () => {
  it("orders by stored normalized_weight without deriving new numbers", () => {
    const ordered = orderGroupsByWeight(SS_GROUPS);
    expect(ordered.map((g) => g.key)).toEqual([
      "box_presence",
      "shot_threat",
      "arrival_carrying",
      "finishing_confidence",
      "possession_security",
    ]);
    // values are untouched (pass-through)
    expect(ordered[0].group_score).toBe(94);
  });
});

describe("RecruitmentDesk", () => {
  it("selects the best role initially", () => {
    renderDesk();
    const bestTab = screen.getByTestId("role-tab-shadow_striker");
    expect(bestTab).toHaveAttribute("aria-selected", "true");
    const summaryBlock = screen.getByTestId("selected-role-summary");
    expect(within(summaryBlock).getByText("90.0")).toBeInTheDocument();
    expect(within(summaryBlock).getByText(/best-rated role/i)).toBeInTheDocument();
  });

  it("switches role and shows that role's stored rating and matching audit", () => {
    renderDesk();
    fireEvent.click(screen.getByTestId("role-tab-inside_forward"));
    expect(screen.getByTestId("role-tab-inside_forward")).toHaveAttribute("aria-selected", "true");
    const summaryBlock = screen.getByTestId("selected-role-summary");
    expect(within(summaryBlock).getByText("72.3")).toBeInTheDocument();
    expect(within(summaryBlock).getByText(/Not this player's best-rated role/i)).toBeInTheDocument();
    // Inside Forward audit groups now present
    expect(screen.getByTestId("evidence-group-defensive_contribution")).toBeInTheDocument();
    // Shadow Striker-only groups gone
    expect(screen.queryByTestId("evidence-group-arrival_carrying")).not.toBeInTheDocument();
  });

  it("shows displayed group score identical to the stored audit value (no recompute)", () => {
    renderDesk();
    const boxGroup = screen.getByTestId("evidence-group-box_presence");
    // stored group_score is 94 -> shown as 94 (pass-through, never weight-multiplied)
    expect(within(boxGroup).getByText("94")).toBeInTheDocument();
    // role weight shown as an explicit, separate label (not folded into the score)
    expect(within(boxGroup).getByText(/Role weight 25%/)).toBeInTheDocument();
  });

  it("renders an unknown group as 'unknown', never zero", () => {
    renderDesk();
    const unknownGroup = screen.getByTestId("evidence-group-finishing_confidence");
    expect(within(unknownGroup).getByText("unknown")).toBeInTheDocument();
    expect(within(unknownGroup).queryByText("0")).not.toBeInTheDocument();
    expect(within(unknownGroup).getByText(/No measured evidence/i)).toBeInTheDocument();
  });

  it("distinguishes present from missing metrics", () => {
    renderDesk();
    const arrival = screen.getByTestId("evidence-group-arrival_carrying");
    expect(within(arrival).getByText(/Measured:/)).toHaveTextContent("Carries into penalty area");
    expect(within(arrival).getByText(/Missing:/)).toHaveTextContent("Missing metric (not measured)");
  });

  it("keeps every selected-role audit group visible in the evidence list", () => {
    renderDesk();
    for (const key of SS_GROUPS.map((g) => g.key)) {
      expect(screen.getByTestId(`evidence-group-${key}`)).toBeInTheDocument();
    }
  });

  it("labels non-spatial groups as not shown on the pitch (not forced on)", () => {
    renderDesk();
    const nonSpatial = screen.getByTestId("evidence-group-possession_security");
    expect(within(nonSpatial).getByText(/Not shown on pitch/i)).toBeInTheDocument();
    const spatial = screen.getByTestId("evidence-group-box_presence");
    expect(within(spatial).getByText(/Attacking penalty box/i)).toBeInTheDocument();
  });

  it("keeps role confidence in a separate channel from score magnitude", () => {
    // low confidence + high score should still read as a high magnitude number
    const ratings = makeRatings({
      ratings: [summary("shadow_striker", "Shadow Striker", 90.0, true, "low", 1)],
      audits: [audit("shadow_striker", SS_GROUPS, "low", 0.4)],
    } as Partial<RoleRatingDetail>);
    const card = makeCard({
      role_ratings: [summary("shadow_striker", "Shadow Striker", 90.0, true, "low", 1)],
    });
    renderDesk(card, ratings);
    const summaryBlock = screen.getByTestId("selected-role-summary");
    // magnitude still high
    expect(within(summaryBlock).getByText("90.0")).toBeInTheDocument();
    // confidence conveyed by the meter, not by the score colour
    const meters = screen.getAllByTestId("confidence-meter");
    expect(meters.some((m) => m.getAttribute("data-confidence") === "low")).toBe(true);
  });

  it("shows an honest fallback when the audit request fails", () => {
    renderDesk(makeCard(), undefined, { ratingsError: true });
    expect(screen.getByTestId("territory-error")).toBeInTheDocument();
    // identity + summary remain usable
    expect(screen.getByTestId("player-name")).toBeInTheDocument();
    expect(screen.getByTestId("selected-role-summary")).toBeInTheDocument();
  });

  it("shows an honest fallback when the selected role's audit is absent", () => {
    const ratings = makeRatings({ audits: [] } as Partial<RoleRatingDetail>);
    renderDesk(makeCard(), ratings);
    expect(screen.getByTestId("territory-unavailable")).toBeInTheDocument();
  });

  it("supports keyboard role selection via arrow keys", () => {
    renderDesk();
    const bestTab = screen.getByTestId("role-tab-shadow_striker");
    bestTab.focus();
    fireEvent.keyDown(bestTab, { key: "ArrowRight" });
    expect(screen.getByTestId("role-tab-inside_forward")).toHaveAttribute("aria-selected", "true");
  });

  it("does not break on very long names and labels", () => {
    const longName = "Maximiliano-Wolfgang von Habsburg-Lothringen-Schönbürg III";
    const card = makeCard({
      identity: { ...makeCard().identity, canonical_name: longName },
    } as Partial<PlayerCard>);
    renderDesk(card);
    expect(screen.getByTestId("player-name")).toHaveTextContent(longName);
  });
});

describe("RoleTerritory disclosure & legend", () => {
  it("shows the permanent illustrative-data disclosure as visible text", () => {
    render(
      <RoleTerritory roleDisplayName="Shadow Striker" groups={SS_GROUPS} roleConfidence="high" confidenceScore={0.9} />,
    );
    const disclosure = screen.getByTestId("territory-disclosure");
    expect(disclosure).toBeVisible();
    expect(disclosure).toHaveTextContent(
      "Illustrative role territory derived from RoleFit evidence groups. Not tracking or event-location data.",
    );
    expect(screen.getByTestId("territory-legend")).toBeInTheDocument();
  });
});

describe("ConfidenceMeter", () => {
  it("labels each level with text, not colour alone", () => {
    const { rerender } = render(<ConfidenceMeter level="high" />);
    expect(screen.getByRole("img", { name: /Confidence: high/i })).toBeInTheDocument();
    rerender(<ConfidenceMeter level={null} />);
    expect(screen.getByRole("img", { name: /Confidence: unknown/i })).toBeInTheDocument();
  });
});
