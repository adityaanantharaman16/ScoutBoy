"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ApiError } from "@/lib/api/client";
import {
  addFavorite as addFavoriteRequest,
  getFavorites,
  mergeFavorites,
  removeFavorite as removeFavoriteRequest,
} from "@/lib/api/favorites";
import { clearDismissal } from "@/lib/auth/suggestion-state";
import { useAuthSession, type EffectiveAuthSession } from "@/lib/auth/session";

const SHORTLIST_KEY = "scoutboy.shortlist.v1";
const COMPARE_KEY = "scoutboy.compareQueue.v1";
const MAX_COMPARE = 2;

export interface PlayerRef {
  id: number;
  name: string;
}

/**
 * Where My Favorites currently lives, and how sure we are about it.
 *
 * Six states, because there are six different truths, and collapsing any two of
 * them produces a lie on screen. Copy is derived from this value (see
 * `favoritesScopeLabel`), which is what stops the product claiming "saved to
 * your account" while a write is in flight, or reporting a confident zero for an
 * account whose list has not arrived yet.
 */
export type FavoritesMode =
  /** Anonymous, or no provider, or a provider that never answered. Device-local. */
  | "guest"
  /** A provider exists and has not yet said whether anyone is signed in. */
  | "resolving"
  /** Signed in; the first canonical list has not arrived (or is being merged). */
  | "account-loading"
  /** Signed in; the visible list IS the server's canonical list. */
  | "account"
  /** Signed in and canonical, with at least one write still in flight. */
  | "account-saving"
  /**
   * Signed in, but the visible list is the RETAINED device list: a merge failed,
   * so those players are still on this device and are not in the account yet.
   */
  | "account-unconfirmed"
  /** Signed in with a known list, and the last operation failed. Retryable. */
  | "account-desynced";

export interface FavoritesState {
  mode: FavoritesMode;
  /** Whether this build offers accounts at all. */
  accountsAvailable: boolean;
  /**
   * `null` whenever the real number is genuinely unknown: the session has not
   * resolved, or it has and the account's list has not arrived.
   *
   * Reporting 0 in either case would show a returning account holder
   * "My Favorites 0 · saved to your account" before their real list appeared -
   * a confident claim about an empty account that is not empty.
   */
  count: number | null;
  /** Human-readable reason the account list could not be synchronized. */
  syncError: string | null;
  /** Re-attempts whichever account operation failed. */
  retrySync: () => void;
  /**
   * Increments when, and only when, a GUEST successfully saved a player they had
   * not saved before. It is the sole trigger for the account suggestion, which is
   * why removals, hydration, reloads and account-mode saves cannot raise it.
   */
  guestSaveSignal: number;
}

interface ScoutingState {
  shortlistIds: number[];
  compareQueue: PlayerRef[];
  notice: string;
  isShortlisted: (id: number) => boolean;
  toggleShortlist: (player: PlayerRef) => void;
  /** `name` is optional so existing callers are unchanged; it only improves copy. */
  removeShortlist: (id: number, name?: string) => void;
  isQueuedForCompare: (id: number) => boolean;
  toggleCompare: (player: PlayerRef) => void;
  removeCompare: (id: number) => void;
  clearCompare: () => void;
  favorites: FavoritesState;
}

const ScoutingContext = createContext<ScoutingState | null>(null);

function readNumberList(key: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => Number.isInteger(id) && id > 0)
      : [];
  } catch {
    return [];
  }
}

function readPlayerRefs(key: string): PlayerRef[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((p) => p && Number.isInteger(p.id) && typeof p.name === "string")
          .slice(0, MAX_COMPARE)
      : [];
  } catch {
    return [];
  }
}

/**
 * The scope phrase every surface appends to a My Favorites count.
 *
 * Every branch is a claim about durability, so each one has to be true at the
 * moment it is shown. "saved to your account" appears only when the server has
 * confirmed the list and nothing is in flight.
 */
export function favoritesScopeLabel(mode: FavoritesMode): string {
  switch (mode) {
    case "account":
      return "saved to your account";
    case "account-saving":
      return "saving to your account";
    case "account-loading":
      return "syncing with your account";
    case "account-unconfirmed":
      return "saved on this device, not in your account yet";
    case "account-desynced":
      return "not saved to your account yet";
    case "resolving":
      return "checking your account";
    default:
      return "saved on this device";
  }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** The polite live region's message, with the same 2.2s hold it has always had. */
function useNotice() {
  const [notice, setNotice] = useState("");
  const speak = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? "" : current)), 2200);
  }, []);
  return { notice, speak };
}

/**
 * The comparison queue. Unchanged by Milestone 8.4A and deliberately so: compare
 * stays device-local, its tray keeps saying "device local", and nothing here is
 * account-synchronized.
 */
