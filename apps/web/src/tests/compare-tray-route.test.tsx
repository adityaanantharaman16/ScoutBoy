import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BottomRail } from "@/components/common/BottomRail";
import {
  COMPARE_ROUTE,
  CompareRailButton,
  CompareTray,
  FavoriteHeartButton,
} from "@/components/common/PlayerActions";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import { AccountHarness, makeSession } from "./support/account-harness";
import { setReducedMotion } from "./setup";

/**
 * The comparison tray exists to carry a scout TO the comparison. On the
 * comparison itself it has no errand left, so it stands down - by route, never by
 * touching the queue.
 */
let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const COMPARE_KEY = "scoutboy.compareQueue.v1";
const ANTON = { id: 6, name: "Anton Keller" };
const JACK = { id: 11, name: "Jack Whitmore" };

function queueOf(...players: { id: number; name: string }[]) {
  return JSON.stringify(players);
}

function Tray() {
  return (
    <ScoutingStateProvider>
      <CompareTray />
    </ScoutingStateProvider>
  );
}

beforeEach(() => {
  pathname = "/";
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Compare tray visibility by route", () => {
  it("behaves exactly as before away from the comparison route", () => {
    render(
      <ScoutingStateProvider>
        <CompareRailButton player={ANTON} />
        <CompareRailButton player={JACK} />
        <CompareTray />
      </ScoutingStateProvider>,
    );

    expect(screen.queryByTestId("compare-tray")).toBeNull();

    fireEvent.click(screen.getByLabelText(/Add Anton Keller to compare queue/i));
    expect(screen.getByTestId("compare-tray")).toBeInTheDocument();
    // One player: the invitation is present but not yet actionable.
    expect(screen.getByText("Add one more player")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open comparison/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.click(screen.getByLabelText(/Add Jack Whitmore to compare queue/i));
    const open = screen.getByRole("link", { name: /Open comparison/i });
    expect(open).toHaveAttribute("href", "/compare?a=6&b=11");
    expect(open).toHaveAttribute("aria-disabled", "false");
    // Wording and device-local semantics are untouched.
    expect(screen.getByTestId("compare-tray")).toHaveTextContent("Compare queue · device local");
  });

  it("keeps removal and clear working away from the comparison route", () => {
    setReducedMotion(true);
    window.localStorage.setItem(COMPARE_KEY, queueOf(ANTON, JACK));
    render(<Tray />);

    expect(screen.getAllByTestId("tray-remove")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText(/Remove Anton Keller from compare queue/i));
    expect(screen.getAllByTestId("tray-remove")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByTestId("compare-tray")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(COMPARE_KEY)!)).toEqual([]);
  });

  it("is absent on the comparison route, and leaves the queue untouched", () => {
    window.localStorage.setItem(COMPARE_KEY, queueOf(ANTON, JACK));
    pathname = COMPARE_ROUTE;
    render(<Tray />);

    // Gone from view...
    expect(screen.queryByTestId("compare-tray")).toBeNull();
    // ...but the selection itself is intact, so the comparison page still has it.
    expect(JSON.parse(window.localStorage.getItem(COMPARE_KEY)!)).toEqual([ANTON, JACK]);
  });

  it("renders nothing at all on a direct load of the comparison route", () => {
    window.localStorage.setItem(COMPARE_KEY, queueOf(ANTON, JACK));
    pathname = COMPARE_ROUTE;
    const { container } = render(<Tray />);
    // Never mounted, so there is no entrance to suppress and nothing to flash.
    expect(container.textContent).toBe("");
  });

  it("returns with its queue intact once the scout leaves the comparison", () => {
    setReducedMotion(true);
    window.localStorage.setItem(COMPARE_KEY, queueOf(ANTON, JACK));

    pathname = COMPARE_ROUTE;
    const { rerender } = render(<Tray />);
    expect(screen.queryByTestId("compare-tray")).toBeNull();

    pathname = "/";
    rerender(<Tray />);
    const tray = screen.getByTestId("compare-tray");
    expect(tray).toHaveTextContent("Anton Keller");
    expect(tray).toHaveTextContent("Jack Whitmore");
    expect(screen.getByRole("link", { name: /Open comparison/i })).toHaveAttribute(
      "href",
      "/compare?a=6&b=11",
    );
  });

  it("plays the established exit when the route becomes the comparison", () => {
    window.localStorage.setItem(COMPARE_KEY, queueOf(ANTON, JACK));
    const { rerender } = render(<Tray />);
    expect(screen.getByTestId("compare-tray")).toBeInTheDocument();

    pathname = COMPARE_ROUTE;
    rerender(<Tray />);
    // The same presence machinery an emptied queue uses: the tray leaves rather
    // than vanishing, carrying the one exit class the product already has.
    const tray = screen.getByTestId("compare-tray");
    expect(tray).toHaveAttribute("data-leaving", "true");
    expect(tray.className).toContain("tray-exit");
  });

  it("collapses that exit under reduced motion", () => {
    setReducedMotion(true);
    window.localStorage.setItem(COMPARE_KEY, queueOf(ANTON, JACK));
    const { rerender } = render(<Tray />);
    expect(screen.getByTestId("compare-tray")).toBeInTheDocument();

    pathname = COMPARE_ROUTE;
    rerender(<Tray />);
    // No hold, no exit class, no motion: gone in the same commit.
    expect(screen.queryByTestId("compare-tray")).toBeNull();
  });
});

