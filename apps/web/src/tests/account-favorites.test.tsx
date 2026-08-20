import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSuggestion } from "@/components/account/AccountSuggestion";
import { BottomRail } from "@/components/common/BottomRail";
import { NavBar } from "@/components/common/NavBar";
import {
  CompareRailButton,
  FavoriteHeartButton,
  ScoutingLiveRegion,
} from "@/components/common/PlayerActions";
import {
  DISMISSAL_WINDOW_MS,
  SUGGESTION_KEY,
  isSuppressed,
  readDismissedAt,
} from "@/lib/auth/suggestion-state";
import { RESOLVE_TIMEOUT_MS } from "@/lib/auth/session";
import { ScoutingStateProvider, useScoutingState } from "@/lib/state/scouting-state";
import { setReducedMotion } from "./setup";
import {
  AccountHarness,
  SwitchableHarness,
  createSessionController,
  deferred,
  type Deferred,
  installDeferredFetch,
  installFetchRecorder,
  makeQueryClient,
  makeSession,
  type FetchCall,
} from "./support/account-harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const SHORTLIST_KEY = "scoutboy.shortlist.v1";
const COMPARE_KEY = "scoutboy.compareQueue.v1";
const SESSION_KEY = "scoutboy.accountSuggestion.session.v1";

const ANTON = { id: 6, name: "Anton Keller" };
const JACK = { id: 11, name: "Jack Whitmore" };

/** Surfaces the parts of the store an assertion needs, without a real page. */
function Probe() {
  const { shortlistIds, favorites, compareQueue } = useScoutingState();
  return (
    <div>
      <span data-testid="ids">{JSON.stringify(shortlistIds)}</span>
      <span data-testid="mode">{favorites.mode}</span>
      <span data-testid="count">{String(favorites.count)}</span>
      <span data-testid="error">{favorites.syncError ?? ""}</span>
      <span data-testid="queue">{JSON.stringify(compareQueue.map((p) => p.id))}</span>
      <button type="button" data-testid="retry" onClick={favorites.retrySync}>
        Retry
      </button>
    </div>
  );
}

function favoritesJson(ids: number[]) {
  return { player_ids: ids, count: ids.length };
}

function mergeJson(ids: number[], added: number[]) {
  return { player_ids: ids, count: ids.length, added, already_present: [], unknown: [] };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. The anonymous product, with no identity provider at all
// ---------------------------------------------------------------------------

describe("Auth-disabled build behaves exactly as the pre-8.4A product", () => {
  it("hydrates, toggles and persists guest favourites with no provider in the tree", () => {
    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([ANTON.id]));
    render(
      <ScoutingStateProvider>
        <FavoriteHeartButton player={ANTON} />
        <FavoriteHeartButton player={JACK} />
        <Probe />
      </ScoutingStateProvider>,
    );

    expect(screen.getByTestId("ids")).toHaveTextContent("[6]");
    expect(screen.getByTestId("mode")).toHaveTextContent("guest");

    fireEvent.click(screen.getByLabelText(/Add Jack Whitmore to My Favorites/i));
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,11]");
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([6, 11]);

    fireEvent.click(screen.getByLabelText(/Remove Anton Keller from My Favorites/i));
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([11]);
  });

  it("recovers from corrupt guest storage and drops non-positive ids, as before", () => {
    window.localStorage.setItem(SHORTLIST_KEY, "{not json");
    const { unmount } = render(
      <ScoutingStateProvider>
        <Probe />
      </ScoutingStateProvider>,
    );
    expect(screen.getByTestId("ids")).toHaveTextContent("[]");
    unmount();

    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([6, -1, 0, "x", 11, null]));
    render(
      <ScoutingStateProvider>
        <Probe />
      </ScoutingStateProvider>,
    );
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,11]");
  });

  it("keeps a stale guest id in the list so My Favorites can still offer removal", () => {
    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([6, 99999901]));
    render(
      <ScoutingStateProvider>
        <Probe />
      </ScoutingStateProvider>,
    );
    // Unresolvable ids remain the My Favorites page's business, not the store's:
    // it still holds them, exactly as it did before accounts existed.
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,99999901]");
  });

  it("says 'saved on this device' and shows no account entry", () => {
    render(
      <ScoutingStateProvider>
        <NavBar />
      </ScoutingStateProvider>,
    );
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
      "My Favorites 0 · saved on this device",
    );
    expect(screen.queryByTestId("account-sign-in")).toBeNull();
    expect(screen.queryByTestId("account-entry-authenticated")).toBeNull();
  });

  it("never renders the account suggestion, however many players are saved", () => {
    render(
      <ScoutingStateProvider>
        <FavoriteHeartButton player={ANTON} />
        <AccountSuggestion />
      </ScoutingStateProvider>,
    );
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    expect(screen.queryByTestId("account-suggestion")).toBeNull();
  });

  it("leaves the compare queue device-local and untouched", () => {
    render(
      <ScoutingStateProvider>
        <CompareRailButton player={ANTON} />
        <Probe />
      </ScoutingStateProvider>,
    );
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to compare queue/i));
    expect(screen.getByTestId("queue")).toHaveTextContent("[6]");
    expect(JSON.parse(window.localStorage.getItem(COMPARE_KEY)!)).toEqual([
      { id: 6, name: "Anton Keller" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. The contextual account suggestion
// ---------------------------------------------------------------------------

describe("Account suggestion", () => {
  function renderGuest(extra?: React.ReactNode) {
    return render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <FavoriteHeartButton player={ANTON} />
        <FavoriteHeartButton player={JACK} />
        <AccountSuggestion />
        <Probe />
        {extra}
      </AccountHarness>,
    );
  }

  it("appears only after a new guest favourite has actually been saved", () => {
    renderGuest();
    expect(screen.queryByTestId("account-suggestion")).toBeNull();

    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));

    // The save is complete before the offer exists: the list and browser storage
    // already hold the player in the commit the suggestion appears in.
    expect(screen.getByTestId("ids")).toHaveTextContent("[6]");
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([6]);
    expect(screen.getByTestId("account-suggestion")).toBeInTheDocument();
  });

  it("does not appear on hydration, however many favourites already exist", () => {
    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([6, 11]));
    renderGuest();
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,11]");
    expect(screen.queryByTestId("account-suggestion")).toBeNull();
  });

  it("does not appear after a removal", () => {
    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([ANTON.id]));
    renderGuest();
    fireEvent.click(screen.getByLabelText(/Remove Anton Keller from My Favorites/i));
    expect(screen.queryByTestId("account-suggestion")).toBeNull();
  });

  it("is not triggered by the compare queue", () => {
    render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <CompareRailButton player={ANTON} />
        <AccountSuggestion />
      </AccountHarness>,
    );
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to compare queue/i));
    expect(screen.queryByTestId("account-suggestion")).toBeNull();
  });

  it("shows at most once per browser session", () => {
    // Reduced motion so the dismissal unmounts in the same commit: this test is
    // about the once-per-session rule, not about the 120ms exit.
    setReducedMotion(true);
    renderGuest();
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    expect(screen.getByTestId("account-suggestion")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("account-suggestion-dismiss"));
    expect(screen.queryByTestId("account-suggestion")).toBeNull();

    fireEvent.click(screen.getByLabelText(/Add Jack Whitmore to My Favorites/i));
    expect(screen.queryByTestId("account-suggestion")).toBeNull();
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe("1");
  });

  it("plays the shared exit cadence, then unmounts", async () => {
    renderGuest();
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    fireEvent.click(screen.getByTestId("account-suggestion-dismiss"));

    // Held for the exit only, carrying the tray's own exit class.
    expect(screen.getByTestId("account-suggestion").className).toContain("callout-exit");
    await waitFor(() => expect(screen.queryByTestId("account-suggestion")).toBeNull());
  });

  it("does not steal focus, and returns it to the favourite control on dismissal", () => {
    renderGuest();
    const favorite = screen.getByLabelText(/Add Anton Keller to My Favorites/i);
    favorite.focus();
    fireEvent.click(favorite);

    // Focus stays exactly where the user left it.
    expect(document.activeElement).toBe(favorite);
    expect(screen.getByTestId("account-suggestion")).toBeInTheDocument();

    const dismiss = screen.getByTestId("account-suggestion-dismiss");
    dismiss.focus();
    fireEvent.click(dismiss);
    // Dismissing from inside returns to the control that opened it, rather than
    // dropping focus onto document.body.
    expect(document.activeElement).toBe(
      screen.getByLabelText(/Remove Anton Keller from My Favorites/i),
    );
  });

  it("is dismissible with Escape, recording the same suppression as Not now", () => {
    setReducedMotion(true);
    renderGuest();
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    expect(screen.getByTestId("account-suggestion")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("account-suggestion")).toBeNull();
    expect(readDismissedAt()).not.toBeNull();
  });

  it("announces the new information only, in a polite status region", () => {
    renderGuest(<ScoutingLiveRegion />);
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));

    const message = screen.getByTestId("account-suggestion-message");
    expect(message).toHaveAttribute("role", "status");
    expect(message).toHaveTextContent(
      "Saved on this device. Create an account to keep your favorites when you return or switch devices.",
    );
    // The existing favourites live region keeps its own unchanged sentence, so
    // the two do not read the same wording twice.
    expect(screen.getByText(/added to shortlist\. Saved on this device\./i)).toBeInTheDocument();
  });

  it("offers Create account, Sign in and Not now, and invokes the right flow", () => {
    const onSignIn = vi.fn();
    const onSignUp = vi.fn();
    render(
      <AccountHarness session={makeSession({ status: "anonymous", onSignIn, onSignUp })}>
        <FavoriteHeartButton player={ANTON} />
        <AccountSuggestion />
      </AccountHarness>,
    );
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    expect(screen.getByTestId("account-suggestion-signin")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("account-suggestion-create"));
    expect(onSignUp).toHaveBeenCalledTimes(1);
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("never appears for an authenticated account", async () => {
    installFetchRecorder(() => ({ json: favoritesJson([]) }));
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={ANTON} />
        <AccountSuggestion />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    });
    expect(screen.queryByTestId("account-suggestion")).toBeNull();
  });
});