function useCompareQueue(mounted: boolean, speak: (message: string) => void) {
  const [compareQueue, setCompareQueue] = useState<PlayerRef[]>([]);

  useEffect(() => {
    if (mounted) window.localStorage.setItem(COMPARE_KEY, JSON.stringify(compareQueue));
  }, [mounted, compareQueue]);

  const isQueuedForCompare = useCallback(
    (id: number) => compareQueue.some((p) => p.id === id),
    [compareQueue],
  );

  const toggleCompare = useCallback(
    (player: PlayerRef) => {
      setCompareQueue((queue) => {
        if (queue.some((p) => p.id === player.id)) {
          speak(`${player.name} removed from compare queue.`);
          return queue.filter((p) => p.id !== player.id);
        }
        const next = queue.length >= MAX_COMPARE ? [queue[1], player] : [...queue, player];
        speak(
          queue.length >= MAX_COMPARE
            ? `${player.name} replaced the oldest compare selection.`
            : `${player.name} added to compare queue.`,
        );
        return next;
      });
    },
    [speak],
  );

  const removeCompare = useCallback(
    (id: number) => {
      setCompareQueue((queue) => queue.filter((p) => p.id !== id));
      speak("Player removed from compare queue.");
    },
    [speak],
  );

  const clearCompare = useCallback(() => {
    setCompareQueue([]);
    speak("Compare queue cleared.");
  }, [speak]);

  // Memoized so the context value below is not rebuilt on every render.
  return useMemo(
    () => ({
      compareQueue,
      setCompareQueue,
      isQueuedForCompare,
      toggleCompare,
      removeCompare,
      clearCompare,
    }),
    [compareQueue, isQueuedForCompare, toggleCompare, removeCompare, clearCompare],
  );
}

/** The browser-local favourites list: exactly the Milestone 7/8 behaviour. */
function useGuestFavorites(mounted: boolean) {
  const [guestIds, setGuestIds] = useState<number[]>([]);

  useEffect(() => {
    if (mounted) window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify(guestIds));
  }, [mounted, guestIds]);

  return { guestIds, setGuestIds };
}

// ---------------------------------------------------------------------------
// Guest-only provider
// ---------------------------------------------------------------------------

/**
 * The provider used when this build has no identity provider.
 *
 * Byte-for-byte the pre-8.4A behaviour: synchronous toggles, one localStorage
 * write per change, the same announcements, and no network, timer or account
 * concept anywhere in the path.
 */
function GuestScoutingProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const { notice, speak } = useNotice();
  const { guestIds, setGuestIds } = useGuestFavorites(mounted);
  const compare = useCompareQueue(mounted, speak);
  const [guestSaveSignal, setGuestSaveSignal] = useState(0);
  const { setCompareQueue } = compare;

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect --
     * Browser storage must hydrate after mount to keep the server and initial
     * client render deterministic. */
    setMounted(true);
    setGuestIds(readNumberList(SHORTLIST_KEY));
    setCompareQueue(readPlayerRefs(COMPARE_KEY));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [setGuestIds, setCompareQueue]);

  const isShortlisted = useCallback((id: number) => guestIds.includes(id), [guestIds]);

  const toggleShortlist = useCallback(
    (player: PlayerRef) => {
      // The add/remove decision is taken from committed state rather than from
      // inside the updater, so the announcement, the storage write and the
      // suggestion signal can never disagree about which one just happened.
      if (guestIds.includes(player.id)) {
        setGuestIds((ids) => ids.filter((id) => id !== player.id));
        speak(`${player.name} removed from shortlist. Saved on this device.`);
        return;
      }
      setGuestIds((ids) => (ids.includes(player.id) ? ids : [...ids, player.id]));
      speak(`${player.name} added to shortlist. Saved on this device.`);
      // Raised AFTER the save, never before it, and only for a new one.
      setGuestSaveSignal((n) => n + 1);
    },
    [guestIds, speak, setGuestIds],
  );

  const removeShortlist = useCallback(
    (id: number) => {
      setGuestIds((ids) => ids.filter((item) => item !== id));
      speak("Player removed from shortlist. Saved on this device.");
    },
    [speak, setGuestIds],
  );

  const favorites = useMemo<FavoritesState>(
    () => ({
      mode: "guest",
      accountsAvailable: false,
      count: guestIds.length,
      syncError: null,
      retrySync: () => {},
      guestSaveSignal,
    }),
    [guestIds.length, guestSaveSignal],
  );

  return (
    <Provided
      shortlistIds={guestIds}
      isShortlisted={isShortlisted}
      toggleShortlist={toggleShortlist}
      removeShortlist={removeShortlist}
      notice={notice}
      favorites={favorites}
      compare={compare}
    >
      {children}
    </Provided>
  );
}