describe("The bottom rail when the tray is suppressed", () => {
  it("lets the account suggestion hold the rail alone on the comparison route", () => {
    pathname = COMPARE_ROUTE;
    window.localStorage.setItem(COMPARE_KEY, queueOf(ANTON, JACK));
    render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <FavoriteHeartButton player={JACK} />
        <BottomRail />
      </AccountHarness>,
    );

    act(() => {
      fireEvent.click(screen.getByLabelText(/Add Jack Whitmore to My Favorites/i));
    });

    const rail = screen.getByTestId("bottom-rail");
    const suggestion = screen.getByTestId("account-suggestion");
    // Favouriting is not a Compare action, so the suggestion is still correct
    // here even though the tray is suppressed.
    expect(suggestion.parentElement).toBe(rail);
    expect(screen.queryByTestId("compare-tray")).toBeNull();
    expect(rail.children).toHaveLength(1);
    expect(rail.className).toContain("pointer-events-none");
    expect(suggestion.className).toContain("pointer-events-auto");
  });

  it("leaves an empty rail inert, childless and free of rounded geometry", () => {
    pathname = COMPARE_ROUTE;
    window.localStorage.setItem(COMPARE_KEY, queueOf(ANTON, JACK));
    const { container } = render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <BottomRail />
      </AccountHarness>,
    );
    const rail = screen.getByTestId("bottom-rail");
    // Queue populated, comparison route, no suggestion: nothing to obscure, and
    // nothing that could intercept a click meant for the page underneath.
    expect(rail.children).toHaveLength(0);
    expect(rail.className).toContain("pointer-events-none");
    const rounded = Array.from(container.querySelectorAll("*")).filter((el) =>
      /(?:^|\s)rounded(?:-[a-z0-9[\]().%/-]+)?(?=\s|$)/.test(el.getAttribute("class") ?? ""),
    );
    expect(rounded).toEqual([]);
  });

  it("stacks both surfaces, suggestion first, away from the comparison route", () => {
    window.localStorage.setItem(COMPARE_KEY, queueOf(ANTON, JACK));
    render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <FavoriteHeartButton player={JACK} />
        <BottomRail />
      </AccountHarness>,
    );
    act(() => {
      fireEvent.click(screen.getByLabelText(/Add Jack Whitmore to My Favorites/i));
    });

    const rail = screen.getByTestId("bottom-rail");
    const children = Array.from(rail.children);
    expect(children.map((el) => el.getAttribute("data-testid"))).toEqual([
      "account-suggestion",
      "compare-tray",
    ]);
  });
});