describe("Suggestion suppression state", () => {
  it("suppresses for the documented 30-day window and then lapses", () => {
    const now = 1_700_000_000_000;
    window.localStorage.setItem(SUGGESTION_KEY, JSON.stringify({ v: 1, dismissedAt: now }));

    expect(isSuppressed(now + 1_000)).toBe(true);
    expect(isSuppressed(now + DISMISSAL_WINDOW_MS - 1)).toBe(true);
    expect(isSuppressed(now + DISMISSAL_WINDOW_MS)).toBe(false);
  });

  it("does not re-offer while a dismissal is inside its window", () => {
    window.localStorage.setItem(
      SUGGESTION_KEY,
      JSON.stringify({ v: 1, dismissedAt: Date.now() - 1000 }),
    );
    render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <FavoriteHeartButton player={ANTON} />
        <AccountSuggestion />
      </AccountHarness>,
    );
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    expect(screen.queryByTestId("account-suggestion")).toBeNull();
  });

  it.each([
    ["not json at all", "{{{"],
    ["a bare number", "42"],
    ["null", "null"],
    ["an array", "[1,2,3]"],
    ["an unknown version", JSON.stringify({ v: 99, dismissedAt: Date.now() })],
    ["a missing timestamp", JSON.stringify({ v: 1 })],
    ["a null timestamp", '{"v":1,"dismissedAt":null}'],
    ["a negative timestamp", JSON.stringify({ v: 1, dismissedAt: -5 })],
    ["a timestamp in the future", JSON.stringify({ v: 1, dismissedAt: Date.now() + 9e12 })],
  ])("recovers safely from corrupt suppression state: %s", (_label, raw) => {
    window.localStorage.setItem(SUGGESTION_KEY, raw);
    // Fails OPEN: unreadable preference state must never throw on the favourite
    // path, and offering once more is a far smaller harm than a broken save.
    expect(() => readDismissedAt()).not.toThrow();
    expect(readDismissedAt()).toBeNull();
    expect(isSuppressed()).toBe(false);

    render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <FavoriteHeartButton player={ANTON} />
        <AccountSuggestion />
      </AccountHarness>,
    );
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    expect(screen.getByTestId("account-suggestion")).toBeInTheDocument();
  });

  it("survives a localStorage that throws on every access", () => {
    const exploding = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    vi.stubGlobal("localStorage", exploding);
    expect(() => readDismissedAt()).not.toThrow();
    expect(isSuppressed()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Copy
// ---------------------------------------------------------------------------

describe("Device and account copy", () => {
  it("withholds the number while the session is resolving, and claims nothing", () => {
    render(
      <AccountHarness session={makeSession({ status: "resolving" })}>
        <NavBar />
        <Probe />
      </AccountHarness>,
    );
    const counter = screen.getByTestId("favorites-counter");
    expect(counter).toHaveTextContent("My Favorites · checking your account");
    expect(counter).not.toHaveTextContent("saved on this device");
    expect(counter).not.toHaveTextContent("saved to your account");
    // No "0" is rendered while resolving, so a returning account holder never
    // reads an empty list that is about to be replaced by their real one.
    expect(screen.getByTestId("count")).toHaveTextContent("null");
    expect(screen.getByTestId("account-entry-resolving")).toBeInTheDocument();
  });

  it("says 'saved on this device' for a signed-out visitor on an auth-enabled build", () => {
    render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <NavBar />
      </AccountHarness>,
    );
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
      "My Favorites 0 · saved on this device",
    );
    expect(screen.getByTestId("account-sign-in")).toBeInTheDocument();
  });

  it("says 'saved to your account' once the account list has landed", async () => {
    installFetchRecorder(() => ({ json: favoritesJson([6, 11]) }));
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <NavBar />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
        "My Favorites 2 · saved to your account",
      ),
    );
    expect(screen.getByTestId("account-entry-authenticated")).toBeInTheDocument();
    expect(screen.getByTestId("account-sign-out")).toBeInTheDocument();
  });

  it("does not claim account durability when synchronization has failed", async () => {
    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([6]));
    installFetchRecorder(() => ({ status: 500 }));
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <NavBar />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("mode")).toHaveTextContent("account-unconfirmed"),
    );
    const counter = screen.getByTestId("favorites-counter");
    expect(counter).toHaveTextContent("saved on this device, not in your account yet");
    expect(counter).not.toHaveTextContent("· saved to your account");
  });
});

// ---------------------------------------------------------------------------
// 4. Guest to account merge
// ---------------------------------------------------------------------------