// ---------------------------------------------------------------------------
// Account-aware provider
// ---------------------------------------------------------------------------

/**
 * Account favourites, stamped with the identity they belong to.
 *
 * `accountKey` and `token` are part of the state rather than checked beside it.
 * That is the whole defence against cross-account bleed: a render filters on
 * `accountKey`, so account A's list is structurally unable to appear under
 * account B even for one transitional frame, and every asynchronous update
 * compares `token` before mutating anything, so a response that started under A
 * cannot land on B's screen however late it arrives.
 */
interface AccountFavorites {
  accountKey: string;
  /** `${accountKey}#${attempt}`. Changes on account change AND on retry. */
  token: string;
  /**
   * `null` means "no trustworthy list yet". It is never rendered as a confident
   * zero, because an account whose list has not arrived is not an empty account.
   */
  ids: number[] | null;
  /**
   * What `ids` actually IS, so copy can describe it without guessing.
   *
   * `server` = the canonical account list. `device` = the retained device list a
   * failed merge left on screen. `unknown` = no list yet, which is distinct from
   * both: it is why a failed LOAD reads as "could not be loaded" while a failed
   * MERGE reads as "still on this device".
   */
  origin: "server" | "device" | "unknown";
  /** The initial load or merge is in flight. */
  loading: boolean;
  /** Player ids with a write in flight. Non-empty means "not saved yet". */
  pending: number[];
  /** Player ids whose last write failed. Empty means there is nothing to retry. */
  failed: number[];
  error: string | null;
}

/**
 * One player's outstanding intent.
 *
 * `revision` is the whole point. A request captures the revision it was started
 * for; when it settles it may only retire that intent if the revision is still
 * the one on the books. Without it, a completing request unconditionally deleted
 * whatever intent it found - including a NEWER one the user had just expressed -
 * and the follow-up reconciliation then found nothing to do and exited. The last
 * thing the user asked for was silently dropped, on both Add->Remove and
 * Remove->Add.
 */
interface PlayerIntent {
  want: boolean;
  revision: number;
  /**
   * Where the player sat when it was optimistically removed, recorded as its
   * NEIGHBOURS rather than an index.
   *
   * An absolute index goes stale the moment anything before it moves: remove B
   * from [A, B, C], then remove A while B's request is in flight, and index 1
   * now points after C. Anchors survive that, because they describe a relation
   * ("before C") rather than a position.
   */
  anchors?: { previous: number | null; next: number | null };
}

/** Per-generation write bookkeeping. Discarded whenever the session generation changes. */
interface WriteBook {
  token: string;
  /** The authoritative intent per player, so rapid toggles settle on the last one. */
  intents: Map<number, PlayerIntent>;
  /** One promise chain per player, so two writes for one player never overlap. */
  chains: Map<number, Promise<void>>;
  /** Monotonic within this book; never reused, so a stale revision cannot match. */
  nextRevision: number;
}

const NO_IDS: number[] = [];

/**
 * Restores `id` to its place using the neighbours it had when it was removed.
 *
 * Before the nearest surviving NEXT neighbour if there is one, otherwise after
 * the nearest surviving PREVIOUS neighbour, otherwise appended. That ordering of
 * preference matters: "before C" keeps a player ahead of the thing it used to be
 * ahead of even when everything behind it has gone, which is the relation a
 * scout actually remembers about their own list.
 *
 * Never duplicates: an id already present is left exactly where it is.
 */
function restoreWithAnchors(
  ids: number[],
  id: number,
  anchors: { previous: number | null; next: number | null } | undefined,
): number[] {
  if (ids.includes(id)) return ids;
  if (anchors) {
    if (anchors.next !== null) {
      const at = ids.indexOf(anchors.next);
      if (at !== -1) return [...ids.slice(0, at), id, ...ids.slice(at)];
    }
    if (anchors.previous !== null) {
      const at = ids.indexOf(anchors.previous);
      if (at !== -1) return [...ids.slice(0, at + 1), id, ...ids.slice(at + 1)];
    }
  }
  return [...ids, id];
}

/**
 * Replays still-in-flight intents on top of a canonical list.
 *
 * The server's answer is the ordering authority, but it only knows about the ONE
 * write it just handled. Adopting it verbatim while a second write is still in
 * flight would visibly undo that second write - so the first completion of two
 * concurrent adds must not erase the other.
 */
function applyIntents(base: number[], intents: Map<number, PlayerIntent>): number[] {
  let out = base;
  for (const [id, intent] of intents) {
    const has = out.includes(id);
    if (intent.want && !has) out = [...out, id];
    else if (!intent.want && has) out = out.filter((other) => other !== id);
  }
  return out;
}

