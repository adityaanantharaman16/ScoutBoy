import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { SimilarPlayers } from "@/components/player/SimilarPlayers";
import type { SimilarPlayer, SimilarResponse } from "@/lib/api/types";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";

function player(over: Partial<SimilarPlayer> = {}): SimilarPlayer {
  return {
    player_id: 11,
    canonical_name: "Anton Keller",
    club: "Stuttgart",
    league: "Bundesliga",
    age: 21,
    best_role: "shadow_striker",
    best_role_score: 88.4,
    similarity: 0.91,
    expected_asking_low_eur: 58_500_000,
    expected_asking_high_eur: 87_800_000,
    reason: "Similar statistical profile",
    ...over,
  } as SimilarPlayer;
}

function response(over: Partial<SimilarResponse> = {}): SimilarResponse {
  return {
    player_id: 1,
    season: "2023/24",
    groups: [
      {
        key: "style",
        label: "Style comps",
        description: "Closest statistical style within the same position group.",
        players: [player(), player({ player_id: 12, canonical_name: "Jack Whitmore" })],
      },
      {
        key: "quality",
        label: "Quality comps",
        description: "Stylistically similar and of comparable rated quality.",
        players: [player({ player_id: 13, canonical_name: "Sekou Diallo", best_role_score: 61.2 })],
      },
    ],
    ...over,
  } as SimilarResponse;
}

function mount(data: SimilarResponse = response()) {
  return render(
    <ScoutingStateProvider>
      <SimilarPlayers data={data} />
    </ScoutingStateProvider>,
  );
}

beforeEach(() => window.localStorage.clear());

