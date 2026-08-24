/**
 * Milestone 8.4B: saved Discovery views, saved comparison setups, the Saved Work
 * hub, and the Compare URL contract.
 *
 * The synchronization sections mirror the 8.4A favourites suite deliberately:
 * every one is a property that must hold about a durable collection, and each was
 * a real failure mode before it was held.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -- Routing stub -----------------------------------------------------------
//
// The real History API drives every URL-backed surface here (Discovery's rail,
// Compare's three selectors, the Saved hub's sections), so the stub reads from
// `window.location` and re-renders on `pushState`/`replaceState`/`popstate`
// rather than returning a frozen snapshot. Back and forward are therefore real
// behaviours in these tests, not mocked ones.
let notifyRoute: () => void = () => {};
const routeListeners = new Set<() => void>();

function subscribeRoute(listener: () => void) {
  routeListeners.add(listener);
  return () => routeListeners.delete(listener);
}
function routeSnapshot() {
  return `${window.location.pathname}${window.location.search}`;
}
function useRoute() {
  return useSyncExternalStore(subscribeRoute, routeSnapshot, routeSnapshot);
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => {
    useRoute();
    return window.location.pathname;
  },
  useSearchParams: () => {
    useRoute();
    return new URLSearchParams(window.location.search);
  },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  ),
}));

const PLAYERS = [
  { id: 7, canonical_name: "Anton Keller" },
  { id: 5, canonical_name: "Luca Moretti" },
  { id: 9, canonical_name: "Jonas Adeyemi" },
];

const compareResult = { data: undefined, isLoading: false, isError: false, error: null };

/**
 * What `usePlayersByIds` resolves to. Mutable so one test can populate the
 * Favorites section, which every other test wants empty.
 */
let resolvedFavorites: Array<{ data?: unknown; isLoading: boolean; isError: boolean }> = [];

vi.mock("@/lib/api/hooks", () => ({
  useAllPlayersLite: () => ({ data: { items: PLAYERS } }),
  useCompare: () => compareResult,
  usePlayersByIds: () => resolvedFavorites,
  usePlayerSearch: () => ({ data: undefined, isLoading: true, isError: false, error: null }),
  usePlaystyleOptions: () => [{ key: "box_crasher", label: "Box Crasher" }],
}));

import ComparePage from "@/app/compare/page";
import SavedPage from "@/app/saved/page";
import { SaveComparisonControl } from "@/components/saved/SaveComparisonControl";
import { SaveViewControl } from "@/components/saved/SaveViewControl";
import { AuthSessionValueProvider, type AuthSession, type AuthStatus } from "@/lib/auth/session";
import { discoveryViewFromParams } from "@/lib/filters/canonical";
import {
  SavedWorkProvider,
  useSavedWork,
  type SavedWorkState,
} from "@/lib/state/saved-work";
import { ScoutingStateProvider } from "@/lib/state/scouting-state";
import {
  SAVED_COMPARISONS_STORAGE_ID,
  SAVED_VIEWS_STORAGE_ID,
  makeSavedComparison,
  makeSavedView,
  readSavedComparisons,
  readSavedViews,
  writeSavedComparisons,
  writeSavedViews,
} from "@/lib/storage/saved-work";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function navigate(url: string) {
  window.history.pushState(null, "", url);
  notifyRoute();
}

function makeSession(options: Partial<AuthSession> & { status?: AuthStatus } = {}): AuthSession {
  const status = options.status ?? "anonymous";
  return {
    status,
    enabled: options.enabled ?? status !== "disabled",
    accountKey: options.accountKey ?? (status === "authenticated" ? "acct_a" : null),
    getToken: options.getToken ?? (async () => "test-token"),
    openSignIn: options.openSignIn ?? (() => {}),
    openSignUp: options.openSignUp ?? (() => {}),
    signOut: options.signOut ?? (async () => {}),
  };
}

interface SessionController {
  get: () => AuthSession;
  set: (next: AuthSession) => void;
  subscribe: (listener: () => void) => () => void;
}

function createSessionController(initial: AuthSession): SessionController {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next) {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function Harness({
  controller,
  children,
}: {
  controller: SessionController;
  children: React.ReactNode;
}) {
  const session = useSyncExternalStore(controller.subscribe, controller.get, controller.get);
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <AuthSessionValueProvider value={session}>
        <ScoutingStateProvider>
          <SavedWorkProvider>{children}</SavedWorkProvider>
        </ScoutingStateProvider>
      </AuthSessionValueProvider>
    </QueryClientProvider>
  );
}

function renderGuest(children: React.ReactNode) {
  const controller = createSessionController(makeSession({ status: "disabled", enabled: false }));
  return { controller, ...render(<Harness controller={controller}>{children}</Harness>) };
}

interface FetchCall {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

function installFetch(
  handler: (call: FetchCall) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }>,
) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      const call: FetchCall = {
        url: String(input),
        method: init?.method ?? "GET",
        authorization: headers.get("Authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const result = await handler(call);
      const status = result.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        json: async () => result.json ?? {},
      } as Response;
    }),
  );
  return calls;
}

/** An empty canonical response for every private collection. */
const EMPTY_COLLECTIONS = { items: [], count: 0, added: [], already_present: [], rejected: [] };

const viewsOf = (calls: FetchCall[]) => calls.filter((c) => c.url.includes("/me/saved-views"));
const comparisonsOf = (calls: FetchCall[]) =>
  calls.filter((c) => c.url.includes("/me/saved-comparisons"));