describe("Guest to account merge", () => {
  it("sends the guest list, adopts server order, and only then retires the local copy", async () => {
    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([11, 6]));
    const calls = installFetchRecorder(() => ({ json: mergeJson([4, 11, 6], [11, 6]) }));

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <Probe />
      </AccountHarness>,
    );

    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));

    const merge = calls.find((c: FetchCall) => c.url.endsWith("/me/favorites/merge"))!;
    expect(merge.method).toBe("POST");
    expect(merge.authorization).toBe("Bearer test-token");
    expect(merge.body).toEqual({ player_ids: [11, 6] });

    // The server's canonical order wins, including a player the account already
    // held that this browser had never seen.
    expect(screen.getByTestId("ids")).toHaveTextContent("[4,11,6]");
    // Retired only after the server confirmed it holds them.
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([]);
  });

  it("keeps the retained list VISIBLE and accurate while a failed merge waits to retry", async () => {
    // The regression this covers: guest favourites survived in localStorage but
    // vanished from the interface, because authenticated rendering substituted an
    // empty account list. The players looked deleted while sitting safely on disk.
    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([11, 6]));
    let attempt = 0;
    installFetchRecorder(() => {
      attempt += 1;
      return attempt === 1 ? { status: 503 } : { json: mergeJson([11, 6], [11, 6]) };
    });

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={JACK} />
        <FavoriteHeartButton player={ANTON} />
        <NavBar />
        <Probe />
      </AccountHarness>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("mode")).toHaveTextContent("account-unconfirmed"),
    );

    // 1. The list is still on screen, in its original order.
    expect(screen.getByTestId("ids")).toHaveTextContent("[11,6]");
    // 2. Both favourite controls still read as pressed.
    expect(screen.getByLabelText(/Remove Jack Whitmore from My Favorites/i)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText(/Remove Anton Keller from My Favorites/i)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // 3. The count is the real count, not zero and not withheld.
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    // 4. The copy is truthful: on this device, not in the account yet.
    const counter = screen.getByTestId("favorites-counter");
    expect(counter).toHaveTextContent("My Favorites 2 · saved on this device, not in your account yet");
    expect(counter).not.toHaveTextContent("· saved to your account");
    // 5. Nothing was thrown away.
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([11, 6]);
    // 6. There is an actionable error.
    expect(screen.getByTestId("error").textContent).toMatch(/still on this device/i);

    // Retry re-sends the SAME retained list, and only success retires it.
    await act(async () => {
      fireEvent.click(screen.getByTestId("retry"));
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
    expect(screen.getByTestId("ids")).toHaveTextContent("[11,6]");
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([]);
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
      "My Favorites 2 · saved to your account",
    );
  });

  it("withholds the count when an account load fails with nothing trustworthy locally", async () => {
    // No guest list, and the account list never arrived: the honest answer is
    // "we do not know", never a confident zero.
    installFetchRecorder(() => ({ status: 500 }));
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <NavBar />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account-desynced"));
    expect(screen.getByTestId("count")).toHaveTextContent("null");
    const counter = screen.getByTestId("favorites-counter");
    expect(counter).toHaveTextContent("My Favorites · not saved to your account yet");
    expect(counter).not.toHaveTextContent("0");
    // And it does not claim the device is holding anything.
    expect(counter).not.toHaveTextContent("saved on this device");
  });

  it("reads the account list instead of merging when there is no guest list", async () => {
    const calls = installFetchRecorder(() => ({ json: favoritesJson([9]) }));
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[9]"));

    // An empty client must never POST an empty list at a non-empty account.
    expect(calls.some((c: FetchCall) => c.url.endsWith("/merge"))).toBe(false);
    expect(calls[0].method).toBe("GET");
  });

  it("merges a player favourited moments before sign-in completed", async () => {
    const controller = createSessionController(makeSession({ status: "anonymous" }));
    const calls = installFetchRecorder(() => ({ json: mergeJson([6], [6]) }));

    render(
      <SwitchableHarness controller={controller}>
        <FavoriteHeartButton player={ANTON} />
        <Probe />
      </SwitchableHarness>,
    );

    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([6]);

    await act(async () => {
      controller.set(makeSession({ status: "authenticated", accountKey: "acct_a" }));
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));

    const merge = calls.find((c: FetchCall) => c.url.endsWith("/merge"))!;
    expect(merge.body).toEqual({ player_ids: [6] });
  });
});

// ---------------------------------------------------------------------------
// 5. Authenticated toggling
// ---------------------------------------------------------------------------

describe("Authenticated favourite toggling", () => {
  it("writes through to the account and adopts the canonical list", async () => {
    const calls = installFetchRecorder((call: FetchCall) =>
      call.method === "PUT"
        ? { json: { ...favoritesJson([6]), player_id: 6, changed: true } }
        : { json: favoritesJson([]) },
    );

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={ANTON} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    });
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6]"));

    const put = calls.find((c: FetchCall) => c.method === "PUT")!;
    expect(put.url).toContain("/me/favorites/6");
    expect(put.authorization).toBe("Bearer test-token");
    // The account list is never mirrored into anonymous browser storage.
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY) ?? "[]")).toEqual([]);
  });

  it("announces Saving, never Saved, while the account write is in flight", async () => {
    let release: (() => void) | null = null;
    installFetchRecorder(async (call: FetchCall) => {
      if (call.method !== "PUT") return { json: favoritesJson([]) };
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { json: { ...favoritesJson([6]), player_id: 6, changed: true } };
    });

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={ANTON} />
        <ScoutingLiveRegion />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));

    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    await waitFor(() =>
      expect(
        screen.getByText("Anton Keller added to My Favorites. Saving to your account."),
      ).toBeInTheDocument(),
    );
    // Durability is not claimed before it exists.
    expect(screen.queryByText(/Saved to your account/i)).toBeNull();
    await act(async () => {
      release?.();
    });
  });

  it("rolls back accurately when the account write fails, touching only that player", async () => {
    installFetchRecorder((call: FetchCall) => {
      if (call.method === "GET") return { json: favoritesJson([11]) };
      if (call.method === "PUT" && call.url.endsWith("/6")) return { status: 500 };
      return { json: { ...favoritesJson([11]), player_id: 6, changed: false } };
    });

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={ANTON} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[11]"));

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    });

    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account-desynced"));
    // Anton is gone again; Jack, never part of the failed request, is untouched.
    expect(screen.getByTestId("ids")).toHaveTextContent("[11]");
    expect(screen.getByTestId("error").textContent).toMatch(/could not be saved/i);
    expect(screen.getByLabelText(/Add Anton Keller to My Favorites/i)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("settles deterministically under rapid repeated toggling", async () => {
    const methods: string[] = [];
    installFetchRecorder((call: FetchCall) => {
      if (call.method === "GET") return { json: favoritesJson([]) };
      methods.push(call.method);
      const ids = call.method === "PUT" ? [6] : [];
      return { json: { ...favoritesJson(ids), player_id: 6, changed: true } };
    });

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={ANTON} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));

    await act(async () => {
      // Five presses: on, off, on, off, on. Requests for one player are
      // serialized, so the last intent is the one that settles.
      for (let i = 0; i < 5; i += 1) fireEvent.click(screen.getByTestId("favorite-action"));
    });

    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6]"));
    expect(methods[methods.length - 1]).toBe("PUT");
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode")).toHaveTextContent("account");
  });
});

// ---------------------------------------------------------------------------
// 6. Privacy across sign-out and account switching
// ---------------------------------------------------------------------------

describe("Privacy boundary", () => {
  it("does not leave the account's favourites visible or stored after sign-out", async () => {
    const controller = createSessionController(
      makeSession({ status: "authenticated", accountKey: "acct_a" }),
    );
    installFetchRecorder(() => ({ json: favoritesJson([6, 11]) }));

    render(
      <SwitchableHarness controller={controller}>
        <Probe />
      </SwitchableHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11]"));

    await act(async () => {
      controller.set(makeSession({ status: "anonymous", accountKey: null }));
    });

    // The former account's list is neither displayed...
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[]"));
    expect(screen.getByTestId("mode")).toHaveTextContent("guest");
    // ...nor copied into anonymous browser storage.
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY) ?? "[]")).toEqual([]);
  });

  it("leaves anonymous favouriting immediately usable after sign-out", async () => {
    const controller = createSessionController(
      makeSession({ status: "authenticated", accountKey: "acct_a" }),
    );
    installFetchRecorder(() => ({ json: favoritesJson([6]) }));

    render(
      <SwitchableHarness controller={controller}>
        <FavoriteHeartButton player={JACK} />
        <Probe />
      </SwitchableHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6]"));

    await act(async () => {
      controller.set(makeSession({ status: "anonymous", accountKey: null }));
    });
    fireEvent.click(screen.getByLabelText(/Add Jack Whitmore to My Favorites/i));
    expect(screen.getByTestId("ids")).toHaveTextContent("[11]");
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([11]);
  });

  it("isolates one account's cached favourites from the next account's", async () => {
    const controller = createSessionController(
      makeSession({ status: "authenticated", accountKey: "acct_a", token: "token-a" }),
    );
    const client = makeQueryClient();
    installFetchRecorder((call: FetchCall) => ({
      json: favoritesJson(call.authorization === "Bearer token-b" ? [11] : [6]),
    }));

    render(
      <SwitchableHarness controller={controller} client={client}>
        <Probe />
      </SwitchableHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6]"));
    expect(client.getQueryData(["me", "favorites", "acct_a"])).toEqual(favoritesJson([6]));

    await act(async () => {
      controller.set(
        makeSession({ status: "authenticated", accountKey: "acct_b", token: "token-b" }),
      );
    });

    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[11]"));
    // The first account's private cache entry is gone, not merely shadowed.
    expect(client.getQueryData(["me", "favorites", "acct_a"])).toBeUndefined();
    expect(client.getQueryData(["me", "favorites", "acct_b"])).toEqual(favoritesJson([11]));
  });
});

// ---------------------------------------------------------------------------
// 7. Composition
// ---------------------------------------------------------------------------