// ---------------------------------------------------------------------------
// Nothing the API supplied was dropped
// ---------------------------------------------------------------------------
describe("Comparable-player groups", () => {
  it("renders every returned group with its heading, description and members in order", () => {
    mount();
    const groups = screen.getAllByTestId("similar-group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByText("Style comps")).toBeInTheDocument();
    expect(
      within(groups[0]).getByText("Closest statistical style within the same position group."),
    ).toBeInTheDocument();
    expect(within(groups[1]).getByText("Quality comps")).toBeInTheDocument();

    expect(
      within(groups[0])
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Anton Keller", "Jack Whitmore"]);
    expect(within(groups[1]).getByRole("link", { name: "Sekou Diallo" })).toBeInTheDocument();
  });

  it("keeps the player links, reason text and the existing five-result cap", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      player({ player_id: 100 + i, canonical_name: `Player ${i}` }),
    );
    mount(
      response({
        groups: [
          { key: "style", label: "Style comps", description: "d", players: many },
        ] as SimilarResponse["groups"],
      }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Player 0" })).toHaveAttribute("href", "/players/100");
    expect(screen.getAllByText("Similar statistical profile")).toHaveLength(5);
  });

  it("omits empty groups and reports honestly when there are none at all", () => {
    mount(response({ groups: [] as SimilarResponse["groups"] }));
    expect(screen.getByText("No comparable players found.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Structural single-line rows
// ---------------------------------------------------------------------------
describe("Comparable-player identity and market presentation", () => {
  it("keeps Club · League on one line, truncating rather than wrapping", () => {
    mount();
    const identity = screen.getAllByTestId("similar-identity")[0];
    expect(identity.textContent).toBe("Stuttgart · Bundesliga");
    // `truncate` is Tailwind's overflow-hidden + text-ellipsis + whitespace-nowrap
    expect(identity.className).toContain("truncate");
  });

  it("preserves the full identity value when it is long enough to truncate", () => {
    const long = player({
      club: "Borussia Mönchengladbach Fußball-Club 1900",
      league: "Campeonato Brasileiro Série A Primeira Divisão",
    });
    mount(
      response({
        groups: [
          { key: "style", label: "Style comps", description: "d", players: [long] },
        ] as SimilarResponse["groups"],
      }),
    );
    const identity = screen.getByTestId("similar-identity");
    const full = "Borussia Mönchengladbach Fußball-Club 1900 · Campeonato Brasileiro Série A Primeira Divisão";
    // the DOM text is complete (so assistive tech reads all of it) and the value
    // stays discoverable on the surface
    expect(identity.textContent).toBe(full);
    expect(identity).toHaveAttribute("title", full);
  });

  it("keeps the complete market range on one unbreakable line", () => {
    mount();
    const market = screen.getAllByTestId("similar-market")[0];
    expect(market).toHaveTextContent("Expected asking");
    const range = market.querySelector(".mono")!;
    expect(range.textContent).toBe("€58.5M – €87.8M");
    // the currency range can never break between its low and high values
    expect(range.className).toContain("whitespace-nowrap");
  });

  it("preserves partial and unknown market ranges instead of inventing €0", () => {
    mount(
      response({
        groups: [
          {
            key: "style",
            label: "Style comps",
            description: "d",
            players: [
              player({ player_id: 21, expected_asking_high_eur: null }),
              player({ player_id: 22, expected_asking_low_eur: null, expected_asking_high_eur: null }),
            ],
          },
        ] as SimilarResponse["groups"],
      }),
    );
    const [first, second] = screen.getAllByTestId("similar-market");
    expect(first).toHaveTextContent("From €58.5M");
    expect(second).toHaveTextContent("Unknown");
    expect(screen.queryByText(/€0/)).not.toBeInTheDocument();
  });

  it("stacks the two evidence channels as whole rows rather than letting them collide", () => {
    mount();
    const row = screen.getAllByTestId("similar-rolefit")[0].parentElement!;
    expect(row.className).toContain("flex-wrap");
    expect(row.className).toContain("justify-between");
    expect(within(row as HTMLElement).getByTestId("similar-market")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RoleFit as its own emphasised channel
// ---------------------------------------------------------------------------
describe("Comparable-player RoleFit emphasis", () => {
  it("uses the shared score readout, band colour and one-decimal formatting", () => {
    mount();
    const rolefit = screen.getAllByTestId("similar-rolefit")[0];
    expect(rolefit).toHaveTextContent("RoleFit");
    const figure = within(rolefit).getByTestId("score-readout").firstElementChild as HTMLElement;
    expect(figure.textContent).toBe("88.4");
    // the same band class Discovery would give an 88.4 (80-89 => pitch-mid)
    expect(figure.className).toContain("text-pitch-mid");
    // smaller than the Discovery ledger hero's text-3xl
    expect(figure.className).toContain("text-lg");
    expect(figure.className).not.toContain("text-3xl");
  });

  it("colours a different band from the same shared thresholds", () => {
    mount();
    const low = screen.getAllByTestId("similar-rolefit").at(-1)!;
    const figure = within(low).getByTestId("score-readout").firstElementChild as HTMLElement;
    expect(figure.textContent).toBe("61.2");
    expect(figure.className).toContain("text-accent-amber");
  });

  it("shows an unknown RoleFit as the shared hyphen sentinel, never as zero", () => {
    mount(
      response({
        groups: [
          {
            key: "style",
            label: "Style comps",
            description: "d",
            players: [player({ player_id: 31, best_role_score: null, best_role: null })],
          },
        ] as SimilarResponse["groups"],
      }),
    );
    const figure = within(screen.getByTestId("similar-rolefit")).getByTestId("score-readout")
      .firstElementChild as HTMLElement;
    expect(figure.textContent).toBe("-");
    expect(figure.className).toContain("text-ink-soft");
    expect(screen.queryByText("0.0")).not.toBeInTheDocument();
  });

  it("keeps RoleFit and the market range in separate labelled containers", () => {
    mount();
    const rolefit = screen.getAllByTestId("similar-rolefit")[0];
    const market = screen.getAllByTestId("similar-market")[0];
    expect(rolefit).not.toContainElement(market);
    expect(market).not.toContainElement(rolefit);
    expect(rolefit).not.toHaveTextContent("€");
    expect(market).not.toHaveTextContent("88.4");
  });
});

// ---------------------------------------------------------------------------
// The two-part action bar
// ---------------------------------------------------------------------------
describe("Comparable-player actions", () => {
  it("replaces the Shortlist wording with the shared heart treatment", () => {
    mount();
    expect(screen.queryByText("Shortlist")).not.toBeInTheDocument();
    expect(screen.queryByText("Shortlisted")).not.toBeInTheDocument();
    const heart = screen.getAllByTestId("favorite-heart")[0];
    expect(heart.tagName.toLowerCase()).toBe("svg");
    expect(heart).toHaveAttribute("data-filled", "false");
  });

  it("places both actions in one full-width, two-part, square-cornered bar", () => {
    mount();
    const bar = screen.getAllByTestId("card-action-bar")[0];
    expect(bar.className).toContain("rail-box");
    expect(bar.className).toContain("rail-box-inline");
    expect(bar.className).not.toContain("rail-box-discovery");
    expect(within(bar).getByTestId("favorite-action")).toBeInTheDocument();
    expect(within(bar).getByTestId("compare-action")).toBeInTheDocument();
    // equal weight: both are the same rail action treatment
    for (const action of [
      within(bar).getByTestId("favorite-action"),
      within(bar).getByTestId("compare-action"),
    ]) {
      expect(action.className).toContain("rail-action");
    }
  });

  it("shows exactly Compare, never Queued or a vs prefix", () => {
    mount();
    const compare = screen.getAllByTestId("compare-action")[0];
    expect(compare.textContent).toBe("Compare");
    fireEvent.click(compare);
    expect(compare.textContent).toBe("Compare");
    expect(compare).not.toHaveTextContent("Queued");
    expect(compare).not.toHaveTextContent("vs");
  });

  it("keeps device-local favourite state, with a filled heart and player-specific name", () => {
    mount();
    const favorite = screen.getAllByTestId("favorite-action")[0];
    expect(favorite).toHaveAccessibleName("Add Anton Keller to My Favorites");
    expect(favorite).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(favorite);
    expect(favorite).toHaveAttribute("aria-pressed", "true");
    expect(favorite).toHaveAccessibleName("Remove Anton Keller from My Favorites");
    expect(screen.getAllByTestId("favorite-heart")[0]).toHaveAttribute("data-filled", "true");
    expect(JSON.parse(window.localStorage.getItem("scoutboy.shortlist.v1") ?? "[]")).toContain(11);
  });

  it("keeps the compare queue state and a player-specific accessible name", () => {
    mount();
    const compare = screen.getAllByTestId("compare-action")[0];
    expect(compare).toHaveAccessibleName("Add Anton Keller to compare queue");
    expect(compare).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(compare);
    expect(compare).toHaveAttribute("aria-pressed", "true");
    expect(compare).toHaveAccessibleName("Remove Anton Keller from compare queue");
  });

  it("toggles one card's state without touching its neighbours", () => {
    mount();
    const favorites = screen.getAllByTestId("favorite-action");
    fireEvent.click(favorites[1]);
    expect(favorites[1]).toHaveAttribute("aria-pressed", "true");
    expect(favorites[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("adds no dimension-affecting class on selection", () => {
    mount();
    const compare = screen.getAllByTestId("compare-action")[0];
    const before = compare.className;
    fireEvent.click(compare);
    expect(compare.className).toBe(before);
  });
});