beforeEach(() => {
  resolvedFavorites = [];
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  notifyRoute = () => {
    for (const listener of routeListeners) listener();
  };
  const push = window.history.pushState.bind(window.history);
  const replace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((...args) => {
    push(...(args as Parameters<typeof push>));
    notifyRoute();
  });
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => {
    replace(...(args as Parameters<typeof replace>));
    notifyRoute();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Saving a Discovery view
// ---------------------------------------------------------------------------

describe("Saving a Discovery view", () => {
  const view = () => discoveryViewFromParams(new URLSearchParams(window.location.search));

  function ViewSaver() {
    return <SaveViewControl view={view()} />;
  }

  it("saves the canonical filter state under a name", async () => {
    window.history.replaceState(null, "", "/?club=Ajax&age_max=22&page=4");
    renderGuest(<ViewSaver />);

    fireEvent.click(screen.getByTestId("save-view-trigger"));
    fireEvent.change(screen.getByTestId("save-view-panel-input"), {
      target: { value: "  Young Ajax  " },
    });
    fireEvent.click(screen.getByTestId("save-view-panel-submit"));

    await waitFor(() => expect(readSavedViews().items).toHaveLength(1));
    const [saved] = readSavedViews().items;
    expect(saved.label).toBe("Young Ajax"); // trimmed
    // The page number is NOT part of the view: reopening starts on page 1.
    expect(saved.view).toEqual({ club: "Ajax", age_max: 22 });
  });

  it("refuses to save a view that narrows nothing", () => {
    window.history.replaceState(null, "", "/");
    renderGuest(<ViewSaver />);
    expect(screen.getByTestId("save-view-trigger")).toBeDisabled();
  });

  it("renames the existing view rather than creating a duplicate cohort", async () => {
    window.history.replaceState(null, "", "/?club=Ajax");
    renderGuest(<ViewSaver />);

    fireEvent.click(screen.getByTestId("save-view-trigger"));
    fireEvent.change(screen.getByTestId("save-view-panel-input"), { target: { value: "First" } });
    fireEvent.click(screen.getByTestId("save-view-panel-submit"));
    await waitFor(() => expect(readSavedViews().items).toHaveLength(1));

    // The control now reports the cohort as already saved.
    await waitFor(() =>
      expect(screen.getByTestId("save-view-trigger")).toHaveAttribute("data-saved", "true"),
    );
    fireEvent.click(screen.getByTestId("save-view-trigger"));
    fireEvent.change(screen.getByTestId("save-view-panel-input"), { target: { value: "Second" } });
    fireEvent.click(screen.getByTestId("save-view-panel-submit"));

    await waitFor(() => expect(readSavedViews().items[0].label).toBe("Second"));
    expect(readSavedViews().items).toHaveLength(1);
  });

  it("says the view was NOT saved when the device write fails", async () => {
    window.history.replaceState(null, "", "/?club=Ajax");
    renderGuest(<ViewSaver />);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    fireEvent.click(screen.getByTestId("save-view-trigger"));
    fireEvent.change(screen.getByTestId("save-view-panel-input"), { target: { value: "Doomed" } });
    fireEvent.click(screen.getByTestId("save-view-panel-submit"));

    await waitFor(() => expect(screen.getByTestId("save-view-panel-error")).toBeInTheDocument());
    expect(screen.getByTestId("save-view-panel-error")).toHaveTextContent(/no room to save/i);
    // The panel stays open with the typed name intact, so a retry costs nothing.
    expect(screen.getByTestId("save-view-panel-input")).toHaveValue("Doomed");
    // And nothing claims success.
    expect(screen.getByTestId("save-view-notice")).toHaveTextContent("");
    setItem.mockRestore();
  });

  it("keeps the naming panel out of the filter rail entirely", () => {
    window.history.replaceState(null, "", "/?club=Ajax");
    const { container } = renderGuest(
      <div>
        <aside data-testid="filter-column">rail</aside>
        <ViewSaver />
      </div>,
    );
    const rail = container.querySelector('[data-testid="filter-column"]')!;
    expect(rail.querySelector('[data-testid="save-view-trigger"]')).toBeNull();
    expect(rail.querySelector('[data-testid="save-view-panel"]')).toBeNull();
  });
});

describe("The naming panel is keyboard-operable", () => {
  beforeEach(() => window.history.replaceState(null, "", "/?club=Ajax"));

  function ViewSaver() {
    return <SaveViewControl view={discoveryViewFromParams(new URLSearchParams(window.location.search))} />;
  }

  it("moves focus into the field on open and back to the trigger on Escape", async () => {
    renderGuest(<ViewSaver />);
    const trigger = screen.getByTestId("save-view-trigger");
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByTestId("save-view-panel-input")).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("save-view-panel")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("returns focus to the trigger after a successful save", async () => {
    renderGuest(<ViewSaver />);
    const trigger = screen.getByTestId("save-view-trigger");
    fireEvent.click(trigger);
    fireEvent.change(screen.getByTestId("save-view-panel-input"), { target: { value: "Kept" } });
    fireEvent.click(screen.getByTestId("save-view-panel-submit"));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes on Cancel without saving", async () => {
    renderGuest(<ViewSaver />);
    fireEvent.click(screen.getByTestId("save-view-trigger"));
    fireEvent.change(screen.getByTestId("save-view-panel-input"), { target: { value: "Nope" } });
    fireEvent.click(screen.getByTestId("save-view-panel-cancel"));
    await waitFor(() => expect(screen.queryByTestId("save-view-panel")).not.toBeInTheDocument());
    expect(readSavedViews().items).toHaveLength(0);
  });

  it("refuses an empty or over-long name at the control, before any write", () => {
    renderGuest(<ViewSaver />);
    fireEvent.click(screen.getByTestId("save-view-trigger"));
    const submit = screen.getByTestId("save-view-panel-submit");
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId("save-view-panel-input"), { target: { value: "   " } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId("save-view-panel-input"), { target: { value: "Fine" } });
    expect(submit).toBeEnabled();
  });

  it("announces the outcome politely rather than interrupting", async () => {
    renderGuest(<ViewSaver />);
    fireEvent.click(screen.getByTestId("save-view-trigger"));
    fireEvent.change(screen.getByTestId("save-view-panel-input"), { target: { value: "Kept" } });
    fireEvent.click(screen.getByTestId("save-view-panel-submit"));

    const notice = screen.getByTestId("save-view-notice");
    await waitFor(() => expect(notice).toHaveTextContent("Saved this Discovery view as Kept."));
    expect(notice).toHaveAttribute("role", "status");
  });
});

// ---------------------------------------------------------------------------
// Labels are inert
// ---------------------------------------------------------------------------

describe("A script-shaped label is inert text", () => {
  it.each(["<img src=x onerror=alert(1)>", "<script>alert(1)</script>"])(
    "renders %s as characters, never as markup",
    async (label) => {
      writeSavedViews([makeSavedView(label, { club: "Ajax" })]);
      window.history.replaceState(null, "", "/saved?section=views");
      const { container } = renderGuest(<SavedPage />);

      const rendered = await screen.findByTestId("saved-view-label");
      // The label is TEXT: the element has exactly one text child, equal to the
      // stored string, and produced no markup of its own.
      expect(rendered.textContent).toBe(label);
      expect(rendered.children).toHaveLength(0);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("script")).toBeNull();
      for (const element of Array.from(container.querySelectorAll("*"))) {
        expect(element.getAttribute("onerror")).toBeNull();
        expect(element.getAttribute("onload")).toBeNull();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Compare URL contract
// ---------------------------------------------------------------------------

describe("The Compare URL contract", () => {
  it("hydrates all three selectors from a hard-loaded URL", async () => {
    window.history.replaceState(null, "", "/compare?a=7&b=5&role=advanced_8");
    renderGuest(<ComparePage />);

    await waitFor(() => expect(screen.getByTestId("compare-a")).toHaveValue("7"));
    expect(screen.getByTestId("compare-b")).toHaveValue("5");
    expect(screen.getByTestId("compare-role-select")).toHaveValue("advanced_8");
  });

  it("writes every selector change into the URL", async () => {
    window.history.replaceState(null, "", "/compare");
    renderGuest(<ComparePage />);

    fireEvent.change(await screen.findByTestId("compare-a"), { target: { value: "7" } });
    expect(window.location.search).toBe("?a=7");

    fireEvent.change(screen.getByTestId("compare-b"), { target: { value: "5" } });
    expect(window.location.search).toBe("?a=7&b=5");

    fireEvent.change(screen.getByTestId("compare-role-select"), {
      target: { value: "advanced_8" },
    });
    expect(window.location.search).toBe("?a=7&b=5&role=advanced_8");
  });

  it("omits role entirely for Automatic Role rather than writing a sentinel", async () => {
    window.history.replaceState(null, "", "/compare?a=7&b=5&role=advanced_8");
    renderGuest(<ComparePage />);

    fireEvent.change(await screen.findByTestId("compare-role-select"), { target: { value: "" } });
    expect(window.location.search).toBe("?a=7&b=5");
  });

  it("restores all three selectors on back and forward", async () => {
    window.history.replaceState(null, "", "/compare?a=7&b=5");
    renderGuest(<ComparePage />);
    await waitFor(() => expect(screen.getByTestId("compare-a")).toHaveValue("7"));

    fireEvent.change(screen.getByTestId("compare-role-select"), {
      target: { value: "advanced_8" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("compare-role-select")).toHaveValue("advanced_8"),
    );

    window.history.back();
    await waitFor(() => {
      notifyRoute();
      expect(screen.getByTestId("compare-role-select")).toHaveValue("");
    });

    window.history.forward();
    await waitFor(() => {
      notifyRoute();
      expect(screen.getByTestId("compare-role-select")).toHaveValue("advanced_8");
    });
  });

  it("reports a malformed id honestly instead of silently correcting it", async () => {
    window.history.replaceState(null, "", "/compare?a=abc&b=5&role=not_a_role");
    renderGuest(<ComparePage />);

    const notice = await screen.findByTestId("compare-url-notice");
    expect(notice).toHaveTextContent(/Player 1/);
    expect(notice).toHaveTextContent(/selected role/);
    // The unusable selectors are simply left unset; nothing is guessed.
    expect(screen.getByTestId("compare-a")).toHaveValue("");
    expect(screen.getByTestId("compare-b")).toHaveValue("5");
    expect(screen.getByTestId("compare-role-select")).toHaveValue("");
  });

  it.each([["a=0"], ["a=-4"], ["a=1.5"], ["a="]])(
    "never forwards %s to the compare request",
    async (query) => {
      window.history.replaceState(null, "", `/compare?${query}&b=5`);
      renderGuest(<ComparePage />);
      await waitFor(() => expect(screen.getByTestId("compare-a")).toHaveValue(""));
    },
  );
});

describe("Saving a comparison setup", () => {
  it("saves two players and an explicit role", async () => {
    window.history.replaceState(null, "", "/compare?a=7&b=5&role=advanced_8");
    renderGuest(<ComparePage />);

    fireEvent.click(await screen.findByTestId("save-comparison-trigger"));
    fireEvent.change(screen.getByTestId("save-comparison-panel-input"), {
      target: { value: "Midfield duel" },
    });
    fireEvent.click(screen.getByTestId("save-comparison-panel-submit"));

    await waitFor(() => expect(readSavedComparisons().items).toHaveLength(1));
    const [saved] = readSavedComparisons().items;
    expect(saved.playerA).toEqual({ playerId: 7, name: "Anton Keller" });
    expect(saved.playerB).toEqual({ playerId: 5, name: "Luca Moretti" });
    expect(saved.roleKey).toBe("advanced_8");
  });

  it("saves Automatic Role as null", async () => {
    window.history.replaceState(null, "", "/compare?a=7&b=5");
    renderGuest(<ComparePage />);

    fireEvent.click(await screen.findByTestId("save-comparison-trigger"));
    fireEvent.click(screen.getByTestId("save-comparison-panel-submit"));
    await waitFor(() => expect(readSavedComparisons().items[0].roleKey).toBeNull());
  });

  it("stores no score, conclusion or confidence", async () => {
    window.history.replaceState(null, "", "/compare?a=7&b=5");
    renderGuest(<ComparePage />);
    fireEvent.click(await screen.findByTestId("save-comparison-trigger"));
    fireEvent.click(screen.getByTestId("save-comparison-panel-submit"));

    await waitFor(() => expect(readSavedComparisons().items).toHaveLength(1));
    const stored = window.localStorage.getItem(SAVED_COMPARISONS_STORAGE_ID)!.toLowerCase();
    for (const forbidden of ["score", "conclusion", "confidence", "evidence"]) {
      expect(stored).not.toContain(forbidden);
    }
  });

  it("cannot be saved until two different players are chosen", async () => {
    window.history.replaceState(null, "", "/compare?a=7");
    renderGuest(<ComparePage />);
    expect(await screen.findByTestId("save-comparison-trigger")).toBeDisabled();
  });

  it("treats the reversed pair as a DIFFERENT saved setup", async () => {
    renderGuest(
      <SaveComparisonControl
        playerA={{ id: 7, name: "Anton Keller" }}
        playerB={{ id: 5, name: "Luca Moretti" }}
        roleKey={null}
      />,
    );
    fireEvent.click(screen.getByTestId("save-comparison-trigger"));
    fireEvent.click(screen.getByTestId("save-comparison-panel-submit"));
    await waitFor(() => expect(readSavedComparisons().items).toHaveLength(1));

    // A separate control for the reversed order.
    renderGuest(
      <SaveComparisonControl
        playerA={{ id: 5, name: "Luca Moretti" }}
        playerB={{ id: 7, name: "Anton Keller" }}
        roleKey={null}
      />,
    );
    const triggers = screen.getAllByTestId("save-comparison-trigger");
    fireEvent.click(triggers[triggers.length - 1]);
    const submits = screen.getAllByTestId("save-comparison-panel-submit");
    fireEvent.click(submits[submits.length - 1]);

    await waitFor(() => expect(readSavedComparisons().items).toHaveLength(2));
  });
});

// ---------------------------------------------------------------------------
// The Saved Work hub
// ---------------------------------------------------------------------------

describe("The Saved Work hub", () => {
  it("defaults to Favorites", async () => {
    window.history.replaceState(null, "", "/saved");
    renderGuest(<SavedPage />);
    await waitFor(() =>
      expect(screen.getByTestId("saved-section-favorites")).toHaveAttribute("data-active", "true"),
    );
  });

  it("shows exactly one section at a time", async () => {
    writeSavedViews([makeSavedView("A view", { club: "Ajax" })]);
    window.history.replaceState(null, "", "/saved?section=views");
    renderGuest(<SavedPage />);

    await waitFor(() => expect(screen.getByTestId("saved-views-ledger")).toBeInTheDocument());
    expect(screen.queryByTestId("saved-comparisons-ledger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("shortlist-ledger")).not.toBeInTheDocument();
  });

  it("puts the section in the URL and restores it on back/forward", async () => {
    window.history.replaceState(null, "", "/saved");
    renderGuest(<SavedPage />);

    fireEvent.click(await screen.findByTestId("saved-section-views"));
    expect(window.location.search).toBe("?section=views");

    fireEvent.click(screen.getByTestId("saved-section-comparisons"));
    expect(window.location.search).toBe("?section=comparisons");

    window.history.back();
    await waitFor(() => {
      notifyRoute();
      expect(screen.getByTestId("saved-section-views")).toHaveAttribute("data-active", "true");
    });

    window.history.forward();
    await waitFor(() => {
      notifyRoute();
      expect(screen.getByTestId("saved-section-comparisons")).toHaveAttribute(
        "data-active",
        "true",
      );
    });
  });

  it("falls back to Favorites for an unrecognised section", async () => {
    window.history.replaceState(null, "", "/saved?section=../../etc/passwd");
    renderGuest(<SavedPage />);
    await waitFor(() =>
      expect(screen.getByTestId("saved-section-favorites")).toHaveAttribute("data-active", "true"),
    );
  });

  it("writes the bare /saved for the default section, not a redundant parameter", async () => {
    window.history.replaceState(null, "", "/saved?section=views");
    renderGuest(<SavedPage />);
    fireEvent.click(await screen.findByTestId("saved-section-favorites"));
    expect(window.location.search).toBe("");
  });

  it("renders the real My Favorites ledger in its section, not a second copy", async () => {
    // The Saved hub and the legacy /shortlist route render the SAME
    // `FavoritesPanel`, so a saved player has to appear here with the row test id
    // every existing favourites assertion already uses.
    window.localStorage.setItem("scoutboy.shortlist.v1", JSON.stringify([7]));
    resolvedFavorites = [
      {
        isLoading: false,
        isError: false,
        data: {
          identity: {
            id: 7,
            canonical_name: "Anton Keller",
            age: 21,
            primary_position: "CF",
            club: "Stuttgart",
            league: "Bundesliga",
          },
          season: "2023/24",
          has_rolefit_analysis: false,
          role_ratings: [],
          playstyles: [],
          confidence: "low",
          evidence_status: "partial",
          context: { minutes: 900 },
          market: null,
        },
      },
    ];
    window.history.replaceState(null, "", "/saved");
    renderGuest(<SavedPage />);

    await waitFor(() => expect(screen.getByTestId("shortlist-record")).toBeInTheDocument());
    expect(screen.getByTestId("shortlist-player")).toHaveTextContent("Anton Keller");
    // …and only the Favorites section is rendered.
    expect(screen.queryByTestId("saved-views-ledger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("saved-comparisons-ledger")).not.toBeInTheDocument();
  });

  it("explains how to create a first item in each empty section", async () => {
    window.history.replaceState(null, "", "/saved?section=views");
    const { unmount } = renderGuest(<SavedPage />);
    expect(await screen.findByText(/Save View beside the page heading/)).toBeInTheDocument();
    unmount();

    window.history.replaceState(null, "", "/saved?section=comparisons");
    renderGuest(<SavedPage />);
    expect(await screen.findByText(/Save Comparison beside the selectors/)).toBeInTheDocument();
  });

  it("names each section's count only when it is actually known", async () => {
    writeSavedViews([makeSavedView("A view", { club: "Ajax" })]);
    window.history.replaceState(null, "", "/saved");
    renderGuest(<SavedPage />);

    await waitFor(() =>
      expect(within(screen.getByTestId("saved-section-views")).getByTestId("section-count"))
        .toHaveTextContent("1"),
    );
  });

  it("withholds every count while the session is still resolving", async () => {
    const controller = createSessionController(makeSession({ status: "resolving" }));
    window.history.replaceState(null, "", "/saved");
    installFetch(() => ({ json: EMPTY_COLLECTIONS }));
    render(
      <Harness controller={controller}>
        <SavedPage />
      </Harness>,
    );

    await waitFor(() => expect(screen.getByTestId("saved-sections")).toBeInTheDocument());
    // A returning account holder must never read "Views 0" before their real
    // collection arrives.
    expect(screen.queryAllByTestId("section-count")).toHaveLength(0);
  });
});

describe("Managing a saved view", () => {
  beforeEach(() => {
    writeSavedViews([makeSavedView("Original", { club: "Ajax", age_max: 22 })]);
    window.history.replaceState(null, "", "/saved?section=views");
  });

  it("opens the exact canonical URL, on page 1", async () => {
    renderGuest(<SavedPage />);
    const open = await screen.findByTestId("saved-view-open");
    expect(open).toHaveAttribute("href", "/?club=Ajax&age_max=22");
    expect(open).toHaveAccessibleName("Open the saved Discovery view Original");
  });

  it("renames through the panel, with the current name pre-filled", async () => {
    renderGuest(<SavedPage />);
    fireEvent.click(await screen.findByTestId("saved-view-rename"));

    const input = screen.getByTestId("saved-view-rename-panel-input");
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("Original");

    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("saved-view-rename-panel-submit"));
    await waitFor(() => expect(readSavedViews().items[0].label).toBe("Renamed"));
  });

  it("removes only after a deliberate confirmation, and never via window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderGuest(<SavedPage />);

    fireEvent.click(await screen.findByTestId("saved-view-remove"));
    // Still saved: arming is not removing.
    expect(readSavedViews().items).toHaveLength(1);

    const confirm = screen.getByTestId("saved-view-remove-confirm");
    expect(confirm).toHaveAccessibleName(/Confirm removing the saved Discovery view Original/);
    fireEvent.click(confirm);

    await waitFor(() => expect(readSavedViews().items).toHaveLength(0));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("lets a half-pressed removal be cancelled", async () => {
    renderGuest(<SavedPage />);
    fireEvent.click(await screen.findByTestId("saved-view-remove"));
    fireEvent.click(screen.getByTestId("saved-view-remove-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("saved-view-remove-confirm")).not.toBeInTheDocument(),
    );
    expect(readSavedViews().items).toHaveLength(1);
  });

  it("gives every action a visible label and an accessible name", async () => {
    renderGuest(<SavedPage />);
    for (const id of ["saved-view-open", "saved-view-rename", "saved-view-remove"]) {
      const control = await screen.findByTestId(id);
      expect(control.textContent?.trim()).toBeTruthy();
      expect(control).toHaveAccessibleName();
    }
  });
});

describe("A saved view whose filters went stale", () => {
  it("reopens everything still valid and names only what was lost", async () => {
    // Written straight to storage as an older build would have left it.
    window.localStorage.setItem(
      SAVED_VIEWS_STORAGE_ID,
      JSON.stringify({
        version: 1,
        items: [
          {
            clientId: "0f8fad5b-d9cb-469f-a165-70867728950e",
            label: "Partly stale",
            view: { club: "Ajax", age_max: 22, role: "a_retired_role" },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );
    window.history.replaceState(null, "", "/saved?section=views");
    renderGuest(<SavedPage />);

    const notice = await screen.findByTestId("saved-view-unavailable");
    expect(notice).toHaveTextContent(/no longer available \(Role\)/);
    // Everything else still opens, and the invalid criterion is not forwarded.
    expect(screen.getByTestId("saved-view-open")).toHaveAttribute(
      "href",
      "/?club=Ajax&age_max=22",
    );
    // It stays editable and removable.
    expect(screen.getByTestId("saved-view-rename")).toBeEnabled();
    expect(screen.getByTestId("saved-view-remove")).toBeEnabled();
  });
});

describe("A saved comparison whose participants went stale", () => {
  function renderAccountComparisons(item: Record<string, unknown>) {
    const controller = createSessionController(makeSession({ status: "authenticated" }));
    installFetch((call) =>
      call.url.includes("/me/saved-comparisons")
        ? { json: { items: [item], count: 1, added: [], already_present: [], rejected: [] } }
        : { json: EMPTY_COLLECTIONS },
    );
    window.history.replaceState(null, "", "/saved?section=comparisons");
    return render(
      <Harness controller={controller}>
        <SavedPage />
      </Harness>,
    );
  }

  const base = {
    client_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    label: "Old duel",
    fingerprint: "abc",
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
  };

  it("stays visible, names the missing side, and cannot be opened", async () => {
    renderAccountComparisons({
      ...base,
      player_a: { player_id: 7, label: "Anton Keller", available: true },
      player_b: { player_id: null, label: "Departed Player", available: false },
      role_key: null,
    });

    const notice = await screen.findByTestId("saved-comparison-unavailable");
    expect(notice).toHaveTextContent(/Departed Player \(Player 2\) is no longer available/);
    // The saved name is shown; no player is fabricated in its place.
    expect(screen.getByTestId("saved-comparison-players")).toHaveTextContent(
      "Anton Keller vs Departed Player (no longer available)",
    );
    // Open is disabled rather than hidden, and says why.
    const disabled = screen.getByTestId("saved-comparison-open-disabled");
    expect(disabled).toBeDisabled();
    expect(disabled).toHaveAccessibleName(/no longer available/);
    // Rename and remove stay available.
    expect(screen.getByTestId("saved-comparison-rename")).toBeEnabled();
    expect(screen.getByTestId("saved-comparison-remove")).toBeEnabled();
  });

  it("falls back to Automatic Role when only the ROLE went away, and explains it", async () => {
    renderAccountComparisons({
      ...base,
      player_a: { player_id: 7, label: "Anton Keller", available: true },
      player_b: { player_id: 5, label: "Luca Moretti", available: true },
      role_key: "a_retired_role",
    });

    expect(await screen.findByTestId("saved-comparison-role-fallback")).toHaveTextContent(
      /Opening it uses Automatic Role instead/,
    );
    const open = screen.getByTestId("saved-comparison-open");
    expect(open).toHaveAttribute("href", "/compare?a=7&b=5");
    expect(open).toHaveAccessibleName(/with Automatic Role/);
  });
});

// ---------------------------------------------------------------------------
// Optional accounts
// ---------------------------------------------------------------------------

describe("Saved work and optional accounts", () => {
  it("issues no private request at all in an auth-free build", async () => {
    const calls = installFetch(() => ({ json: EMPTY_COLLECTIONS }));
    writeSavedViews([makeSavedView("Device only", { club: "Ajax" })]);
    window.history.replaceState(null, "", "/saved?section=views");
    renderGuest(<SavedPage />);

    await waitFor(() => expect(screen.getByTestId("saved-views-ledger")).toBeInTheDocument());
    expect(calls).toHaveLength(0);
  });

  it("merges each device collection on sign-in and clears it only after success", async () => {
    writeSavedViews([makeSavedView("Device view", { club: "Ajax" })]);
    writeSavedComparisons([
      makeSavedComparison("Device duel", { playerId: 7, name: "A" }, { playerId: 5, name: "B" }, null),
    ]);

    const calls = installFetch((call) => ({
      json: call.url.includes("saved-views")
        ? {
            items: [
              {
                client_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
                label: "Device view",
                filters: { club: "Ajax" },
                fingerprint: "f",
                created_at: "2026-01-01T00:00:00+00:00",
                updated_at: "2026-01-01T00:00:00+00:00",
              },
            ],
            count: 1,
            added: [],
            already_present: [],
            rejected: [],
          }
        : EMPTY_COLLECTIONS,
    }));

    const controller = createSessionController(makeSession({ status: "authenticated" }));
    window.history.replaceState(null, "", "/saved?section=views");
    render(
      <Harness controller={controller}>
        <SavedPage />
      </Harness>,
    );

    await waitFor(() => {
      expect(viewsOf(calls).some((c) => c.url.endsWith("/merge"))).toBe(true);
      expect(comparisonsOf(calls).some((c) => c.url.endsWith("/merge"))).toBe(true);
    });
    // Each collection sends only its OWN device items.
    const viewMerge = viewsOf(calls).find((c) => c.url.endsWith("/merge"))!;
    expect((viewMerge.body as { items: unknown[] }).items).toHaveLength(1);

    // The device copies are retired only after the server confirms.
    await waitFor(() => expect(readSavedViews().items).toHaveLength(0));
    await waitFor(() => expect(readSavedComparisons().items).toHaveLength(0));
  });

  it("RETAINS the device collection, visibly, when its merge fails", async () => {
    writeSavedViews([makeSavedView("Still here", { club: "Ajax" })]);
    installFetch((call) =>
      call.url.includes("saved-views") ? { status: 500 } : { json: EMPTY_COLLECTIONS },
    );

    const controller = createSessionController(makeSession({ status: "authenticated" }));
    window.history.replaceState(null, "", "/saved?section=views");
    render(
      <Harness controller={controller}>
        <SavedPage />
      </Harness>,
    );

    // Visible, named, and still on the device.
    expect(await screen.findByTestId("saved-view-label")).toHaveTextContent("Still here");
    expect(readSavedViews().items).toHaveLength(1);
    expect(screen.getByTestId("saved-views-error")).toHaveTextContent(/still on this device/i);
    expect(screen.getByTestId("saved-views-retry")).toBeEnabled();
  });

  it("keeps only the UNCONFIRMED collection when the other one merged", async () => {
    writeSavedViews([makeSavedView("Views fail", { club: "Ajax" })]);
    writeSavedComparisons([
      makeSavedComparison("Comparisons succeed", { playerId: 7, name: "A" }, { playerId: 5, name: "B" }, null),
    ]);
    installFetch((call) =>
      call.url.includes("saved-views") ? { status: 500 } : { json: EMPTY_COLLECTIONS },
    );

    const controller = createSessionController(makeSession({ status: "authenticated" }));
    window.history.replaceState(null, "", "/saved?section=views");
    render(
      <Harness controller={controller}>
        <SavedPage />
      </Harness>,
    );

    await waitFor(() => expect(screen.getByTestId("saved-views-error")).toBeInTheDocument());
    // The failed collection is retained; the confirmed one is retired.
    expect(readSavedViews().items).toHaveLength(1);
    await waitFor(() => expect(readSavedComparisons().items).toHaveLength(0));
  });

  it("keeps edits during a failed merge DEVICE-LOCAL, and retries with the latest", async () => {
    writeSavedViews([makeSavedView("First", { club: "Ajax" })]);
    let failMerge = true;
    const calls = installFetch((call) => {
      if (!call.url.includes("saved-views")) return { json: EMPTY_COLLECTIONS };
      if (call.url.endsWith("/merge") && failMerge) return { status: 500 };
      return { json: EMPTY_COLLECTIONS };
    });

    const controller = createSessionController(makeSession({ status: "authenticated" }));
    window.history.replaceState(null, "", "/saved?section=views");
    render(
      <Harness controller={controller}>
        <SavedPage />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId("saved-views-error")).toBeInTheDocument());

    // Rename while unconfirmed: device-local, and no individual account request.
    const before = viewsOf(calls).length;
    fireEvent.click(screen.getByTestId("saved-view-rename"));
    fireEvent.change(screen.getByTestId("saved-view-rename-panel-input"), {
      target: { value: "Edited on device" },
    });
    fireEvent.click(screen.getByTestId("saved-view-rename-panel-submit"));

    await waitFor(() => expect(readSavedViews().items[0].label).toBe("Edited on device"));
    expect(viewsOf(calls)).toHaveLength(before);

    // Retry sends the EDITED collection, not the snapshot the session began with.
    failMerge = false;
    fireEvent.click(screen.getByTestId("saved-views-retry"));
    await waitFor(() => {
      const merges = viewsOf(calls).filter((c) => c.url.endsWith("/merge"));
      expect(merges).toHaveLength(2);
      const items = (merges[1].body as { items: { label: string }[] }).items;
      expect(items[0].label).toBe("Edited on device");
    });
  });

  it("never renders one account's saved work under another", async () => {
    const controller = createSessionController(
      makeSession({
        status: "authenticated",
        accountKey: "acct_a",
        getToken: async () => "token-a",
      }),
    );
    installFetch((call) => ({
      json: call.authorization === "Bearer token-a" && call.url.includes("saved-views")
        ? {
            items: [
              {
                client_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
                label: "Alice cohort",
                filters: { club: "Ajax" },
                fingerprint: "f",
                created_at: "2026-01-01T00:00:00+00:00",
                updated_at: "2026-01-01T00:00:00+00:00",
              },
            ],
            count: 1,
            added: [],
            already_present: [],
            rejected: [],
          }
        : EMPTY_COLLECTIONS,
    }));
    window.history.replaceState(null, "", "/saved?section=views");
    render(
      <Harness controller={controller}>
        <SavedPage />
      </Harness>,
    );
    expect(await screen.findByTestId("saved-view-label")).toHaveTextContent("Alice cohort");

    // Switch to a different account.
    controller.set(
      makeSession({
        status: "authenticated",
        accountKey: "acct_b",
        getToken: async () => "token-b",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("saved-view-label")).not.toBeInTheDocument(),
    );
  });

  it("ignores a delayed response that outlived its account", async () => {
    let releaseA: (value: { json: unknown }) => void = () => {};
    const controller = createSessionController(
      makeSession({
        status: "authenticated",
        accountKey: "acct_a",
        getToken: async () => "token-a",
      }),
    );
    installFetch((call) => {
      if (!call.url.includes("saved-views")) return Promise.resolve({ json: EMPTY_COLLECTIONS });
      if (call.authorization === "Bearer token-a") {
        return new Promise<{ json: unknown }>((resolve) => {
          releaseA = resolve;
        });
      }
      return Promise.resolve({ json: EMPTY_COLLECTIONS });
    });

    window.history.replaceState(null, "", "/saved?section=views");
    render(
      <Harness controller={controller}>
        <SavedPage />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId("saved-sections")).toBeInTheDocument());

    // Account B arrives while A's request is still in flight.
    controller.set(
      makeSession({
        status: "authenticated",
        accountKey: "acct_b",
        getToken: async () => "token-b",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("saved-section-views")).toBeInTheDocument());

    // A's response lands late, carrying A's data. It must not be shown to B.
    releaseA({
      json: {
        items: [
          {
            client_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
            label: "Account A cohort",
            filters: { club: "Ajax" },
            fingerprint: "f",
            created_at: "2026-01-01T00:00:00+00:00",
            updated_at: "2026-01-01T00:00:00+00:00",
          },
        ],
        count: 1,
        added: [],
        already_present: [],
        rejected: [],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Account A cohort")).not.toBeInTheDocument();
  });

  it("never carries one account's token into another account's request", async () => {
    const calls = installFetch(() => ({ json: EMPTY_COLLECTIONS }));
    const controller = createSessionController(
      makeSession({
        status: "authenticated",
        accountKey: "acct_a",
        getToken: async () => "token-a",
      }),
    );
    window.history.replaceState(null, "", "/saved?section=views");
    render(
      <Harness controller={controller}>
        <SavedPage />
      </Harness>,
    );
    await waitFor(() => expect(viewsOf(calls).length).toBeGreaterThan(0));

    const boundary = calls.length;
    controller.set(
      makeSession({
        status: "authenticated",
        accountKey: "acct_b",
        getToken: async () => "token-b",
      }),
    );
    await waitFor(() => expect(calls.length).toBeGreaterThan(boundary));
    for (const call of calls.slice(boundary)) {
      expect(call.authorization).toBe("Bearer token-b");
    }
  });

  it("puts no account data into guest storage, and signing out exposes only the device", async () => {
    installFetch((call) => ({
      json: call.url.includes("saved-views")
        ? {
            items: [
              {
                client_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
                label: "Account only",
                filters: { club: "Ajax" },
                fingerprint: "f",
                created_at: "2026-01-01T00:00:00+00:00",
                updated_at: "2026-01-01T00:00:00+00:00",
              },
            ],
            count: 1,
            added: [],
            already_present: [],
            rejected: [],
          }
        : EMPTY_COLLECTIONS,
    }));

    const controller = createSessionController(makeSession({ status: "authenticated" }));
    window.history.replaceState(null, "", "/saved?section=views");
    render(
      <Harness controller={controller}>
        <SavedPage />
      </Harness>,
    );
    expect(await screen.findByTestId("saved-view-label")).toHaveTextContent("Account only");

    // Nothing about the account list reached browser storage.
    expect(window.localStorage.getItem(SAVED_VIEWS_STORAGE_ID)).toBeNull();

    controller.set(makeSession({ status: "anonymous", accountKey: null }));
    await waitFor(() =>
      expect(screen.queryByText("Account only")).not.toBeInTheDocument(),
    );
    expect(window.localStorage.getItem(SAVED_VIEWS_STORAGE_ID)).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// Truthful signed-in writes
//
// Every test here fails against the premature-success behaviour this corrects:
// `save()` and `rename()` used to resolve `ok: true` the moment a request was
// QUEUED, so a naming panel closed, restored focus and announced "Saved" while
// the server had confirmed nothing - and a later failure then contradicted an
// announcement the scout had already read.
// ---------------------------------------------------------------------------

/** A promise a test resolves or rejects when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** One canonical saved view, as the API reports it. */
function viewWire(clientId: string, label: string, club: string) {
  return {
    client_id: clientId,
    label,
    filters: { club },
    fingerprint: `fp-${club}`,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
  };
}

function viewsPayload(items: ReturnType<typeof viewWire>[]) {
  return { items, count: items.length, added: [], already_present: [], rejected: [] };
}

const ID_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ID_B = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function authenticatedController(accountKey = "acct_a", token = "token-a") {
  return createSessionController(
    makeSession({ status: "authenticated", accountKey, getToken: async () => token }),
  );
}

/**
 * A probe that exposes the live saved-work API to a test.
 *
 * The PROMISE CONTRACT is what these tests are about, and a component's `submit`
 * handler hides it. This reaches it directly while still exercising the whole
 * real state machine - nothing about the provider is stubbed.
 */
interface Probe {
  views: { current: SavedWorkState["views"] };
  comparisons: { current: SavedWorkState["comparisons"] };
}

function SavedWorkProbe({
  viewsRef,
  comparisonsRef,
}: {
  viewsRef: Probe["views"];
  comparisonsRef: Probe["comparisons"];
}) {
  const state = useSavedWork();
  // Published after COMMIT, not during render: the tests only read these after an
  // `await`, by which point effects have flushed, and writing a ref during render
  // is exactly what the repository's hook rules forbid.
  useEffect(() => {
    viewsRef.current = state.views;
    comparisonsRef.current = state.comparisons;
  });
  return null;
}

function renderWithProbe(controller: SessionController, children?: React.ReactNode) {
  const probe: Probe = {
    views: { current: null as unknown as SavedWorkState["views"] },
    comparisons: { current: null as unknown as SavedWorkState["comparisons"] },
  };
  render(
    <Harness controller={controller}>
      <SavedWorkProbe viewsRef={probe.views} comparisonsRef={probe.comparisons} />
      {children}
    </Harness>,
  );
  return probe;
}

describe("A signed-in save reports only what the server confirmed", () => {
  /**
   * Discovery's Save View control against an account whose collection loads from
   * `initial` and whose CREATE is held open by the returned deferred.
   */
  function renderPendingCreate(initial: ReturnType<typeof viewWire>[] = []) {
    const create = deferred<{ status?: number; json?: unknown }>();
    const controller = authenticatedController();
    installFetch((call) => {
      if (!call.url.includes("/me/saved-views")) return { json: EMPTY_COLLECTIONS };
      if (call.method === "POST" && !call.url.endsWith("/merge")) return create.promise;
      return { json: viewsPayload(initial) };
    });
    window.history.replaceState(null, "", "/?club=Ajax");
    const probe = renderWithProbe(
      controller,
      <SaveViewControl view={discoveryViewFromParams(new URLSearchParams("club=Ajax"))} />,
    );
    return { create, probe };
  }

  /** Waits for the account's canonical collection to arrive before acting. */
  async function readyForAccountWrites(probe: Probe) {
    await waitFor(() => expect(probe.views.current.mode).toBe("account"));
  }

  async function submitName(name: string) {
    fireEvent.click(screen.getByTestId("save-view-trigger"));
    fireEvent.change(screen.getByTestId("save-view-panel-input"), { target: { value: name } });
    fireEvent.click(screen.getByTestId("save-view-panel-submit"));
  }

  it("keeps the panel open, busy and silent while the create is in flight", async () => {
    const { create, probe } = renderPendingCreate();
    await readyForAccountWrites(probe);
    await submitName("Pending cohort");

    await waitFor(() => expect(screen.getByTestId("save-view-panel-submit")).toBeDisabled());
    // Until the server answers, nothing claims anything.
    expect(screen.getByTestId("save-view-panel")).toBeInTheDocument();
    expect(screen.getByTestId("save-view-panel-input")).toHaveValue("Pending cohort");
    expect(screen.getByTestId("save-view-panel-submit")).toHaveTextContent("Saving…");
    expect(screen.getByTestId("save-view-notice")).toHaveTextContent("");
    // The collection is honest about the write being unfinished.
    expect(probe.views.current.mode).toBe("account-saving");

    create.resolve({ json: viewsPayload([viewWire(ID_A, "Pending cohort", "Ajax")]) });

    await waitFor(() =>
      expect(screen.queryByTestId("save-view-panel")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("save-view-trigger")).toHaveFocus();
    expect(screen.getByTestId("save-view-notice")).toHaveTextContent(
      "Saved this Discovery view as Pending cohort.",
    );
    expect(probe.views.current.mode).toBe("account");
  });

  it("keeps the typed name, announces nothing, and drops the optimistic item on failure", async () => {
    const { create, probe } = renderPendingCreate();
    await readyForAccountWrites(probe);
    await submitName("Doomed cohort");
    await waitFor(() => expect(screen.getByTestId("save-view-panel-submit")).toBeDisabled());

    create.resolve({ status: 500 });

    await waitFor(() => expect(screen.getByTestId("save-view-panel-error")).toBeInTheDocument());
    // Open, typed value intact, retryable, and silent.
    expect(screen.getByTestId("save-view-panel-input")).toHaveValue("Doomed cohort");
    expect(screen.getByTestId("save-view-panel-submit")).toBeEnabled();
    expect(screen.getByTestId("save-view-notice")).toHaveTextContent("");
    // The optimistic artifact was rolled back.
    expect(probe.views.current.items).toHaveLength(0);
  });

  it("removes ONLY the failed create, leaving an unrelated account item alone", async () => {
    const { create, probe } = renderPendingCreate([viewWire(ID_B, "Untouched", "Bayern")]);
    await readyForAccountWrites(probe);
    await submitName("Doomed cohort");
    await waitFor(() => expect(screen.getByTestId("save-view-panel-submit")).toBeDisabled());
    expect(probe.views.current.items).toHaveLength(2);

    create.resolve({ status: 500 });

    await waitFor(() => expect(probe.views.current.items).toHaveLength(1));
    expect(probe.views.current.items[0].label).toBe("Untouched");
  });
});

describe("A signed-in rename reports only what the server confirmed", () => {
  /** The Saved hub, with canonical account views whose RENAME is held open. */
  function renderPendingRename(items = [viewWire(ID_A, "Confirmed name", "Ajax")]) {
    const patch = deferred<{ status?: number; json?: unknown }>();
    const controller = authenticatedController();
    installFetch((call) => {
      if (!call.url.includes("/me/saved-views")) return { json: EMPTY_COLLECTIONS };
      if (call.method === "PATCH") return patch.promise;
      return { json: viewsPayload(items) };
    });
    window.history.replaceState(null, "", "/saved?section=views");
    const probe = renderWithProbe(controller, <SavedPage />);
    return { patch, probe };
  }

  async function submitRename(from: string, to: string) {
    await waitFor(() =>
      expect(screen.getAllByTestId("saved-view-label")[0]).toHaveTextContent(from),
    );
    fireEvent.click(screen.getAllByTestId("saved-view-rename")[0]);
    fireEvent.change(screen.getByTestId("saved-view-rename-panel-input"), {
      target: { value: to },
    });
    fireEvent.click(screen.getByTestId("saved-view-rename-panel-submit"));
  }

  it("stays busy until the server confirms, then closes with the canonical label", async () => {
    const { patch } = renderPendingRename();
    await submitRename("Confirmed name", "New name");

    await waitFor(() =>
      expect(screen.getByTestId("saved-view-rename-panel-submit")).toBeDisabled(),
    );
    expect(screen.getByTestId("saved-view-rename-panel")).toBeInTheDocument();

    patch.resolve({ json: viewsPayload([viewWire(ID_A, "New name", "Ajax")]) });

    await waitFor(() =>
      expect(screen.queryByTestId("saved-view-rename-panel")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("saved-view-label")).toHaveTextContent("New name");
    expect(screen.getByTestId("saved-view-rename")).toHaveFocus();
  });

  it("RESTORES the last confirmed label when the rename fails", async () => {
    const { patch } = renderPendingRename();
    await submitRename("Confirmed name", "Never stored");

    // Optimistically renamed while in flight.
    await waitFor(() =>
      expect(screen.getByTestId("saved-view-label")).toHaveTextContent("Never stored"),
    );

    patch.resolve({ status: 500 });

    // The account never took it, so the account's own label comes back. Leaving
    // "Never stored" on screen would show state the server has never held.
    await waitFor(() =>
      expect(screen.getByTestId("saved-view-label")).toHaveTextContent("Confirmed name"),
    );
    // The panel stays open with the attempted name, so a retry is one press.
    expect(screen.getByTestId("saved-view-rename-panel-input")).toHaveValue("Never stored");
    expect(screen.getByTestId("saved-view-rename-panel-error")).toBeInTheDocument();
    expect(screen.getByTestId("saved-view-rename-panel-submit")).toBeEnabled();
  });

  it("rolls back only the failed rename, leaving a sibling item untouched", async () => {
    const { patch } = renderPendingRename([
      viewWire(ID_A, "Confirmed name", "Ajax"),
      viewWire(ID_B, "Sibling", "Bayern"),
    ]);
    await submitRename("Confirmed name", "Never stored");
    patch.resolve({ status: 500 });

    await waitFor(() => {
      const labels = screen.getAllByTestId("saved-view-label").map((n) => n.textContent);
      expect(labels).toEqual(["Confirmed name", "Sibling"]);
    });
  });

  it("announces no success for a rename that failed", async () => {
    const { patch, probe } = renderPendingRename();
    await submitRename("Confirmed name", "Never stored");
    patch.resolve({ status: 500 });
    await waitFor(() =>
      expect(screen.getByTestId("saved-view-rename-panel-error")).toBeInTheDocument(),
    );
    expect(probe.views.current.error).toBeTruthy();
    expect(probe.views.current.mode).toBe("account-desynced");
  });
});

describe("A signed-in comparison rename is equally truthful", () => {
  function comparisonWire(clientId: string, label: string) {
    return {
      client_id: clientId,
      label,
      player_a: { player_id: 7, label: "Anton Keller", available: true },
      player_b: { player_id: 5, label: "Luca Moretti", available: true },
      role_key: null,
      fingerprint: "fp",
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-01T00:00:00+00:00",
    };
  }

  it("restores the confirmed label and stays open when the rename fails", async () => {
    const patch = deferred<{ status?: number; json?: unknown }>();
    const controller = authenticatedController();
    installFetch((call) => {
      if (!call.url.includes("/me/saved-comparisons")) return { json: EMPTY_COLLECTIONS };
      if (call.method === "PATCH") return patch.promise;
      return {
        json: {
          items: [comparisonWire(ID_A, "Confirmed duel")],
          count: 1,
          added: [],
          already_present: [],
          rejected: [],
        },
      };
    });
    window.history.replaceState(null, "", "/saved?section=comparisons");
    renderWithProbe(controller, <SavedPage />);

    await waitFor(() =>
      expect(screen.getByTestId("saved-comparison-label")).toHaveTextContent("Confirmed duel"),
    );
    fireEvent.click(screen.getByTestId("saved-comparison-rename"));
    fireEvent.change(screen.getByTestId("saved-comparison-rename-panel-input"), {
      target: { value: "Never stored" },
    });
    fireEvent.click(screen.getByTestId("saved-comparison-rename-panel-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("saved-comparison-label")).toHaveTextContent("Never stored"),
    );
    patch.resolve({ status: 500 });

    await waitFor(() =>
      expect(screen.getByTestId("saved-comparison-label")).toHaveTextContent("Confirmed duel"),
    );
    expect(screen.getByTestId("saved-comparison-rename-panel-input")).toHaveValue("Never stored");
    expect(screen.getByTestId("saved-comparison-rename-panel-error")).toBeInTheDocument();
  });
});

describe("Superseded and out-of-generation writes stay silent", () => {
  it("does not roll back a NEWER intent when the older request fails", async () => {
    const first = deferred<{ status?: number; json?: unknown }>();
    const controller = authenticatedController();
    let patches = 0;
    installFetch((call) => {
      if (!call.url.includes("/me/saved-views")) return { json: EMPTY_COLLECTIONS };
      if (call.method === "PATCH") {
        patches += 1;
        if (patches === 1) return first.promise;
        return { json: viewsPayload([viewWire(ID_A, "Second attempt", "Ajax")]) };
      }
      return { json: viewsPayload([viewWire(ID_A, "Confirmed name", "Ajax")]) };
    });
    window.history.replaceState(null, "", "/saved?section=views");
    const probe = renderWithProbe(controller);
    await waitFor(() => expect(probe.views.current.mode).toBe("account"));

    // The first rename must be genuinely IN FLIGHT before the second is asked
    // for; two synchronous calls would coalesce into a single request and prove
    // nothing about supersession.
    const firstCall = probe.views.current.rename(ID_A, "First attempt");
    await waitFor(() => expect(patches).toBe(1));
    const secondCall = probe.views.current.rename(ID_A, "Second attempt");

    first.resolve({ status: 500 });

    // The superseded caller reports neither success nor failure.
    await expect(firstCall).resolves.toEqual({ ok: false, disposition: "superseded" });
    await expect(secondCall).resolves.toEqual({ ok: true, disposition: "updated" });
    // The older failure did not roll the newer intent back.
    await waitFor(() => expect(probe.views.current.items[0].label).toBe("Second attempt"));
    expect(probe.views.current.error).toBeNull();
  });

  it("releases a caller whose account changed, without repainting the new account", async () => {
    const hold = deferred<{ status?: number; json?: unknown }>();
    const controller = authenticatedController("acct_a", "token-a");
    installFetch((call) => {
      if (!call.url.includes("/me/saved-views")) return { json: EMPTY_COLLECTIONS };
      if (call.method === "POST" && !call.url.endsWith("/merge")) return hold.promise;
      if (call.authorization === "Bearer token-a") {
        return { json: viewsPayload([viewWire(ID_A, "Account A view", "Ajax")]) };
      }
      return { json: viewsPayload([]) };
    });
    window.history.replaceState(null, "", "/saved?section=views");
    const probe = renderWithProbe(controller);
    await waitFor(() => expect(probe.views.current.mode).toBe("account"));

    const pending = probe.views.current.save("Started under A", { club: "Milan" });
    await waitFor(() => expect(probe.views.current.mode).toBe("account-saving"));

    // Account B arrives while A's create is still in flight.
    controller.set(
      makeSession({
        status: "authenticated",
        accountKey: "acct_b",
        getToken: async () => "token-b",
      }),
    );

    // Released rather than left hanging, and it says nothing either way.
    await expect(pending).resolves.toEqual({ ok: false, disposition: "superseded" });

    // A's delayed response lands late and must not repaint B.
    hold.resolve({ json: viewsPayload([viewWire(ID_A, "Account A view", "Ajax")]) });
    await new Promise((r) => setTimeout(r, 20));
    const labels = probe.views.current.items.map((i) => i.label);
    expect(labels).not.toContain("Account A view");
    expect(labels).not.toContain("Started under A");
  });
});

// ---------------------------------------------------------------------------
// Overlapping writes roll back to the CANONICAL state, not the queued one
//
// The state machine already refused to let an older response undo a newer
// intent. What it did not do was keep the newer intent's ROLLBACK BASELINE level
// with the account: that baseline was captured when the newer write was queued,
// which is necessarily before the older write's response updated the canonical
// state. So the sequence "confirmed A, rename to B, rename to C before B settles,
// B succeeds, C fails" rolled the item back to A while the server held B, and the
// two stayed visibly out of step until the next load.
//
// Every test below drives deferred responses in an explicit order, so the overlap
// is a property of the sequence rather than of timing.
// ---------------------------------------------------------------------------

describe("A failed write rolls back to the newest state the server confirmed", () => {
  /** One canonical saved comparison, as the API reports it. */
  function duelWire(clientId: string, label: string) {
    return {
      client_id: clientId,
      label,
      player_a: { player_id: 7, label: "Anton Keller", available: true },
      player_b: { player_id: 5, label: "Luca Moretti", available: true },
      role_key: null,
      fingerprint: "fp",
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-01T00:00:00+00:00",
    };
  }

  function duelsPayload(items: ReturnType<typeof duelWire>[]) {
    return { items, count: items.length, added: [], already_present: [], rejected: [] };
  }

  /**
   * An account collection whose per-item writes are all held open.
   *
   * Every PATCH and DELETE gets its own deferred, pushed onto `writes` in the
   * order the requests were actually issued - so a test resolves request 1 and
   * request 2 independently, in whichever order the scenario needs. Writes are
   * serialized per item, so `writes.length` reaching N is itself the proof that
   * the previous N-1 were dispatched.
   */
  function renderHeldWrites(options: {
    surface: "saved-views" | "saved-comparisons";
    initial: unknown[];
    /** Answers a call before the default routing; return `undefined` to defer. */
    route?: (call: FetchCall) => { status?: number; json?: unknown } | undefined;
  }) {
    const writes: { resolve: (value: { status?: number; json?: unknown }) => void }[] = [];
    const controller = authenticatedController();
    installFetch((call) => {
      if (!call.url.includes(`/me/${options.surface}`)) return { json: EMPTY_COLLECTIONS };
      if (call.method === "PATCH" || call.method === "DELETE") {
        const held = deferred<{ status?: number; json?: unknown }>();
        writes.push(held);
        return held.promise;
      }
      const routed = options.route?.(call);
      if (routed !== undefined) return routed;
      return {
        json: {
          items: options.initial,
          count: options.initial.length,
          added: [],
          already_present: [],
          rejected: [],
        },
      };
    });
    window.history.replaceState(null, "", "/saved");
    const probe = renderWithProbe(controller);
    return { writes, controller, probe };
  }

  const labelsOf = (probe: Probe, which: "views" | "comparisons" = "views") =>
    (which === "views" ? probe.views.current.items : probe.comparisons.current.items).map(
      (item) => item.label,
    );

  it("settles a saved VIEW on the confirmed label, not the one the newer rename was queued against", async () => {
    const { writes, probe } = renderHeldWrites({
      surface: "saved-views",
      initial: [viewWire(ID_A, "A", "Ajax")],
    });
    await waitFor(() => expect(probe.views.current.mode).toBe("account"));

    // 1. The first rename is genuinely IN FLIGHT before the second is asked for.
    const older = probe.views.current.rename(ID_A, "B");
    await waitFor(() => expect(writes).toHaveLength(1));
    const newer = probe.views.current.rename(ID_A, "C");
    await waitFor(() => expect(labelsOf(probe)).toEqual(["C"]));

    // 2. The first request SUCCEEDS: the account now holds B.
    writes[0].resolve({ json: viewsPayload([viewWire(ID_A, "B", "Ajax")]) });
    // 3. The second is dispatched, and refused.
    await waitFor(() => expect(writes).toHaveLength(2));
    writes[1].resolve({ status: 500 });

    // The older caller is silent; only the newer one reports the failure.
    await expect(older).resolves.toEqual({ ok: false, disposition: "superseded" });
    await expect(newer).resolves.toMatchObject({ ok: false, disposition: "failed" });

    // The visible label is what the SERVER holds: not the stale A the second
    // rename was queued against, and not the C it never stored.
    await waitFor(() => expect(labelsOf(probe)).toEqual(["B"]));
    expect(probe.views.current.error).toBeTruthy();
    // Nothing is still pending - `account-saving` would claim a write is running.
    expect(probe.views.current.mode).toBe("account-desynced");
  });

  it("settles a saved COMPARISON the same way, under the same state machine", async () => {
    const { writes, probe } = renderHeldWrites({
      surface: "saved-comparisons",
      initial: [duelWire(ID_A, "A")],
    });
    await waitFor(() => expect(probe.comparisons.current.mode).toBe("account"));

    const older = probe.comparisons.current.rename(ID_A, "B");
    await waitFor(() => expect(writes).toHaveLength(1));
    const newer = probe.comparisons.current.rename(ID_A, "C");
    await waitFor(() => expect(labelsOf(probe, "comparisons")).toEqual(["C"]));

    writes[0].resolve({ json: duelsPayload([duelWire(ID_A, "B")]) });
    await waitFor(() => expect(writes).toHaveLength(2));
    writes[1].resolve({ status: 500 });

    await expect(older).resolves.toEqual({ ok: false, disposition: "superseded" });
    await expect(newer).resolves.toMatchObject({ ok: false, disposition: "failed" });

    await waitFor(() => expect(labelsOf(probe, "comparisons")).toEqual(["B"]));
    expect(probe.comparisons.current.error).toBeTruthy();
    expect(probe.comparisons.current.mode).toBe("account-desynced");
  });

  it("leaves a SIBLING item untouched while the overlapping pair rebases", async () => {
    const { writes, probe } = renderHeldWrites({
      surface: "saved-views",
      initial: [viewWire(ID_A, "A", "Ajax"), viewWire(ID_B, "Sibling", "Bayern")],
    });
    await waitFor(() => expect(probe.views.current.mode).toBe("account"));

    const older = probe.views.current.rename(ID_A, "B");
    await waitFor(() => expect(writes).toHaveLength(1));
    const newer = probe.views.current.rename(ID_A, "C");
    await waitFor(() => expect(labelsOf(probe)).toEqual(["C", "Sibling"]));

    writes[0].resolve({
      json: viewsPayload([viewWire(ID_A, "B", "Ajax"), viewWire(ID_B, "Sibling", "Bayern")]),
    });
    await waitFor(() => expect(writes).toHaveLength(2));
    writes[1].resolve({ status: 500 });

    await expect(older).resolves.toEqual({ ok: false, disposition: "superseded" });
    await expect(newer).resolves.toMatchObject({ ok: false, disposition: "failed" });
    // Item-scoped: one item was restored, and nothing else moved.
    await waitFor(() => expect(labelsOf(probe)).toEqual(["B", "Sibling"]));
  });

  it("does not FABRICATE an item the canonical collection says is gone", async () => {
    const { writes, probe } = renderHeldWrites({
      surface: "saved-views",
      initial: [viewWire(ID_A, "A", "Ajax"), viewWire(ID_B, "Sibling", "Bayern")],
    });
    await waitFor(() => expect(probe.views.current.mode).toBe("account"));

    const older = probe.views.current.rename(ID_A, "B");
    await waitFor(() => expect(writes).toHaveLength(1));
    const newer = probe.views.current.rename(ID_A, "C");
    await waitFor(() => expect(labelsOf(probe)).toEqual(["C", "Sibling"]));

    // The first request returns a canonical collection that NO LONGER CONTAINS
    // the item - it was deleted from another device while these renames were in
    // flight. The account's answer is authoritative, so it goes here too.
    writes[0].resolve({ json: viewsPayload([viewWire(ID_B, "Sibling", "Bayern")]) });
    await waitFor(() => expect(labelsOf(probe)).toEqual(["Sibling"]));

    await waitFor(() => expect(writes).toHaveLength(2));
    writes[1].resolve({ status: 500 });

    await expect(older).resolves.toEqual({ ok: false, disposition: "superseded" });
    await expect(newer).resolves.toMatchObject({ ok: false, disposition: "failed" });
    // The rollback restores nothing: reviving A would invent account state.
    await waitFor(() => expect(probe.views.current.error).toBeTruthy());
    expect(labelsOf(probe)).toEqual(["Sibling"]);
  });

  it("restores what the ACCOUNT holds when an overlapping REMOVE fails", async () => {
    const { writes, probe } = renderHeldWrites({
      surface: "saved-views",
      initial: [viewWire(ID_A, "A", "Ajax"), viewWire(ID_B, "Sibling", "Bayern")],
    });
    await waitFor(() => expect(probe.views.current.mode).toBe("account"));

    // A rename is in flight, so the item on screen carries a label the server has
    // never confirmed. The removal queued behind it must not adopt that label as
    // its rollback baseline.
    const older = probe.views.current.rename(ID_A, "Optimistic only");
    await waitFor(() => expect(writes).toHaveLength(1));
    const newer = probe.views.current.remove(ID_A);
    await waitFor(() => expect(labelsOf(probe)).toEqual(["Sibling"]));

    writes[0].resolve({ status: 500 }); // the rename is refused, and superseded
    await waitFor(() => expect(writes).toHaveLength(2));
    writes[1].resolve({ status: 500 }); // and so is the removal

    await expect(older).resolves.toEqual({ ok: false, disposition: "superseded" });
    await expect(newer).resolves.toMatchObject({ ok: false, disposition: "failed" });

    // Back at its original index, under the label the ACCOUNT holds - never the
    // optimistic one that only ever existed on screen.
    await waitFor(() => expect(labelsOf(probe)).toEqual(["A", "Sibling"]));
  });

  it("cannot repaint another account when the generation changes mid-sequence", async () => {
    const { writes, controller, probe } = renderHeldWrites({
      surface: "saved-views",
      initial: [],
      route: (call) =>
        call.authorization === "Bearer token-a"
          ? { json: viewsPayload([viewWire(ID_A, "A", "Ajax")]) }
          : { json: viewsPayload([viewWire(ID_B, "Account B view", "Bayern")]) },
    });
    await waitFor(() => expect(labelsOf(probe)).toEqual(["A"]));

    const older = probe.views.current.rename(ID_A, "B");
    await waitFor(() => expect(writes).toHaveLength(1));
    const newer = probe.views.current.rename(ID_A, "C");
    await waitFor(() => expect(labelsOf(probe)).toEqual(["C"]));

    // Account B arrives while both writes are outstanding.
    controller.set(
      makeSession({
        status: "authenticated",
        accountKey: "acct_b",
        getToken: async () => "token-b",
      }),
    );

    // Both callers are released rather than left busy, and both stay silent.
    await expect(older).resolves.toEqual({ ok: false, disposition: "superseded" });
    await expect(newer).resolves.toEqual({ ok: false, disposition: "superseded" });

    // A's confirmation lands after the switch. Neither it nor any rollback it
    // could have triggered may touch B: not the confirmed B, not the rolled-back
    // A, not the C that was never stored.
    writes[0].resolve({ json: viewsPayload([viewWire(ID_A, "B", "Ajax")]) });
    await new Promise((r) => setTimeout(r, 20));

    await waitFor(() => expect(labelsOf(probe)).toEqual(["Account B view"]));
    expect(probe.views.current.error).toBeNull();
    expect(probe.views.current.mode).toBe("account");
    // And the superseded second request was never issued under B's identity.
    expect(writes).toHaveLength(1);
  });
});