describe("Bottom rail composition", () => {
  it("stacks the suggestion above the compare tray without either covering the other", () => {
    render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <FavoriteHeartButton player={ANTON} />
        <CompareRailButton player={ANTON} />
        <BottomRail />
      </AccountHarness>,
    );

    fireEvent.click(screen.getByLabelText(/Add Anton Keller to compare queue/i));
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));

    const rail = screen.getByTestId("bottom-rail");
    const suggestion = screen.getByTestId("account-suggestion");
    const tray = screen.getByTestId("compare-tray");

    // Siblings in one flex column: neither is positioned over the other, and the
    // suggestion comes first so the tray keeps the viewport edge it has always had.
    expect(suggestion.parentElement).toBe(rail);
    expect(tray.parentElement).toBe(rail);
    expect(Array.from(rail.children).indexOf(suggestion)).toBeLessThan(
      Array.from(rail.children).indexOf(tray),
    );
    expect(rail.className).toContain("flex-col");
    expect(rail.className).toContain("pointer-events-none");
    expect(suggestion.className).toContain("pointer-events-auto");
    expect(tray.className).toContain("pointer-events-auto");
    // The tray keeps its own "device local" wording: compare is not account-synced.
    expect(tray).toHaveTextContent("Compare queue · device local");
  });

  it("introduces no rounded geometry and no ornamental motion class", () => {
    const { container } = render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <FavoriteHeartButton player={ANTON} />
        <BottomRail />
        <NavBar />
      </AccountHarness>,
    );
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));

    const rounded = Array.from(container.querySelectorAll("*")).filter((el) => {
      const cls = el.getAttribute("class") ?? "";
      return (
        /(?:^|\s)rounded(?:-[a-z0-9[\]().%/-]+)?(?=\s|$)/.test(cls) && !cls.includes("rounded-none")
      );
    });
    expect(rounded).toEqual([]);
    // Its only motion is the tray's own entrance cadence, reused rather than reinvented.
    expect(screen.getByTestId("account-suggestion").className).toContain("callout-enter");
  });

  it("builds every account control from the shared button primitive", () => {
    render(
      <AccountHarness session={makeSession({ status: "anonymous" })}>
        <FavoriteHeartButton player={ANTON} />
        <AccountSuggestion />
        <NavBar />
      </AccountHarness>,
    );
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    for (const id of [
      "account-suggestion-create",
      "account-suggestion-signin",
      "account-suggestion-dismiss",
      "account-sign-in",
    ]) {
      // `.btn` carries the product's shared control geometry, focus treatment and
      // target size, so none of these invents its own.
      expect(screen.getByTestId(id).className).toContain("btn");
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Bounded resolution
// ---------------------------------------------------------------------------

describe("An identity provider that never answers", () => {
  it("stops withholding the count once the resolve window expires", async () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([ANTON.id]));
      render(
        <AccountHarness session={makeSession({ status: "resolving" })}>
          <NavBar />
          <Probe />
        </AccountHarness>,
      );

      // Inside the window the state is honestly unknown and no number is shown.
      expect(screen.getByTestId("mode")).toHaveTextContent("resolving");
      expect(screen.getByTestId("count")).toHaveTextContent("null");
      expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
        "My Favorites · checking your account",
      );

      act(() => {
        vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS + 1);
      });

      // Past it, the surface says the thing that is actually true: the player is
      // saved on this device. It does not sit on "checking" forever.
      expect(screen.getByTestId("mode")).toHaveTextContent("guest");
      expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
        "My Favorites 1 · saved on this device",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps favouriting usable the whole time, saving to the device", () => {
    render(
      <AccountHarness session={makeSession({ status: "resolving" })}>
        <FavoriteHeartButton player={ANTON} />
        <Probe />
      </AccountHarness>,
    );
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([6]);
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "true");
  });

  it("never offers an account while the session is still unknown", () => {
    render(
      <AccountHarness session={makeSession({ status: "resolving" })}>
        <FavoriteHeartButton player={ANTON} />
        <AccountSuggestion />
      </AccountHarness>,
    );
    fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    expect(screen.queryByTestId("account-suggestion")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Cross-account isolation of in-flight work
// ---------------------------------------------------------------------------

describe("An in-flight request that outlives its account", () => {
  /**
   * The regression: account data was cleared in an effect AFTER rendering, and
   * per-player requests carried no identity, so a response that started under
   * account A could repaint the interface once account B was on screen.
   */
  async function switchAccountsMidFlight(outcome: "success" | "failure") {
    const controller = createSessionController(
      makeSession({ status: "authenticated", accountKey: "acct_a", token: "token-a" }),
    );
    const client = makeQueryClient();
    const held = deferred<{ status?: number; json?: unknown }>();
    let heldStarted = false;

    installDeferredFetch(async (call) => {
      // Account A's own list.
      if (call.authorization === "Bearer token-a" && call.method === "GET") {
        return { json: favoritesJson([6]) };
      }
      // Account A's write: started, and deliberately not answered yet.
      if (call.authorization === "Bearer token-a") {
        heldStarted = true;
        return held.promise;
      }
      // Account B's own list, entirely separate.
      return { json: favoritesJson([11]) };
    });

    render(
      <SwitchableHarness controller={controller} client={client}>
        <FavoriteHeartButton player={JACK} />
        <NavBar />
        <Probe />
      </SwitchableHarness>,
    );

    // 1. A has loaded.
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6]"));

    // 2. Start a write for A and leave it unresolved.
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Jack Whitmore to My Favorites/i));
    });
    expect(heldStarted).toBe(true);
    expect(screen.getByTestId("mode")).toHaveTextContent("account-saving");

    // 3. Switch to B, then 4. let B load.
    await act(async () => {
      controller.set(
        makeSession({ status: "authenticated", accountKey: "acct_b", token: "token-b" }),
      );
    });
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[11]"));

    const before = {
      ids: screen.getByTestId("ids").textContent,
      count: screen.getByTestId("count").textContent,
      mode: screen.getByTestId("mode").textContent,
      error: screen.getByTestId("error").textContent,
      counter: screen.getByTestId("favorites-counter").textContent,
    };

    // 5. Release A's delayed response.
    await act(async () => {
      held.resolve(
        outcome === "success"
          ? { json: { ...favoritesJson([6, 11, 999]), player_id: 11, changed: true } }
          : { status: 500 },
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    return { before, client };
  }

  it("cannot change B's list, count, mode or error with A's delayed SUCCESS", async () => {
    const { before, client } = await switchAccountsMidFlight("success");

    // 6. Nothing about B moved.
    expect(screen.getByTestId("ids")).toHaveTextContent("[11]");
    expect(screen.getByTestId("count").textContent).toBe(before.count);
    expect(screen.getByTestId("mode").textContent).toBe(before.mode);
    expect(screen.getByTestId("error").textContent).toBe(before.error);
    expect(screen.getByTestId("favorites-counter").textContent).toBe(before.counter);
    // Nor the cache: A's namespace was dropped and was not repopulated.
    expect(client.getQueryData(["me", "favorites", "acct_a"])).toBeUndefined();
    expect(client.getQueryData(["me", "favorites", "acct_b"])).toEqual(favoritesJson([11]));
  });

  it("cannot change B's list, count, mode or error with A's delayed FAILURE", async () => {
    const { before, client } = await switchAccountsMidFlight("failure");

    expect(screen.getByTestId("ids")).toHaveTextContent("[11]");
    expect(screen.getByTestId("count").textContent).toBe(before.count);
    // A rollback for A's player must not appear on B, and B must not inherit an
    // error it never caused.
    expect(screen.getByTestId("mode")).toHaveTextContent("account");
    expect(screen.getByTestId("error").textContent).toBe("");
    expect(client.getQueryData(["me", "favorites", "acct_a"])).toBeUndefined();
  });
});

describe("Identity changes are clean", () => {
  it("never renders account A's list once the identity has changed", async () => {
    const controller = createSessionController(
      makeSession({ status: "authenticated", accountKey: "acct_a", token: "token-a" }),
    );
    const seen: string[] = [];
    installFetchRecorder((call) => ({
      json: favoritesJson(call.authorization === "Bearer token-b" ? [11] : [6]),
    }));

    function Watcher() {
      const { shortlistIds, favorites } = useScoutingState();
      // Every render is recorded, so a single transitional frame carrying the
      // wrong account's list would be caught rather than blinked past.
      seen.push(`${favorites.mode}:${JSON.stringify(shortlistIds)}`);
      return null;
    }

    render(
      <SwitchableHarness controller={controller}>
        <Watcher />
        <Probe />
      </SwitchableHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6]"));

    const afterA = seen.length;
    await act(async () => {
      controller.set(
        makeSession({ status: "authenticated", accountKey: "acct_b", token: "token-b" }),
      );
    });
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[11]"));

    const afterSwitch = seen.slice(afterA);
    expect(afterSwitch.length).toBeGreaterThan(0);
    expect(afterSwitch.filter((frame) => frame.includes("[6]"))).toEqual([]);
  });

  it("does not carry one account's token into another account's request", async () => {
    const controller = createSessionController(
      makeSession({ status: "authenticated", accountKey: "acct_a", token: "token-a" }),
    );
    const calls = installFetchRecorder((call) => ({
      json: favoritesJson(call.authorization === "Bearer token-b" ? [11] : [6]),
    }));

    render(
      <SwitchableHarness controller={controller}>
        <Probe />
      </SwitchableHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6]"));
    const beforeSwitch = calls.length;

    await act(async () => {
      controller.set(
        makeSession({ status: "authenticated", accountKey: "acct_b", token: "token-b" }),
      );
    });
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[11]"));

    const afterSwitch = calls.slice(beforeSwitch);
    expect(afterSwitch.length).toBeGreaterThan(0);
    expect(afterSwitch.every((call) => call.authorization === "Bearer token-b")).toBe(true);
  });

  it("logs no bearer token to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    try {
      installFetchRecorder(() => ({ status: 500 }));
      render(
        <AccountHarness session={makeSession({ status: "authenticated", token: "s3cret-token" })}>
          <Probe />
        </AccountHarness>,
      );
      await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account-desynced"));

      const written = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join(" ");
      expect(written).not.toContain("s3cret-token");
      expect(written).not.toContain("Bearer ");
      // The user-facing error is equally free of it.
      expect(screen.getByTestId("error").textContent).not.toContain("s3cret-token");
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Durability is never claimed before it exists
// ---------------------------------------------------------------------------

describe("Truthful account-state copy", () => {
  it("never flashes a zero while a returning account's list loads", async () => {
    const held = deferred<{ status?: number; json?: unknown }>();
    installDeferredFetch(async () => held.promise);

    const seen: string[] = [];
    function Watcher() {
      const { favorites } = useScoutingState();
      seen.push(`${favorites.mode}|${String(favorites.count)}`);
      return null;
    }

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <Watcher />
        <NavBar />
        <Probe />
      </AccountHarness>,
    );

    // While loading: no number at all, and no durability claim.
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account-loading"));
    const counter = screen.getByTestId("favorites-counter");
    expect(screen.getByTestId("count")).toHaveTextContent("null");
    expect(counter).toHaveTextContent("My Favorites · syncing with your account");
    expect(counter).not.toHaveTextContent("0");
    expect(counter).not.toHaveTextContent("saved to your account");

    await act(async () => {
      held.resolve({ json: favoritesJson([6, 11, 4]) });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
      "My Favorites 3 · saved to your account",
    );

    // Not one committed frame reported a confident zero for this account.
    expect(seen.filter((frame) => /^account(\||-saving)/.test(frame) && frame.endsWith("|0"))).toEqual(
      [],
    );
  });

  it("says Saving, not saved, while an add is pending", async () => {
    const held = deferred<{ status?: number; json?: unknown }>();
    installDeferredFetch(async (call) =>
      call.method === "GET" ? { json: favoritesJson([]) } : held.promise,
    );

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={ANTON} />
        <ScoutingLiveRegion />
        <NavBar />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    });

    // Optimistic on the control...
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "true");
    // ...but never in the durability copy.
    const counter = screen.getByTestId("favorites-counter");
    expect(screen.getByTestId("mode")).toHaveTextContent("account-saving");
    expect(counter).toHaveTextContent("My Favorites 1 · saving to your account");
    expect(counter).not.toHaveTextContent("· saved to your account");
    expect(
      screen.getByText("Anton Keller added to My Favorites. Saving to your account."),
    ).toBeInTheDocument();

    await act(async () => {
      held.resolve({ json: { ...favoritesJson([6]), player_id: 6, changed: true } });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
        "My Favorites 1 · saved to your account",
      ),
    );
  });

  it("does not claim a removal is complete while it is pending", async () => {
    const held = deferred<{ status?: number; json?: unknown }>();
    installDeferredFetch(async (call) =>
      call.method === "GET" ? { json: favoritesJson([6, 11]) } : held.promise,
    );

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={ANTON} />
        <ScoutingLiveRegion />
        <NavBar />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11]"));

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Anton Keller from My Favorites/i));
    });

    expect(screen.getByTestId("mode")).toHaveTextContent("account-saving");
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
      "My Favorites 1 · saving to your account",
    );
    expect(
      screen.getByText("Anton Keller removed from My Favorites. Updating your account."),
    ).toBeInTheDocument();

    await act(async () => {
      held.resolve({ json: { ...favoritesJson([11]), player_id: 6, changed: true } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
  });

  it("stays pending until EVERY overlapping write has settled", async () => {
    const first = deferred<{ status?: number; json?: unknown }>();
    const second = deferred<{ status?: number; json?: unknown }>();
    installDeferredFetch(async (call) => {
      if (call.method === "GET") return { json: favoritesJson([]) };
      return call.url.endsWith("/6") ? first.promise : second.promise;
    });

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={ANTON} />
        <FavoriteHeartButton player={JACK} />
        <NavBar />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
      fireEvent.click(screen.getByLabelText(/Add Jack Whitmore to My Favorites/i));
    });
    expect(screen.getByTestId("mode")).toHaveTextContent("account-saving");

    // The FIRST completion must not imply the second one landed.
    await act(async () => {
      first.resolve({ json: { ...favoritesJson([6]), player_id: 6, changed: true } });
      await Promise.resolve();
    });
    expect(screen.getByTestId("mode")).toHaveTextContent("account-saving");
    expect(screen.getByTestId("favorites-counter")).not.toHaveTextContent("· saved to your account");
    // Adopting the first canonical list must not erase the second write.
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,11]");

    await act(async () => {
      second.resolve({ json: { ...favoritesJson([6, 11]), player_id: 11, changed: true } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
      "My Favorites 2 · saved to your account",
    );
  });
});