function withoutId(ids: number[], id: number): number[] {
  return ids.filter((other) => other !== id);
}

/**
 * The provider used when this build offers accounts.
 *
 * It is a superset, not a replacement: while nobody is signed in, every path
 * below is the guest path above, with the same storage key, the same
 * announcements and no network traffic. Only an authenticated session engages
 * the server.
 */
function AccountScoutingProvider({
  session,
  children,
}: {
  session: EffectiveAuthSession;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const { notice, speak } = useNotice();
  const { guestIds, setGuestIds } = useGuestFavorites(mounted);
  const compare = useCompareQueue(mounted, speak);
  const [guestSaveSignal, setGuestSaveSignal] = useState(0);
  const { setCompareQueue } = compare;

  const queryClient = useQueryClient();
  const [account, setAccount] = useState<AccountFavorites | null>(null);
  const [attempt, setAttempt] = useState(0);

  // ONE resolution state, owned by the session provider and shared with the
  // navigation entry and the account suggestion. No second timer here.
  const status = session.effectiveStatus;
  const authenticated = status === "authenticated";
  const resolving = status === "resolving";
  const accountKey = authenticated ? session.accountKey : null;

  // -- Session generation ---------------------------------------------------
  //
  // A token of `${accountKey}#${attempt}` was NOT unique enough. Sign out and
  // sign back into the same account and both parts repeat, so a response left
  // over from the previous session matched the new one's token and was allowed to
  // land on it. The epoch fixes that by being monotonic and never reset: it
  // advances on every authentication lifecycle transition - anonymous to
  // account, account to anonymous, account A to account B, and sign-out then
  // sign-in to the SAME account, which passes through two of them. A generation
  // value is therefore never reused for the lifetime of the page, so a stale
  // response can never find a token to match.
  const identity = `${status}:${accountKey ?? ""}`;
  const [epoch, setEpoch] = useState(0);
  const [lastIdentity, setLastIdentity] = useState(identity);
  // Adjusted during render, the pattern `usePresence` established: the new
  // generation exists in the same pass that observed the transition, so no
  // effect-ordering window is left for a departing session's work to slip
  // through.
  if (lastIdentity !== identity) {
    setLastIdentity(identity);
    setEpoch((n) => n + 1);
  }
  const token = accountKey === null ? null : `${accountKey}#e${epoch}#a${attempt}`;

  /**
   * The token asynchronous work is judged against.
   *
   * Declared FIRST so its sync effect runs before the cache-partitioning and
   * loader effects below on the same commit, and so any response that arrives
   * afterwards is measured against the identity now on screen.
   *
   * It is not the only guard, and deliberately so: the render filter just below
   * is what makes a cross-account render impossible, and `applyIfCurrent`
   * additionally re-checks the state's OWN token so a response cannot land on a
   * state a retry has already replaced. Three cheap checks, because each covers
   * a window the others do not.
   */
  const liveToken = useRef<string | null>(null);
  useEffect(() => {
    liveToken.current = token;
  }, [token]);

  /**
   * Only state belonging to the account on screen is allowed to render.
   *
   * This is the structural fix for cross-account bleed: it is evaluated during
   * render from the state's own stamp, so account A's list cannot appear under
   * account B even for the single frame between the identity changing and any
   * effect running. The previous implementation cleared A's list in an effect
   * AFTER rendering, which left exactly that frame open.
   */
  const visible = account !== null && account.accountKey === accountKey ? account : null;

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- see GuestScoutingProvider */
    setMounted(true);
    setGuestIds(readNumberList(SHORTLIST_KEY));
    setCompareQueue(readPlayerRefs(COMPARE_KEY));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [setGuestIds, setCompareQueue]);

  const book = useRef<WriteBook | null>(null);

  /**
   * Fresh bookkeeping per generation, so no intent or chain survives an identity
   * change and nothing queued under one session resumes under the next.
   */
  const bookFor = useCallback((forToken: string): WriteBook => {
    if (book.current === null || book.current.token !== forToken) {
      book.current = {
        token: forToken,
        intents: new Map(),
        chains: new Map(),
        nextRevision: 1,
      };
    }
    return book.current;
  }, []);

  /**
   * Applies an update only if it still belongs to the account on screen.
   *
   * Two independent guards, deliberately: `liveToken` rejects work started for a
   * previous identity, and the state's own `token` rejects work that raced a
   * retry. Either alone leaves a window.
   */
  const applyIfCurrent = useCallback(
    (forToken: string, update: (prev: AccountFavorites) => AccountFavorites) => {
      if (liveToken.current !== forToken) return;
      setAccount((prev) => (prev !== null && prev.token === forToken ? update(prev) : prev));
    },
    [],
  );

  // -- Private cache partitioning ------------------------------------------
  //
  // Correctness no longer depends on this effect - the `accountKey` stamp above
  // does that - but the React Query cache is a separate store and still has to
  // be dropped, or a shared machine could serve the previous person's list from
  // cache after a sign-out.
  const previousAccount = useRef<string | null>(null);
  useEffect(() => {
    if (previousAccount.current === accountKey) return;
    previousAccount.current = accountKey;
    queryClient.removeQueries({ queryKey: ["me"] });
    // Logically cancel every outstanding operation for the old identity. The
    // network request cannot be recalled, but its result can no longer be
    // applied: the book it would look itself up in is gone, and `liveToken` has
    // already moved on.
    book.current = null;
  }, [accountKey, queryClient]);

  // -- Load / merge ---------------------------------------------------------
  //
  // One effect owns the transition into account mode, for one token. It seeds a
  // loading state synchronously so nothing can render a fabricated zero in the
  // gap, then resolves it.
  useEffect(() => {
    if (!authenticated || accountKey === null || token === null) return;
    const forToken = token;
    bookFor(forToken);

    // Read at this moment rather than from a stale closure, so a player
    // favourited seconds before the session resolved still travels with the
    // merge - and so a retry re-sends exactly the list still on the device.
    const retained = readNumberList(SHORTLIST_KEY);

    /* eslint-disable-next-line react-hooks/set-state-in-effect --
     * Starting a network load and recording that it started are one action. The
     * seed must be committed before the first response can arrive, and it must
     * carry `retained` so a merge in progress keeps the scout's own hearts
     * pressed instead of blanking them. */
    setAccount({
      accountKey,
      token: forToken,
      ids: retained.length > 0 ? retained : null,
      origin: retained.length > 0 ? "device" : "unknown",
      loading: true,
      pending: [],
      failed: [],
      error: null,
    });

    const run = async () => {
      try {
        const authToken = await session.getToken();
        if (liveToken.current !== forToken) return;
        if (!authToken) throw new ApiError(401, "Session is not available");

        const result = retained.length
          ? await mergeFavorites(authToken, retained)
          : await getFavorites(authToken);
        if (liveToken.current !== forToken) return;

        applyIfCurrent(forToken, (prev) => ({
          ...prev,
          ids: applyIntents(result.player_ids, bookFor(forToken).intents),
          origin: "server",
          loading: false,
          failed: [],
          error: null,
        }));
        queryClient.setQueryData(["me", "favorites", accountKey], result);

        // Only NOW is the device copy retired, and only because the server has
        // confirmed it holds the players. Clearing earlier loses somebody's list
        // to a failed request; clearing later leaves a private account list
        // readable by the next anonymous visitor to this browser.
        if (retained.length) {
          setGuestIds([]);
          window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify([]));
        }
        clearDismissal();
      } catch (error) {
        if (liveToken.current !== forToken) return;
        const unauthorized = error instanceof ApiError && error.status === 401;
        applyIfCurrent(forToken, (prev) => ({
          ...prev,
          // The retained list STAYS VISIBLE. Those players really are on this
          // device, the count really is accurate, and substituting an empty
          // account list would make a failed merge look like data loss.
          ids: retained.length ? retained : prev.ids,
          origin: retained.length ? "device" : prev.origin,

          loading: false,
          error: unauthorized
            ? "Your session could not be verified. Sign in again to sync My Favorites."
            : retained.length
              ? "My Favorites could not be added to your account. Your saved players are still on this device."
              : "My Favorites could not be loaded from your account.",
          // A failed load is retryable but is not a per-player failure.
          failed: prev.failed,
        }));
      }
    };

    void run();
    // `session.getToken` is stable per session; `token` covers both the account
    // and the explicit retry counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, accountKey, token, queryClient, setGuestIds, applyIfCurrent, bookFor]);

  // -- Per-player writes ----------------------------------------------------
  //
  // Serialized per player, so two requests for one player never overlap, and
  // REVISIONED, so the last thing the user asked for is the thing that ends up
  // on the server. `syncPlayer` reads the current intent at execution time,
  // sends the matching request, and then retires that intent only if it is still
  // the one it started for. If the user changed their mind while the request was
  // in flight, the newer intent survives and is reconciled immediately - which is
  // what makes Add->Remove and Remove->Add settle correctly rather than stopping
  // one step short.
  //
  // The reconciler is reached through a ref because a settled request sometimes
  // has to start the next one for the same player, and a `useCallback` cannot
  // name itself without becoming its own dependency. Calling it is synchronous
  // and never awaited, so the follow-up simply chains behind the request that is
  // finishing - serialization is preserved and there is nothing to deadlock on.
  const reconcile = useRef<(player: PlayerRef, forToken: string) => void>(() => {});

  const syncPlayer = useCallback(
    (player: PlayerRef, forToken: string) => {
      const current = bookFor(forToken);
      const previous = current.chains.get(player.id) ?? Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(async () => {
          // Every hop re-checks the generation: the chain may have been queued
          // before an account change and resumed after it.
          if (liveToken.current !== forToken) return;
          const active = bookFor(forToken);
          if (active.token !== forToken) return;
          const intent = active.intents.get(player.id);
          if (intent === undefined) return;
          const { want, revision, anchors } = intent;

          /**
           * Retires this intent only if nothing newer replaced it.
           *
           * Returns whether a newer intent is waiting, so the caller can
           * reconcile again straight away instead of leaving the user's latest
           * decision unsent.
           */
          const settle = (): boolean => {
            const latest = active.intents.get(player.id);
            if (latest !== undefined && latest.revision === revision) {
              active.intents.delete(player.id);
              return false;
            }
            return latest !== undefined;
          };

          try {
            const authToken = await session.getToken();
            if (liveToken.current !== forToken) return;
            if (!authToken) throw new ApiError(401, "Session is not available");

            const result = want
              ? await addFavoriteRequest(authToken, player.id)
              : await removeFavoriteRequest(authToken, player.id);
            if (liveToken.current !== forToken) return;

            const superseded = settle();
            applyIfCurrent(forToken, (prev) => {
              // A superseded write is not finished: the player stays pending so
              // the surface keeps saying "saving" until the newer request lands.
              const pending = superseded ? prev.pending : withoutId(prev.pending, player.id);
              const failed = withoutId(prev.failed, player.id);
              return {
                ...prev,
                // Canonical order wins, but writes still in flight keep their
                // optimistic effect.
                ids: applyIntents(result.player_ids, active.intents),
                origin: "server",
                pending,
                failed,
                // One success does not clear another player's failure.
                error: failed.length ? prev.error : null,
              };
            });
            queryClient.setQueryData(["me", "favorites", accountKey], result);
            if (superseded) reconcile.current(player, forToken);
          } catch {
            if (liveToken.current !== forToken) return;
            const superseded = settle();
            if (superseded) {
              // The user has already asked for something else. Reconcile that
              // rather than rolling back to a state they no longer want, and do
              // not report a failure they are about to overwrite.
              reconcile.current(player, forToken);
              return;
            }

            const message = want
              ? `${player.name} could not be saved to your account. Nothing was saved.`
              : `${player.name} could not be removed from your account.`;

            applyIfCurrent(forToken, (prev) => ({
              ...prev,
              // Rollback touches THIS player only, on the CURRENT list - never a
              // stale whole-list snapshot - so any other optimistic change made
              // while this request was in flight survives, and the anchors put it
              // back in relative order rather than at a stale index.
              ids:
                prev.ids === null
                  ? prev.ids
                  : want
                    ? withoutId(prev.ids, player.id)
                    : restoreWithAnchors(prev.ids, player.id, anchors),
              pending: withoutId(prev.pending, player.id),
              failed: prev.failed.includes(player.id)
                ? prev.failed
                : [...prev.failed, player.id],
              error: message,
            }));
            speak(message);
          }
        });
      current.chains.set(player.id, next);
    },
    [session, queryClient, accountKey, speak, applyIfCurrent, bookFor],
  );

  useEffect(() => {
    reconcile.current = syncPlayer;
  }, [syncPlayer]);

  /**
   * What the interface shows.
   *
   * `null` means "we genuinely do not know", and it is the only thing that lets
   * the counter withhold a number instead of inventing a zero.
   *
   * While the account is UNCONFIRMED, the device list is not merely a stand-in -
   * it is the authoritative list, so it is read straight from `guestIds`. One
   * source of truth for that state, which is what stops the visible list and
   * `localStorage` drifting apart while a merge is still owed.
   */
  const visibleIds = useMemo<number[] | null>(() => {
    if (!authenticated) return guestIds;
    if (visible?.origin === "device") return guestIds;
    if (visible?.ids != null) return visible.ids;
    return guestIds.length ? guestIds : null;
  }, [authenticated, visible, guestIds]);

  const shortlistIds = visibleIds ?? NO_IDS;

  const isShortlisted = useCallback((id: number) => shortlistIds.includes(id), [shortlistIds]);

  /**
   * Writes to the device list and its versioned storage in one step.
   *
   * Used by a guest, and ALSO by a signed-in scout whose merge has not been
   * confirmed. `localStorage` is written here rather than left to the storage
   * effect, because a retry re-reads it directly and has to see the edit that
   * was just made, not the snapshot the session started with.
   */
  const writeDevice = useCallback(
    (id: number, want: boolean): number[] => {
      const next = want
        ? guestIds.includes(id)
          ? guestIds
          : [...guestIds, id]
        : withoutId(guestIds, id);
      setGuestIds(next);
      window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify(next));
      return next;
    },
    [guestIds, setGuestIds],
  );

  /** The guest write path, identical to the auth-free provider's. */
  const toggleGuest = useCallback(
    (player: PlayerRef) => {
      if (guestIds.includes(player.id)) {
        writeDevice(player.id, false);
        speak(`${player.name} removed from shortlist. Saved on this device.`);
        return;
      }
      writeDevice(player.id, true);
      speak(`${player.name} added to shortlist. Saved on this device.`);
      setGuestSaveSignal((n) => n + 1);
    },
    [guestIds, speak, writeDevice],
  );

  /**
   * The write path for a signed-in account whose merge has not been confirmed.
   *
   * It stays entirely device-local, and that is the correction: previously these
   * edits went to the individual account endpoints, and the first success
   * adopted the server's canonical list as the visible one while `localStorage`
   * still held the pre-merge snapshot. The account then appeared to hold players
   * it had never been given, and signing out exposed a stale list rather than the
   * one the scout had just been editing.
   *
   * So while the merge is still owed, the device is the system of record. Retry
   * re-reads storage and merges what is actually there now, and only a complete
   * successful merge retires it.
   */
  const writeUnconfirmed = useCallback(
    (player: PlayerRef, want: boolean, forToken: string) => {
      const next = writeDevice(player.id, want);
      applyIfCurrent(forToken, (prev) => ({ ...prev, ids: next }));
      speak(
        want
          ? `${player.name} added to My Favorites. Saved on this device, not in your account yet.`
          : `${player.name} removed from My Favorites. Saved on this device, not in your account yet.`,
      );
    },
    [writeDevice, applyIfCurrent, speak],
  );

  /**
   * Starts one optimistic account write.
   *
   * Optimistic on the CONTROL only: the heart flips in the frame it was pressed,
   * because that is feedback the scout needs immediately. The durability COPY
   * does not follow it - `pending` drives "saving to your account" until the
   * server actually confirms.
   */
  const writeAccount = useCallback(
    (player: PlayerRef, want: boolean, forToken: string, currentIds: number[]) => {
      const active = bookFor(forToken);
      const revision = active.nextRevision;
      active.nextRevision += 1;

      // Recorded SYNCHRONOUSLY, before the request is queued. Recording it inside
      // a `setAccount` updater made it depend on React's render timing: the
      // chain's first microtask could run before the updater and find no intent
      // at all, so the request was never sent and the player stayed pending
      // forever. Intent is event-time bookkeeping, not render-derived state.
      //
      // The anchors come from the list the user was looking at when they pressed,
      // which is exactly the relation they will expect restored if it fails.
      const at = currentIds.indexOf(player.id);
      active.intents.set(player.id, {
        want,
        revision,
        anchors: want
          ? undefined
          : {
              previous: at > 0 ? currentIds[at - 1] : null,
              next: at !== -1 && at < currentIds.length - 1 ? currentIds[at + 1] : null,
            },
      });

      applyIfCurrent(forToken, (prev) => {
        const ids = prev.ids ?? NO_IDS;
        return {
          ...prev,
          ids: want
            ? ids.includes(player.id)
              ? ids
              : [...ids, player.id]
            : withoutId(ids, player.id),
          pending: prev.pending.includes(player.id) ? prev.pending : [...prev.pending, player.id],
          // A new attempt clears this player's previous failure; other players'
          // failures are untouched.
          failed: withoutId(prev.failed, player.id),
          error: withoutId(prev.failed, player.id).length ? prev.error : null,
        };
      });
      speak(
        want
          ? `${player.name} added to My Favorites. Saving to your account.`
          : `${player.name} removed from My Favorites. Updating your account.`,
      );
      syncPlayer(player, forToken);
    },
    [speak, syncPlayer, applyIfCurrent, bookFor],
  );

  const toggleShortlist = useCallback(
    (player: PlayerRef) => {
      if (!authenticated || token === null) {
        toggleGuest(player);
        return;
      }
      if (visible === null || visible.loading) {
        // No canonical list yet, so there is nothing truthful to toggle against.
        // Saying so beats a silent no-op, and the window is sub-second.
        speak("Still syncing My Favorites with your account. Try again in a moment.");
        return;
      }
      const want = !(visibleIds ?? NO_IDS).includes(player.id);
      // An unconfirmed merge keeps favouriting fully available - it just keeps it
      // on the device, where the list still lives.
      if (visible.origin === "device") {
        writeUnconfirmed(player, want, token);
        return;
      }
      writeAccount(player, want, token, visible.ids ?? NO_IDS);
    },
    [
      authenticated,
      token,
      visible,
      visibleIds,
      toggleGuest,
      writeAccount,
      writeUnconfirmed,
      speak,
    ],
  );

  const removeShortlist = useCallback(
    (id: number, name?: string) => {
      const player = { id, name: name ?? "That player" };
      if (!authenticated || token === null) {
        writeDevice(id, false);
        speak("Player removed from shortlist. Saved on this device.");
        return;
      }
      if (visible === null || visible.loading) {
        speak("Still syncing My Favorites with your account. Try again in a moment.");
        return;
      }
      if (visible.origin === "device") {
        writeUnconfirmed(player, false, token);
        return;
      }
      writeAccount(player, false, token, visible.ids ?? NO_IDS);
    },
    [authenticated, token, visible, writeAccount, writeUnconfirmed, writeDevice, speak],
  );

  const retrySync = useCallback(() => setAttempt((n) => n + 1), []);

  const mode: FavoritesMode = useMemo(() => {
    if (resolving) return "resolving";
    if (!authenticated) return "guest";
    if (visible === null || visible.loading) return "account-loading";
    if (visible.error !== null) {
      // "unconfirmed" is a promise that those exact players are still on this
      // device. It is only true when a device list is genuinely on screen, so a
      // failed LOAD (nothing retained, nothing known) is a plain desync instead.
      return visible.origin === "device" ? "account-unconfirmed" : "account-desynced";
    }
    if (visible.pending.length) return "account-saving";
    return "account";
  }, [resolving, authenticated, visible]);

  const favorites = useMemo<FavoritesState>(
    () => ({
      mode,
      accountsAvailable: true,
      // Withheld while the session is unknown, and while an account's list is
      // unknown. Never a fabricated zero.
      count: mode === "resolving" || visibleIds === null ? null : visibleIds.length,
      syncError: visible?.error ?? null,
      retrySync,
      guestSaveSignal,
    }),
    [mode, visibleIds, visible, retrySync, guestSaveSignal],
  );

  return (
    <Provided
      shortlistIds={shortlistIds}
      isShortlisted={isShortlisted}
      toggleShortlist={toggleShortlist}
      removeShortlist={removeShortlist}
      notice={notice}
      favorites={favorites}
      compare={compare}
    >
      {children}
    </Provided>
  );
}