// ---------------------------------------------------------------------------
// 11. A failed removal goes back where it was
// ---------------------------------------------------------------------------

describe("Rollback preserves canonical position", () => {
  /**
   * The regression: a failed optimistic removal restored the player by APPENDING
   * it, so a network error silently reordered a curated list. Rollback now
   * remembers the index it took the player from.
   */
  async function failedRemovalOf(target: { id: number; name: string }, list: number[]) {
    const held = deferred<{ status?: number; json?: unknown }>();
    installDeferredFetch(async (call) =>
      call.method === "GET" ? { json: favoritesJson(list) } : held.promise,
    );

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={target} />
        <FavoriteHeartButton player={{ id: 77, name: "Late Addition" }} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("ids")).toHaveTextContent(JSON.stringify(list)),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByLabelText(new RegExp(`Remove ${target.name} from My Favorites`, "i")),
      );
    });
    return held;
  }

  it("restores a player removed from the BEGINNING of the list", async () => {
    const held = await failedRemovalOf(ANTON, [6, 11, 4]);
    expect(screen.getByTestId("ids")).toHaveTextContent("[11,4]");

    await act(async () => {
      held.resolve({ status: 500 });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4]"));
    expect(screen.getByTestId("mode")).toHaveTextContent("account-desynced");
  });

  it("restores a player removed from the MIDDLE of the list", async () => {
    const held = await failedRemovalOf(JACK, [6, 11, 4]);
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,4]");

    await act(async () => {
      held.resolve({ status: 500 });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4]"));
  });

  it("restores a player removed from the END of the list", async () => {
    const held = await failedRemovalOf({ id: 4, name: "Tail Player" }, [6, 11, 4]);
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,11]");

    await act(async () => {
      held.resolve({ status: 500 });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4]"));
  });

  it("keeps an unrelated optimistic change made while the removal was pending", async () => {
    const removal = deferred<{ status?: number; json?: unknown }>();
    const addition = deferred<{ status?: number; json?: unknown }>();
    installDeferredFetch(async (call) => {
      if (call.method === "GET") return { json: favoritesJson([6, 11, 4]) };
      return call.method === "DELETE" ? removal.promise : addition.promise;
    });

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={JACK} />
        <FavoriteHeartButton player={{ id: 77, name: "Late Addition" }} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4]"));

    // Remove the middle player, then add a different one before the first
    // request answers.
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Jack Whitmore from My Favorites/i));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Late Addition to My Favorites/i));
    });
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,4,77]");

    // The removal fails. Jack returns to his own position, and the unrelated
    // addition is untouched.
    await act(async () => {
      removal.resolve({ status: 500 });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4,77]"));
    expect(
      screen.getByLabelText(/Remove Late Addition from My Favorites/i),
    ).toHaveAttribute("aria-pressed", "true");

    // And the still-pending addition keeps the surface honest about durability.
    expect(screen.getByTestId("mode")).toHaveTextContent("account-desynced");

    // A later canonical response remains the ordering authority.
    await act(async () => {
      addition.resolve({
        json: { ...favoritesJson([6, 11, 4, 77]), player_id: 77, changed: true },
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4,77]"));
  });

  it("removes only the unsuccessfully added player when an add fails", async () => {
    const held = deferred<{ status?: number; json?: unknown }>();
    installDeferredFetch(async (call) =>
      call.method === "GET" ? { json: favoritesJson([6, 11]) } : held.promise,
    );

    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={{ id: 77, name: "Late Addition" }} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11]"));

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Late Addition to My Favorites/i));
    });
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,77]");

    await act(async () => {
      held.resolve({ status: 500 });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11]"));
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "false");
  });
});

// ---------------------------------------------------------------------------
// 12. One resolution state, shared by every surface
// ---------------------------------------------------------------------------

describe("Account resolution is bounded once, for everyone", () => {
  function AllSurfaces() {
    return (
      <>
        <FavoriteHeartButton player={ANTON} />
        <AccountSuggestion />
        <NavBar />
        <Probe />
      </>
    );
  }

  it("moves every surface off Checking account when the window expires", () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([ANTON.id]));
      render(
        <AccountHarness session={makeSession({ status: "resolving" })}>
          <AllSurfaces />
        </AccountHarness>,
      );

      // Inside the window every surface agrees the answer is unknown.
      expect(screen.getByTestId("account-entry-resolving")).toBeInTheDocument();
      expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
        "My Favorites · checking your account",
      );
      expect(screen.getByTestId("count")).toHaveTextContent("null");

      act(() => {
        vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS + 1);
      });

      // Past it they still agree - and nothing is left waiting forever.
      expect(screen.queryByTestId("account-entry-resolving")).toBeNull();
      expect(screen.getByTestId("account-entry-unavailable")).toBeInTheDocument();
      expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
        "My Favorites 1 · saved on this device",
      );
      // A sign-in control that cannot open is not offered.
      expect(screen.queryByTestId("account-sign-in")).toBeNull();
      // Nor is an account suggestion that could not be acted on.
      expect(screen.queryByTestId("account-suggestion")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no account suggestion after a favourite while the provider is stalled", () => {
    vi.useFakeTimers();
    try {
      render(
        <AccountHarness session={makeSession({ status: "resolving" })}>
          <AllSurfaces />
        </AccountHarness>,
      );
      act(() => {
        vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS + 1);
      });
      // Favouriting still works, and still saves to the device.
      act(() => {
        fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
      });
      expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([6]);
      expect(screen.queryByTestId("account-suggestion")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers into the real ANONYMOUS state if the provider answers late", () => {
    vi.useFakeTimers();
    try {
      const controller = createSessionController(makeSession({ status: "resolving" }));
      render(
        <SwitchableHarness controller={controller}>
          <AllSurfaces />
        </SwitchableHarness>,
      );
      act(() => {
        vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS + 1);
      });
      expect(screen.getByTestId("account-entry-unavailable")).toBeInTheDocument();

      act(() => {
        controller.set(makeSession({ status: "anonymous" }));
      });

      // The stall latch is dropped: a real sign-in control appears, and the
      // suggestion becomes eligible again.
      expect(screen.queryByTestId("account-entry-unavailable")).toBeNull();
      expect(screen.getByTestId("account-sign-in")).toBeInTheDocument();
      expect(screen.getByTestId("mode")).toHaveTextContent("guest");

      act(() => {
        fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
      });
      expect(screen.getByTestId("account-suggestion")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers into the real AUTHENTICATED state if the provider answers late", async () => {
    const controller = createSessionController(makeSession({ status: "resolving" }));
    vi.useFakeTimers();
    try {
      window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([6]));
      installFetchRecorder(() => ({ json: mergeJson([6], [6]) }));
      render(
        <SwitchableHarness controller={controller}>
          <AllSurfaces />
        </SwitchableHarness>,
      );
      act(() => {
        vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS + 1);
      });
      expect(screen.getByTestId("account-entry-unavailable")).toBeInTheDocument();

      act(() => {
        controller.set(makeSession({ status: "authenticated", accountKey: "acct_late" }));
      });
      expect(screen.queryByTestId("account-entry-unavailable")).toBeNull();
      expect(screen.getByTestId("account-entry-authenticated")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }

    // The normal merge/load flow runs from there, on real timers.
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
    expect(screen.getByTestId("ids")).toHaveTextContent("[6]");
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([]);
  });

  it("arms no timer at all, and shows no account UI, when auth is disabled", () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      render(
        <ScoutingStateProvider>
          <AllSurfaces />
        </ScoutingStateProvider>,
      );

      act(() => {
        vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS * 10);
      });

      expect(screen.queryByTestId("account-entry-resolving")).toBeNull();
      expect(screen.queryByTestId("account-entry-unavailable")).toBeNull();
      expect(screen.queryByTestId("account-sign-in")).toBeNull();
      expect(screen.queryByTestId("account-suggestion")).toBeNull();
      expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
        "My Favorites 0 · saved on this device",
      );
      // No private request was ever made.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// 13. The last thing the user asked for is the thing that happens
// ---------------------------------------------------------------------------