// ---------------------------------------------------------------------------

type CompareApi = ReturnType<typeof useCompareQueue>;

/** Assembles the one context value both providers publish. */
function Provided({
  shortlistIds,
  isShortlisted,
  toggleShortlist,
  removeShortlist,
  notice,
  favorites,
  compare,
  children,
}: {
  shortlistIds: number[];
  isShortlisted: (id: number) => boolean;
  toggleShortlist: (player: PlayerRef) => void;
  removeShortlist: (id: number, name?: string) => void;
  notice: string;
  favorites: FavoritesState;
  compare: CompareApi;
  children: React.ReactNode;
}) {
  const value = useMemo<ScoutingState>(
    () => ({
      shortlistIds,
      compareQueue: compare.compareQueue,
      notice,
      isShortlisted,
      toggleShortlist,
      removeShortlist,
      isQueuedForCompare: compare.isQueuedForCompare,
      toggleCompare: compare.toggleCompare,
      removeCompare: compare.removeCompare,
      clearCompare: compare.clearCompare,
      favorites,
    }),
    [shortlistIds, notice, isShortlisted, toggleShortlist, removeShortlist, favorites, compare],
  );

  return <ScoutingContext.Provider value={value}>{children}</ScoutingContext.Provider>;
}

/**
 * Picks the provider once, on a build-time constant.
 *
 * `session.enabled` cannot change during a session's lifetime, so the branch is
 * stable and neither subtree ever swaps hooks. The account subtree is the only
 * one that touches React Query, which is why an auth-free build (and every
 * existing unit test) never needs a QueryClient to render favourites.
 */
export function ScoutingStateProvider({ children }: { children: React.ReactNode }) {
  const session = useAuthSession();
  if (!session.enabled) return <GuestScoutingProvider>{children}</GuestScoutingProvider>;
  return <AccountScoutingProvider session={session}>{children}</AccountScoutingProvider>;
}

export function useScoutingState() {
  const context = useContext(ScoutingContext);
  if (!context) throw new Error("useScoutingState must be used inside ScoutingStateProvider");
  return context;
}