describe("Intent changed while a request was already in flight", () => {
  /**
   * The regression: a completing request deleted whatever intent it found,
   * including a NEWER one the user had just expressed. The queued follow-up then
   * found nothing to do and exited, so the user's last action was silently
   * dropped. Intents now carry a revision, and a request may only retire the one
   * it started for.
   *
   * These are deliberately NOT several synchronous clicks: the second click
   * happens after the first request has provably started.
   */
  function heldWrites(initial: number[]) {
    const started: Array<{ method: string; release: (v: { status?: number; json?: unknown }) => void }> = [];
    const seen: string[] = [];
    let live: number[] = [...initial];

    installDeferredFetch(async (call) => {
      if (call.method === "GET") return { json: favoritesJson(initial) };
      seen.push(call.method);
      const gate = deferred<{ status?: number; json?: unknown }>();
      started.push({
        method: call.method,
        release: (value) => {
          if (call.method === "PUT") live = live.includes(6) ? live : [...live, 6];
          else live = live.filter((id) => id !== 6);
          gate.resolve(
            value.status
              ? value
              : { json: { ...favoritesJson(live), player_id: 6, changed: true } },
          );
        },
      });
      return gate.promise;
    });
    return { started, seen };
  }

  async function renderAndSettle(initial: number[]) {
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={ANTON} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("ids")).toHaveTextContent(JSON.stringify(initial)),
    );
  }

  it("Add then Remove: the removal is sent and wins", async () => {
    const { started, seen } = heldWrites([]);
    await renderAndSettle([]);

    // First click: the PUT starts and is held open.
    await act(async () => {
      fireEvent.click(screen.getByTestId("favorite-action"));
    });
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0].method).toBe("PUT");
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "true");

    // Second click, AFTER the request began: the user now wants it removed.
    await act(async () => {
      fireEvent.click(screen.getByTestId("favorite-action"));
    });
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "false");

    // Release the add. It must not retire the newer removal intent.
    await act(async () => {
      started[0].release({});
      await Promise.resolve();
      await Promise.resolve();
    });

    // The follow-up DELETE is actually issued...
    await waitFor(() => expect(started).toHaveLength(2));
    expect(started[1].method).toBe("DELETE");
    await act(async () => {
      started[1].release({});
      await Promise.resolve();
    });

    // ...and both the UI and the server state reflect the LAST action.
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
    expect(screen.getByTestId("ids")).toHaveTextContent("[]");
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "false");
    expect(seen).toEqual(["PUT", "DELETE"]);
  });

  it("Remove then Add: the addition is sent and wins", async () => {
    const { started, seen } = heldWrites([6]);
    await renderAndSettle([6]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("favorite-action"));
    });
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0].method).toBe("DELETE");

    await act(async () => {
      fireEvent.click(screen.getByTestId("favorite-action"));
    });
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      started[0].release({});
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(started).toHaveLength(2));
    expect(started[1].method).toBe("PUT");
    await act(async () => {
      started[1].release({});
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
    expect(screen.getByTestId("ids")).toHaveTextContent("[6]");
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "true");
    expect(seen).toEqual(["DELETE", "PUT"]);
  });

  it("never overlaps two requests for the same player", async () => {
    const { started } = heldWrites([]);
    await renderAndSettle([]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("favorite-action"));
    });
    await waitFor(() => expect(started).toHaveLength(1));

    // Three further presses while the first request is still open: on -> off ->
    // on -> off, so the settled intent is "not favourited".
    await act(async () => {
      fireEvent.click(screen.getByTestId("favorite-action"));
      fireEvent.click(screen.getByTestId("favorite-action"));
      fireEvent.click(screen.getByTestId("favorite-action"));
    });
    // The first request is still open, so nothing else may be in flight.
    expect(started).toHaveLength(1);
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      started[0].release({});
      await Promise.resolve();
      await Promise.resolve();
    });
    // Exactly ONE follow-up, reconciling the final intent - not one per press.
    await waitFor(() => expect(started).toHaveLength(2));
    expect(started[1].method).toBe("DELETE");
    await act(async () => {
      started[1].release({});
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
    expect(started).toHaveLength(2);
    expect(screen.getByTestId("ids")).toHaveTextContent("[]");
    expect(screen.getByTestId("favorite-action")).toHaveAttribute("aria-pressed", "false");
  });

  it("reconciles rather than rolling back when a FAILED write was superseded", async () => {
    const { started } = heldWrites([]);
    await renderAndSettle([]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("favorite-action"));
    });
    await waitFor(() => expect(started).toHaveLength(1));
    // The user changes their mind, then the original add fails.
    await act(async () => {
      fireEvent.click(screen.getByTestId("favorite-action"));
    });
    await act(async () => {
      started[0].release({ status: 500 });
      await Promise.resolve();
      await Promise.resolve();
    });

    // No error is reported for an action the user already replaced...
    await waitFor(() => expect(started).toHaveLength(2));
    expect(started[1].method).toBe("DELETE");
    await act(async () => {
      started[1].release({});
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
    expect(screen.getByTestId("error").textContent).toBe("");
    expect(screen.getByTestId("ids")).toHaveTextContent("[]");
  });
});

// ---------------------------------------------------------------------------
// 14. An unconfirmed merge keeps the device as the system of record
// ---------------------------------------------------------------------------

describe("Favouriting while a guest merge is still unconfirmed", () => {
  /**
   * The regression: these edits went to the individual account endpoints. The
   * first success then adopted the server's canonical list as the visible one
   * while `localStorage` still held the pre-merge snapshot - so the account
   * appeared to hold players it had never been given, and signing out exposed a
   * stale list rather than the one just edited.
   */
  function failingMerge(onCall?: (n: number) => { status?: number; json?: unknown } | undefined) {
    let n = 0;
    return installFetchRecorder((call) => {
      if (call.url.endsWith("/merge")) {
        n += 1;
        return onCall?.(n) ?? { status: 503 };
      }
      // Any individual write reaching the network here is the defect itself.
      return { status: 500 };
    });
  }

  async function unconfirmed(initial: number[]) {
    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify(initial));
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={ANTON} />
        <FavoriteHeartButton player={JACK} />
        <NavBar />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("mode")).toHaveTextContent("account-unconfirmed"),
    );
  }

  it("adds device-locally, with no individual account request", async () => {
    const calls = failingMerge();
    await unconfirmed([JACK.id]);
    const beforeCalls = calls.length;

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    });

    // Visible, counted, stored, and still unconfirmed.
    expect(screen.getByTestId("ids")).toHaveTextContent("[11,6]");
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([11, 6]);
    expect(screen.getByTestId("mode")).toHaveTextContent("account-unconfirmed");
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
      "My Favorites 2 · saved on this device, not in your account yet",
    );
    // No PUT/DELETE was issued while the merge is still owed.
    expect(calls.length).toBe(beforeCalls);
  });

  it("removes device-locally, with no individual account request", async () => {
    const calls = failingMerge();
    await unconfirmed([JACK.id, ANTON.id]);
    const beforeCalls = calls.length;

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Jack Whitmore from My Favorites/i));
    });

    expect(screen.getByTestId("ids")).toHaveTextContent("[6]");
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([6]);
    expect(calls.length).toBe(beforeCalls);
    // The control is never disabled: favouriting stays fully available.
    expect(screen.getByLabelText(/Add Jack Whitmore to My Favorites/i)).toBeEnabled();
  });

  it("exposes the LATEST device list after signing out", async () => {
    const controller = createSessionController(
      makeSession({ status: "authenticated", accountKey: "acct_unconf" }),
    );
    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([JACK.id]));
    installFetchRecorder((call) => (call.url.endsWith("/merge") ? { status: 503 } : { status: 500 }));

    render(
      <SwitchableHarness controller={controller}>
        <FavoriteHeartButton player={ANTON} />
        <Probe />
      </SwitchableHarness>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("mode")).toHaveTextContent("account-unconfirmed"),
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    });
    expect(screen.getByTestId("ids")).toHaveTextContent("[11,6]");

    await act(async () => {
      controller.set(makeSession({ status: "anonymous", accountKey: null }));
    });

    // The edited list, not the snapshot the session began with.
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("guest"));
    expect(screen.getByTestId("ids")).toHaveTextContent("[11,6]");
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([11, 6]);
  });

  it("retries with the LATEST edited list, and only then retires the device copy", async () => {
    const calls = failingMerge((n) =>
      n === 1 ? { status: 503 } : { json: mergeJson([11, 6], [11, 6]) },
    );
    await unconfirmed([JACK.id]);

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    });
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([11, 6]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("retry"));
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));

    // The retry sent the edited list, not the original snapshot.
    const merges = calls.filter((c: FetchCall) => c.url.endsWith("/merge"));
    expect(merges).toHaveLength(2);
    expect(merges[0].body).toEqual({ player_ids: [11] });
    expect(merges[1].body).toEqual({ player_ids: [11, 6] });
    // Only a complete success retires the device copy.
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([]);
    expect(screen.getByTestId("ids")).toHaveTextContent("[11,6]");
    expect(screen.getByTestId("favorites-counter")).toHaveTextContent(
      "My Favorites 2 · saved to your account",
    );
  });

  it("keeps editing and never loses the list through repeated retry failures", async () => {
    const calls = failingMerge(() => ({ status: 503 }));
    await unconfirmed([JACK.id]);

    // Edit, retry, fail. Twice, with a further edit in between.
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Anton Keller to My Favorites/i));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("retry"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("mode")).toHaveTextContent("account-unconfirmed"),
    );
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([11, 6]);

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Jack Whitmore from My Favorites/i));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("retry"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("mode")).toHaveTextContent("account-unconfirmed"),
    );

    // Still visible, still stored, still retryable, and each retry carried the
    // list as it stood at that moment.
    expect(screen.getByTestId("ids")).toHaveTextContent("[6]");
    expect(JSON.parse(window.localStorage.getItem(SHORTLIST_KEY)!)).toEqual([6]);
    expect(screen.getByTestId("error").textContent).not.toBe("");
    const bodies = calls
      .filter((c: FetchCall) => c.url.endsWith("/merge"))
      .map((c: FetchCall) => c.body);
    expect(bodies).toEqual([
      { player_ids: [11] },
      { player_ids: [11, 6] },
      { player_ids: [6] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 15. Session generations never repeat
// ---------------------------------------------------------------------------

describe("Signing back into the SAME account", () => {
  it("ignores a request left over from the previous login", async () => {
    /**
     * The regression: the generation token was `${accountKey}#${attempt}`. Sign
     * out and back into the same account and both parts repeated, so a response
     * belonging to the first login matched the second login's token and was
     * allowed to mutate it. The epoch is now monotonic and never reset, so a
     * generation value cannot recur for the life of the page.
     */
    const controller = createSessionController(
      makeSession({ status: "authenticated", accountKey: "acct_same", token: "token-1" }),
    );
    const client = makeQueryClient();
    const held = deferred<{ status?: number; json?: unknown }>();
    let heldStarted = false;

    installDeferredFetch(async (call) => {
      if (call.method === "GET") return { json: favoritesJson([6]) };
      heldStarted = true;
      return held.promise;
    });

    render(
      <SwitchableHarness controller={controller} client={client}>
        <FavoriteHeartButton player={JACK} />
        <NavBar />
        <Probe />
      </SwitchableHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6]"));

    // Start a write in the FIRST login and leave it unresolved.
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Jack Whitmore to My Favorites/i));
    });
    expect(heldStarted).toBe(true);

    // Sign out...
    await act(async () => {
      controller.set(makeSession({ status: "anonymous", accountKey: null }));
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("guest"));

    // ...and back in to the SAME account.
    await act(async () => {
      controller.set(
        makeSession({ status: "authenticated", accountKey: "acct_same", token: "token-2" }),
      );
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));
    expect(screen.getByTestId("ids")).toHaveTextContent("[6]");

    const before = {
      ids: screen.getByTestId("ids").textContent,
      mode: screen.getByTestId("mode").textContent,
      count: screen.getByTestId("count").textContent,
      error: screen.getByTestId("error").textContent,
      counter: screen.getByTestId("favorites-counter").textContent,
    };

    // Release the first login's write. It must have no effect whatsoever.
    await act(async () => {
      held.resolve({ json: { ...favoritesJson([6, 11]), player_id: 11, changed: true } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("ids").textContent).toBe(before.ids);
    expect(screen.getByTestId("mode").textContent).toBe(before.mode);
    expect(screen.getByTestId("count").textContent).toBe(before.count);
    expect(screen.getByTestId("error").textContent).toBe(before.error);
    expect(screen.getByTestId("favorites-counter").textContent).toBe(before.counter);
    // The stale response did not repopulate the private cache either.
    expect(client.getQueryData(["me", "favorites", "acct_same"])).toEqual(favoritesJson([6]));
  });

  it("ignores a FAILED request left over from the previous login", async () => {
    const controller = createSessionController(
      makeSession({ status: "authenticated", accountKey: "acct_same2", token: "token-1" }),
    );
    const held = deferred<{ status?: number; json?: unknown }>();
    installDeferredFetch(async (call) =>
      call.method === "GET" ? { json: favoritesJson([6]) } : held.promise,
    );

    render(
      <SwitchableHarness controller={controller}>
        <FavoriteHeartButton player={ANTON} />
        <Probe />
      </SwitchableHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6]"));
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Anton Keller from My Favorites/i));
    });

    await act(async () => {
      controller.set(makeSession({ status: "anonymous", accountKey: null }));
    });
    await act(async () => {
      controller.set(
        makeSession({ status: "authenticated", accountKey: "acct_same2", token: "token-2" }),
      );
    });
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("account"));

    await act(async () => {
      held.resolve({ status: 500 });
      await Promise.resolve();
      await Promise.resolve();
    });

    // No rollback, no error copy, no desync from a session that has ended.
    expect(screen.getByTestId("ids")).toHaveTextContent("[6]");
    expect(screen.getByTestId("mode")).toHaveTextContent("account");
    expect(screen.getByTestId("error").textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 16. Rollback ordering survives unrelated edits
// ---------------------------------------------------------------------------

describe("Rollback ordering uses neighbours, not indices", () => {
  /**
   * The regression: rollback recorded an absolute index. Remove B from [A, B, C],
   * then remove A while B's request is in flight, and index 1 now points AFTER C,
   * so a failed B came back in the wrong place. Anchors describe a relation
   * ("before C") that survives anything happening in front of it.
   */
  const A = { id: 6, name: "Anton Keller" };
  const B = { id: 11, name: "Jack Whitmore" };
  const C = { id: 4, name: "Tail Player" };

  function heldPerPlayer(initial: number[]) {
    const gates = new Map<string, Deferred<{ status?: number; json?: unknown }>>();
    installDeferredFetch(async (call) => {
      if (call.method === "GET") return { json: favoritesJson(initial) };
      const key = `${call.method}:${call.url.split("/").pop()}`;
      const gate = deferred<{ status?: number; json?: unknown }>();
      gates.set(key, gate);
      return gate.promise;
    });
    return gates;
  }

  it("restores B before C when A was removed while B was pending", async () => {
    const gates = heldPerPlayer([A.id, B.id, C.id]);
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={A} />
        <FavoriteHeartButton player={B} />
        <FavoriteHeartButton player={C} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4]"));

    // Remove B and hold its request.
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Jack Whitmore from My Favorites/i));
    });
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,4]");
    await waitFor(() => expect(gates.has("DELETE:11")).toBe(true));

    // Remove A while B is still pending. B's old index is now meaningless.
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Anton Keller from My Favorites/i));
    });
    expect(screen.getByTestId("ids")).toHaveTextContent("[4]");

    // B fails.
    await act(async () => {
      gates.get("DELETE:11")!.resolve({ status: 500 });
      await Promise.resolve();
      await Promise.resolve();
    });

    // B is ahead of C, exactly as the scout left it - not appended after it.
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[11,4]"));
    expect(screen.getByTestId("mode")).toHaveTextContent("account-desynced");
    // No duplicate was introduced.
    const ids = JSON.parse(screen.getByTestId("ids").textContent!) as number[];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to the previous neighbour when the next one has gone", async () => {
    const gates = heldPerPlayer([A.id, B.id, C.id]);
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={B} />
        <FavoriteHeartButton player={C} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4]"));

    // Remove B (anchors: previous A, next C), then remove C while B is pending.
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Jack Whitmore from My Favorites/i));
    });
    await waitFor(() => expect(gates.has("DELETE:11")).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Tail Player from My Favorites/i));
    });
    expect(screen.getByTestId("ids")).toHaveTextContent("[6]");

    await act(async () => {
      gates.get("DELETE:11")!.resolve({ status: 500 });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Next neighbour gone, so B lands after its surviving previous neighbour.
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11]"));
  });

  it("appends when neither neighbour survives, without duplicating", async () => {
    const gates = heldPerPlayer([A.id, B.id, C.id]);
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={A} />
        <FavoriteHeartButton player={B} />
        <FavoriteHeartButton player={C} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4]"));

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Jack Whitmore from My Favorites/i));
    });
    await waitFor(() => expect(gates.has("DELETE:11")).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Anton Keller from My Favorites/i));
      fireEvent.click(screen.getByLabelText(/Remove Tail Player from My Favorites/i));
    });
    expect(screen.getByTestId("ids")).toHaveTextContent("[]");

    await act(async () => {
      gates.get("DELETE:11")!.resolve({ status: 500 });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[11]"));
    const ids = JSON.parse(screen.getByTestId("ids").textContent!) as number[];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("preserves an unrelated tail addition made while the removal was pending", async () => {
    const gates = heldPerPlayer([A.id, B.id, C.id]);
    render(
      <AccountHarness session={makeSession({ status: "authenticated" })}>
        <FavoriteHeartButton player={B} />
        <FavoriteHeartButton player={{ id: 77, name: "Late Addition" }} />
        <Probe />
      </AccountHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4]"));

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Remove Jack Whitmore from My Favorites/i));
    });
    await waitFor(() => expect(gates.has("DELETE:11")).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Add Late Addition to My Favorites/i));
    });
    expect(screen.getByTestId("ids")).toHaveTextContent("[6,4,77]");

    await act(async () => {
      gates.get("DELETE:11")!.resolve({ status: 500 });
      await Promise.resolve();
      await Promise.resolve();
    });

    // B back before C; the unrelated addition untouched at the tail.
    await waitFor(() => expect(screen.getByTestId("ids")).toHaveTextContent("[6,11,4,77]"));
  });
});
