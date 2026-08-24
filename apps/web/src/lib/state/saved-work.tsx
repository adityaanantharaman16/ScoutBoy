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
import * as api from "@/lib/api/saved-work";
import {
  deviceComparisonAsAccountShape,
  savedComparisonFromWire,
  savedViewFromWire,
  type AccountSavedComparison,
} from "@/lib/api/saved-work";
import { useAccountGeneration } from "@/lib/auth/generation";
import { useAuthSession, type EffectiveAuthSession } from "@/lib/auth/session";
import type { DiscoveryView } from "@/lib/filters/canonical";
import {
  makeSavedComparison,
  makeSavedView,
  readSavedComparisons,
  readSavedViews,
  savedComparisonIdentity,
  savedViewIdentity,
  upsertByIdentity,
  writeSavedComparisons,
  writeSavedViews,
  type LabelledRecord,
  type SavedComparison,
  type SavedComparisonSide,
  type SavedView,
} from "@/lib/storage/saved-work";

/**
 * Where a saved collection currently lives, and how sure we are about it.
 *
 * The same seven states 8.4A defined for My Favorites, because they are the same
 * seven truths and collapsing any two of them produces a claim that is not true
 * at the moment it is shown. Copy is derived from this value, so no surface can
 * say "saved to your account" while a write is in flight or report a confident
 * zero for an account whose collection has not arrived.
 */
export type CollectionMode =
  | "guest"
  | "resolving"
  | "account-loading"
  | "account"
  | "account-saving"
  | "account-unconfirmed"
  | "account-desynced";

/** The scope phrase a surface appends to a saved-work count. */
export function savedScopeLabel(mode: CollectionMode): string {
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

/**
 * What a write actually did, so a caller can report it without guessing.
 *
 * The two modes mean different things by success, and the distinction is the
 * whole point of this type:
 *
 * - **Guest success** means the device write completed. `localStorage` either
 *   accepted the value or threw, and that is knowable synchronously.
 * - **Account success** means the SERVER confirmed the mutation. An optimistic
 *   render is never a successful `WriteResult` - the promise a caller awaits does
 *   not resolve until the request reaches a terminal state.
 *
 * `superseded` is neither: the caller's intent was replaced by a newer one (or
 * its authentication generation moved on) before it could settle, so there is
 * nothing truthful for it to announce in either direction. A caller must stop
 * being busy and stay silent.
 */
export interface WriteResult {
  ok: boolean;
  disposition: "created" | "updated" | "unchanged" | "removed" | "failed" | "superseded";
  /** Present when `ok` is false AND there is something honest to say. */
  message?: string;
}

/**
 * The result an abandoned caller receives.
 *
 * No message, because there is no failure to report: the user asked for
 * something else, or signed into a different account. Announcing either success
 * or an error here would describe an operation nobody is waiting on.
 */
const SUPERSEDED: WriteResult = { ok: false, disposition: "superseded" };

export interface SavedCollection<T> {
  mode: CollectionMode;
  items: T[];
  /**
   * `null` whenever the real number is genuinely unknown: the session has not
   * resolved, or it has and the account's collection has not arrived. Never a
   * fabricated zero - a returning account holder must not read "Views 0" before
   * their real collection appears.
   */
  count: number | null;
  error: string | null;
  /** Re-attempts whichever account operation failed. Non-destructive. */
  retry: () => void;
}

export interface SavedWorkState {
  accountsAvailable: boolean;
  views: SavedCollection<SavedView> & {
    save: (label: string, view: DiscoveryView) => Promise<WriteResult>;
    rename: (clientId: string, label: string) => Promise<WriteResult>;
    remove: (clientId: string) => Promise<WriteResult>;
  };
  comparisons: SavedCollection<AccountSavedComparison> & {
    save: (
      label: string,
      playerA: SavedComparisonSide,
      playerB: SavedComparisonSide,
      roleKey: string | null,
    ) => Promise<WriteResult>;
    rename: (clientId: string, label: string) => Promise<WriteResult>;
    remove: (clientId: string) => Promise<WriteResult>;
  };
  /**
   * Increments when, and only when, a GUEST successfully persisted a NEW durable
   * artifact to this device. It is one of the three triggers for the account
   * suggestion, alongside a new favourite - which is why an update, a removal,
   * hydration, a reload and a FAILED write can none of them raise it.
   */
  guestSaveSignal: number;
}

/**
 * What `useSavedWork()` reports with no provider above it.
 *
 * The same decision `useAuthSession` makes, for the same reason: a control
 * rendered in isolation - in a unit test, or on a surface that does not mount the
 * saved-work tree - must behave like the product rather than throw. And it is
 * honest rather than merely quiet: the collections are empty because there is no
 * store attached, and every write REPORTS FAILURE instead of returning a success
 * the caller would then announce. Nothing here can claim something was saved.
 */
const UNAVAILABLE: WriteResult = {
  ok: false,
  disposition: "failed",
  message: "Saved work is not available on this surface.",
};

const NO_ITEMS: never[] = [];

function inertCollection<T>(): SavedCollection<T> {
  return { mode: "guest", items: NO_ITEMS as T[], count: 0, error: null, retry: () => {} };
}

const NO_SAVED_WORK: SavedWorkState = {
  accountsAvailable: false,
  views: {
    ...inertCollection<SavedView>(),
    save: async () => UNAVAILABLE,
    rename: async () => UNAVAILABLE,
    remove: async () => UNAVAILABLE,
  },
  comparisons: {
    ...inertCollection<AccountSavedComparison>(),
    save: async () => UNAVAILABLE,
    rename: async () => UNAVAILABLE,
    remove: async () => UNAVAILABLE,
  },
  guestSaveSignal: 0,
};

const SavedWorkContext = createContext<SavedWorkState>(NO_SAVED_WORK);

// ---------------------------------------------------------------------------
// One durable collection
// ---------------------------------------------------------------------------

/**
 * Everything that differs between saved views and saved comparisons.
 *
 * Two collections with identical synchronization semantics and different
 * payloads, so the semantics live in `useDurableCollection` once and the payload
 * differences live here. This is the extraction the milestone asks for: shared
 * where it removes risk, not shared for the sake of a framework.
 */
interface CollectionAdapter<TItem> {
  /** For error copy and live-region announcements. Plural, lower case. */
  noun: string;
  /** The React Query cache key segment, under the private `["me", ...]` namespace. */
  cacheKey: string;
  readDevice: () => { items: TItem[]; recovered: boolean };
  writeDevice: (items: TItem[]) => boolean;
  identity: (item: TItem) => string;
  load: (token: string) => Promise<{ items: unknown[] }>;
  merge: (token: string, items: TItem[]) => Promise<{ items: unknown[] }>;
  create: (token: string, item: TItem) => Promise<{ items: unknown[] }>;
  rename: (token: string, clientId: string, label: string) => Promise<{ items: unknown[] }>;
  remove: (token: string, clientId: string) => Promise<{ items: unknown[] }>;
  fromWire: (wire: unknown) => TItem;
  clientIdOf: (item: TItem) => string;
  labelOf: (item: TItem) => string;
  withLabel: (item: TItem, label: string) => TItem;
}

/**
 * One item's outstanding intent, before it is given a revision.
 *
 * A discriminated union in its own right rather than `Omit<Intent, "revision">`,
 * which collapses a union into the intersection of its members and loses the
 * discriminant - so `intent.label` stops narrowing and the compiler stops
 * catching the case this type exists to make unrepresentable.
 */
type IntentDraft<TItem> =
  | { kind: "create"; item: TItem }
  /**
   * `previous` is the item as it stood when the rename was requested.
   *
   * A whole item rather than a bare label, and only a FALLBACK: the real
   * rollback baseline is `Intent.baseline`, which tracks the canonical account
   * state and is re-based every time a newer one arrives. This value is used
   * only in the degenerate case where no canonical collection has been adopted
   * in this generation at all.
   */
  | { kind: "rename"; label: string; previous: TItem }
  | { kind: "remove"; at: number; item: TItem };

/**
 * One item's outstanding intent. See `PlayerIntent` in `scouting-state.tsx`.
 *
 * `resolve` is what makes the public `save`/`rename`/`remove` promises terminal.
 * Before it existed those functions returned `ok: true` the moment a request was
 * QUEUED, so a naming panel closed, restored focus and announced "Saved" while
 * the server had confirmed nothing - and a later failure then contradicted an
 * announcement the scout had already read.
 *
 * `baseline` is what a failed write restores, and it is MUTABLE on purpose.
 * Capturing it once, when the intent was created, was correct only while writes
 * never overlapped: with two renames in flight the newer intent was created
 * BEFORE the older one's response updated the canonical state, so its baseline
 * described a label the server no longer held. A failure then rolled the item
 * back past a change the account had actually accepted, and the client stayed
 * visibly wrong until the next load. It is therefore RE-BASED - see
 * `adoptCanonical` - every time a canonical collection is adopted, so a rollback
 * always restores the newest state the server has confirmed.
 *
 * `null` means "the account does not hold this item": a create that never
 * landed, or an item a canonical response has since confirmed is gone. Rolling
 * back to `null` removes the item rather than fabricating one the server has
 * never had.
 */
type Intent<TItem> = IntentDraft<TItem> & {
  revision: number;
  resolve: (result: WriteResult) => void;
  baseline: TItem | null;
};

interface WriteBook<TItem> {
  token: string;
  intents: Map<string, Intent<TItem>>;
  chains: Map<string, Promise<void>>;
  nextRevision: number;
  /**
   * The COMPLETE item the server last confirmed, per client id, for this
   * generation only.
   *
   * Whole items rather than labels, so a rollback restores exactly what the
   * account holds rather than reconstructing it from whatever is on screen.
   * Refreshed from every canonical response the account adopts. A fresh book
   * starts empty, which is what stops a rollback restoring something that
   * belonged to a previous account or a previous sign-in.
   */
  canonical: Map<string, TItem>;
  /**
   * Whether ANY canonical collection has been adopted under this token.
   *
   * Distinguishes "the server confirms this item does not exist" from "nothing
   * canonical has arrived yet", which are the same empty map but opposite
   * rollback decisions.
   */
  adopted: boolean;
}

interface AccountCollection<TItem> {
  accountKey: string;
  token: string;
  items: TItem[] | null;
  origin: "server" | "device" | "unknown";
  loading: boolean;
  pending: string[];
  error: string | null;
}

function withoutId(ids: string[], id: string): string[] {
  return ids.filter((other) => other !== id);
}

/**
 * The guest/account state machine for ONE durable collection.
 *
 * Every invariant 8.4A established for My Favorites holds here, for the same
 * reasons and against the same failure modes:
 *
 * - **The device stays the system of record until a merge is confirmed.** A
 *   failed merge keeps the device collection on screen, keeps it editable, and
 *   keeps every edit device-local. Only a complete successful merge clears the
 *   device copy, so a partial success cannot lose somebody's saved work.
 * - **Retry sends the LATEST device state**, re-read at that moment, not the
 *   snapshot the session began with.
 * - **Each collection is confirmed independently.** If saved views merge and
 *   saved comparisons do not, only the comparisons stay device-local and
 *   unconfirmed. That is why this hook is instantiated twice rather than once
 *   over a combined payload.
 * - **The last thing the user asked for is the thing that happens.** Intents
 *   carry a monotonic revision and are recorded synchronously in the event
 *   handler; a settling request may retire only the intent it started for.
 * - **A response cannot land on a session it does not belong to.** Rendering
 *   filters on the account stamp, and every asynchronous step re-checks the
 *   generation before mutating anything visible.
 */
function useDurableCollection<TItem extends LabelledRecord>(
  adapter: CollectionAdapter<TItem>,
  session: EffectiveAuthSession,
  mounted: boolean,
  onGuestCreate: () => void,
  /**
   * The private query cache, or `null` in a build with no identity provider.
   *
   * Passed in rather than read with `useQueryClient()` for the reason
   * `ScoutingStateProvider` splits its own tree in two: an auth-free build has no
   * `QueryClientProvider` for the favourites path either, and a hook that reached
   * for one unconditionally would make every anonymous render — and every unit
   * test that mounts a control in isolation — depend on a client it never uses.
   */
  queryClient: ReturnType<typeof useQueryClient> | null,
) {
  const [attempt, setAttempt] = useState(0);
  const { token, accountKey, authenticated, resolving } = useAccountGeneration(session, attempt);

  const [device, setDevice] = useState<TItem[]>([]);
  const [account, setAccount] = useState<AccountCollection<TItem> | null>(null);

  // Only state belonging to the account on screen may render. Evaluated during
  // render from the state's own stamp, so account A's collection cannot appear
  // under account B even for the single frame between the identity changing and
  // any effect running.
  const visible = account !== null && account.accountKey === accountKey ? account : null;

  const liveToken = useRef<string | null>(null);
  useEffect(() => {
    liveToken.current = token;
  }, [token]);

  // Browser storage hydrates after mount, so the server and initial client
  // renders stay deterministic. A collection that had to be cleaned on read is
  // written straight back, so one bad record is not re-dropped on every load.
  useEffect(() => {
    if (!mounted) return;
    const read = adapter.readDevice();
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
     * Hydration from browser storage is exactly the case this rule exempts. */
    setDevice(read.items);
    if (read.recovered) adapter.writeDevice(read.items);
    // `adapter` is a stable object built once per provider render path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const book = useRef<WriteBook<TItem> | null>(null);
  const bookFor = useCallback((forToken: string): WriteBook<TItem> => {
    if (book.current === null || book.current.token !== forToken) {
      book.current = {
        token: forToken,
        intents: new Map(),
        chains: new Map(),
        nextRevision: 1,
        canonical: new Map(),
        adopted: false,
      };
    }
    return book.current;
  }, []);

  /**
   * Adopts a canonical server collection as this generation's rollback baseline.
   *
   * Called wherever the account adopts a server collection - the initial
   * load/merge, and every response a per-item write returns - and it does two
   * things that have to happen together:
   *
   * 1. It replaces the canonical item map, so "what the account actually holds"
   *    is a set of whole items rather than the optimistic labels on screen.
   * 2. It RE-BASES every intent still outstanding for those items onto that
   *    answer. This is the correction: an intent created while an earlier write
   *    was in flight captured a baseline that the earlier write's success then
   *    made stale, and a later failure rolled the item back past a change the
   *    account had already accepted. An item the canonical collection does not
   *    contain re-bases to `null`, so a rollback removes it instead of
   *    fabricating a version the server has never held.
   *
   * Deliberately NOT a whole-collection snapshot to restore. Rollback stays
   * item-scoped, so an unrelated edit made while this request was in flight
   * survives it.
   */
  const adoptCanonical = useCallback(
    (target: WriteBook<TItem>, items: TItem[]) => {
      target.canonical.clear();
      for (const item of items) target.canonical.set(adapter.clientIdOf(item), item);
      target.adopted = true;
      for (const [clientId, intent] of target.intents) {
        intent.baseline = target.canonical.get(clientId) ?? null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const applyIfCurrent = useCallback(
    (forToken: string, update: (prev: AccountCollection<TItem>) => AccountCollection<TItem>) => {
      if (liveToken.current !== forToken) return;
      setAccount((prev) => (prev !== null && prev.token === forToken ? update(prev) : prev));
    },
    [],
  );

  // Private cache partitioning. Correctness does not depend on this - the account
  // stamp does - but React Query is a separate store and still has to be dropped,
  // or a shared machine could serve the previous person's saved work from cache.
  const previousAccount = useRef<string | null>(null);
  useEffect(() => {
    if (previousAccount.current === accountKey) return;
    previousAccount.current = accountKey;
    queryClient?.removeQueries({ queryKey: ["me", adapter.cacheKey] });
    // Logically cancel every outstanding operation for the old identity: the book
    // a response would look itself up in is gone, and `liveToken` has moved on.
    //
    // Every caller still awaiting one of those operations is RELEASED first.
    // Dropping the book without doing so would leave a naming panel busy and
    // disabled forever, waiting on a promise nothing can now settle. They receive
    // `superseded`, so none of them announces success or an error for an account
    // that is no longer on screen.
    for (const intent of book.current?.intents.values() ?? []) intent.resolve(SUPERSEDED);
    book.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey, queryClient]);

  // -- Load / merge ---------------------------------------------------------
  useEffect(() => {
    if (!mounted || !authenticated || accountKey === null || token === null) return;
    const forToken = token;
    bookFor(forToken);

    // Read at THIS moment rather than from a stale closure, so an item saved
    // seconds before the session resolved still travels with the merge - and so a
    // retry sends exactly the collection still on the device.
    const retained = adapter.readDevice().items;

    /* eslint-disable-next-line react-hooks/set-state-in-effect --
     * Starting a network load and recording that it started are one action. The
     * seed must be committed before the first response can arrive, and it carries
     * `retained` so a merge in progress keeps the scout's own saved work on
     * screen instead of blanking it. */
    setAccount({
      accountKey,
      token: forToken,
      items: retained.length > 0 ? retained : null,
      origin: retained.length > 0 ? "device" : "unknown",
      loading: true,
      pending: [],
      error: null,
    });

    const run = async () => {
      try {
        const authToken = await session.getToken();
        if (liveToken.current !== forToken) return;
        if (!authToken) throw new ApiError(401, "Session is not available");

        const result = retained.length
          ? await adapter.merge(authToken, retained)
          : await adapter.load(authToken);
        if (liveToken.current !== forToken) return;

        const canonical = result.items.map(adapter.fromWire);
        // What the account genuinely holds, before any optimistic edit touches it.
        adoptCanonical(bookFor(forToken), canonical);
        applyIfCurrent(forToken, (prev) => ({
          ...prev,
          items: canonical,
          origin: "server",
          loading: false,
          error: null,
        }));
        queryClient?.setQueryData(["me", adapter.cacheKey, accountKey], result);

        // Only NOW is the device copy retired, and only because the server has
        // confirmed it holds these items. Clearing earlier loses saved work to a
        // failed request; clearing later leaves private account data readable by
        // the next anonymous visitor to this browser.
        if (retained.length) {
          setDevice([]);
          adapter.writeDevice([]);
        }
      } catch (error) {
        if (liveToken.current !== forToken) return;
        const unauthorized = error instanceof ApiError && error.status === 401;
        applyIfCurrent(forToken, (prev) => ({
          ...prev,
          // The retained collection STAYS VISIBLE. Those items really are on this
          // device, the count really is accurate, and substituting an empty
          // account collection would make a failed merge look like data loss.
          items: retained.length ? retained : prev.items,
          origin: retained.length ? "device" : prev.origin,
          loading: false,
          error: unauthorized
            ? `Your session could not be verified. Sign in again to sync your ${adapter.noun}.`
            : retained.length
              ? `Your ${adapter.noun} could not be added to your account. They are still on this device.`
              : `Your ${adapter.noun} could not be loaded from your account.`,
        }));
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, authenticated, accountKey, token, queryClient, applyIfCurrent, bookFor]);

  // -- Per-item writes ------------------------------------------------------
  const reconcile = useRef<(clientId: string, forToken: string) => void>(() => {});

  const syncItem = useCallback(
    (clientId: string, forToken: string) => {
      // Captured synchronously. The async body below uses THIS book rather than
      // calling `bookFor` again, because an account change nulls the ref and a
      // second call would silently mint a fresh book - leaving the intent whose
      // caller is still waiting unreachable.
      const active = bookFor(forToken);
      const previous = active.chains.get(clientId) ?? Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(async () => {
          const intent = active.intents.get(clientId);
          // Already retired by an earlier hop, which resolved its caller.
          if (intent === undefined) return;
          const { revision, resolve } = intent;

          /**
           * Releases the caller when this generation is no longer the live one.
           *
           * Not a failure and not a success: the account or sign-in this write
           * belonged to has gone, so there is nothing truthful to report. The
           * caller stops being busy and says nothing.
           */
          const abandon = () => {
            if (active.intents.get(clientId)?.revision === revision) {
              active.intents.delete(clientId);
            }
            resolve(SUPERSEDED);
          };

          /** Retires this intent only if nothing newer replaced it. */
          const settle = (): boolean => {
            const latest = active.intents.get(clientId);
            if (latest !== undefined && latest.revision === revision) {
              active.intents.delete(clientId);
              return false;
            }
            return latest !== undefined;
          };

          if (liveToken.current !== forToken || active.token !== forToken) return abandon();

          try {
            const authToken = await session.getToken();
            if (liveToken.current !== forToken) return abandon();
            if (!authToken) throw new ApiError(401, "Session is not available");

            const result =
              intent.kind === "create"
                ? await adapter.create(authToken, intent.item)
                : intent.kind === "rename"
                  ? await adapter.rename(authToken, clientId, intent.label)
                  : await adapter.remove(authToken, clientId);
            if (liveToken.current !== forToken) return abandon();

            const superseded = settle();
            const canonical = result.items.map(adapter.fromWire);
            // What the account now genuinely holds. Adopted - and re-based onto
            // whatever intent is still outstanding for this item - BEFORE those
            // intents are replayed over it, so a newer write that later fails
            // rolls back to THIS answer rather than to the state it was queued
            // against.
            adoptCanonical(active, canonical);
            applyIfCurrent(forToken, (prev) => ({
              ...prev,
              // Canonical order wins, but a write still in flight keeps its
              // optimistic effect - the first of two concurrent writes must not
              // erase the second.
              items: replayIntents(canonical, active.intents, adapter),
              origin: "server",
              // A superseded write is not finished: the item stays pending so the
              // surface keeps saying "saving" until the newer request lands.
              pending: superseded ? prev.pending : withoutId(prev.pending, clientId),
              error: superseded ? prev.error : null,
            }));
            queryClient?.setQueryData(["me", adapter.cacheKey, accountKey], result);

            if (superseded) {
              // This caller's intent was replaced, so its outcome is not the one
              // the scout is waiting on. Stay silent and let the newer intent
              // settle its own caller.
              resolve(SUPERSEDED);
              reconcile.current(clientId, forToken);
              return;
            }
            // The ONLY place an account write reports success: the server has
            // confirmed it and the canonical collection has been adopted.
            resolve({ ok: true, disposition: confirmedDisposition(intent) });
          } catch {
            if (liveToken.current !== forToken) return abandon();
            const superseded = settle();
            if (superseded) {
              // The user has already asked for something else. Reconcile that
              // rather than rolling back to a state they no longer want, and do
              // not report a failure they are about to overwrite.
              resolve(SUPERSEDED);
              reconcile.current(clientId, forToken);
              return;
            }
            applyIfCurrent(forToken, (prev) => ({
              ...prev,
              // Rollback touches THIS item only, on the CURRENT collection, so an
              // unrelated optimistic edit made while the request was in flight
              // survives it.
              items: rollback(prev.items, clientId, intent, adapter),
              pending: withoutId(prev.pending, clientId),
              error:
                intent.kind === "remove"
                  ? `That item could not be removed from your account.`
                  : `That change could not be saved to your account. Nothing was saved.`,
            }));
            resolve({
              ok: false,
              disposition: "failed",
              message:
                intent.kind === "remove"
                  ? "That could not be removed from your account."
                  : "That could not be saved to your account. Nothing was saved.",
            });
          }
        });
      active.chains.set(clientId, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, queryClient, accountKey, applyIfCurrent, bookFor, adoptCanonical],
  );

  useEffect(() => {
    reconcile.current = syncItem;
  }, [syncItem]);

  // -- What the interface shows ---------------------------------------------
  //
  // While the account is UNCONFIRMED the device collection is not a stand-in, it
  // IS the authoritative collection, so it is read straight from `device`. One
  // source of truth for that state is what stops the visible list and browser
  // storage drifting apart while a merge is still owed.
  const items = useMemo<TItem[] | null>(() => {
    if (!authenticated) return device;
    if (visible?.origin === "device") return device;
    if (visible?.items != null) return visible.items;
    return device.length ? device : null;
  }, [authenticated, visible, device]);

  const mode: CollectionMode = useMemo(() => {
    if (resolving) return "resolving";
    if (!authenticated) return "guest";
    if (visible === null || visible.loading) return "account-loading";
    if (visible.error !== null) {
      // "unconfirmed" promises those exact items are still on this device. It is
      // only true when a device collection is genuinely on screen, so a failed
      // LOAD (nothing retained, nothing known) is a plain desync instead.
      return visible.origin === "device" ? "account-unconfirmed" : "account-desynced";
    }
    if (visible.pending.length) return "account-saving";
    return "account";
  }, [resolving, authenticated, visible]);

  /** Writes to the device collection and its storage in one step. */
  const writeDevice = useCallback(
    (next: TItem[]): boolean => {
      const ok = adapter.writeDevice(next);
      // The visible collection is only advanced when the write actually landed.
      // Showing an item as saved after a quota failure is the one thing this
      // whole layer exists to prevent.
      if (ok) setDevice(next);
      return ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const quotaFailure = `There was no room to save that on this device. Your existing ${adapter.noun} are unchanged.`;

  /** The device write path: a guest, or a signed-in scout whose merge is unconfirmed. */
  const deviceUpsert = useCallback(
    (candidate: TItem, forToken: string | null): WriteResult => {
      const outcome = upsertByIdentity(device, candidate, adapter.identity);
      if (outcome.disposition === "unchanged") {
        return { ok: true, disposition: "unchanged" };
      }
      if (!writeDevice(outcome.items)) {
        return { ok: false, disposition: "failed", message: quotaFailure };
      }
      if (forToken !== null) {
        applyIfCurrent(forToken, (prev) => ({ ...prev, items: outcome.items }));
      } else if (outcome.disposition === "created") {
        // Raised AFTER confirmed local persistence, never before, and only for a
        // genuinely new artifact.
        onGuestCreate();
      }
      return { ok: true, disposition: outcome.disposition };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device, writeDevice, applyIfCurrent, onGuestCreate, quotaFailure],
  );

  const deviceRename = useCallback(
    (clientId: string, label: string, forToken: string | null): WriteResult => {
      const at = device.findIndex((item) => adapter.clientIdOf(item) === clientId);
      if (at === -1) return { ok: true, disposition: "unchanged" };
      if (adapter.labelOf(device[at]) === label) return { ok: true, disposition: "unchanged" };
      const next = [...device];
      next[at] = adapter.withLabel(device[at], label);
      if (!writeDevice(next)) {
        return { ok: false, disposition: "failed", message: quotaFailure };
      }
      if (forToken !== null) applyIfCurrent(forToken, (prev) => ({ ...prev, items: next }));
      return { ok: true, disposition: "updated" };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device, writeDevice, applyIfCurrent, quotaFailure],
  );

  const deviceRemove = useCallback(
    (clientId: string, forToken: string | null): WriteResult => {
      const next = device.filter((item) => adapter.clientIdOf(item) !== clientId);
      if (next.length === device.length) return { ok: true, disposition: "unchanged" };
      if (!writeDevice(next)) {
        return {
          ok: false,
          disposition: "failed",
          message: "That could not be removed from this device.",
        };
      }
      if (forToken !== null) applyIfCurrent(forToken, (prev) => ({ ...prev, items: next }));
      return { ok: true, disposition: "removed" };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device, writeDevice, applyIfCurrent],
  );

  /**
   * Starts one optimistic account write, and returns its TERMINAL result.
   *
   * The optimistic render happens immediately, because that is the feedback a
   * scout needs; the promise does not settle until the request has actually
   * succeeded, actually failed, or been superseded. That separation is the whole
   * correction: a caller can show an optimistic collection and still refuse to
   * announce "saved to your account" until the account really holds it.
   */
  const accountWrite = useCallback(
    (clientId: string, draft: IntentDraft<TItem>, forToken: string): Promise<WriteResult> => {
      const active = bookFor(forToken);
      const revision = active.nextRevision;
      active.nextRevision += 1;

      let resolve!: (result: WriteResult) => void;
      const settled = new Promise<WriteResult>((r) => {
        resolve = r;
      });

      // The rollback baseline is the account's CANONICAL item, not the state this
      // write was queued against - and not a label lifted off the screen, which
      // by failure time is the optimistic one. `null` means the account does not
      // hold this item, so a failure removes it rather than inventing one.
      //
      // `adoptCanonical` re-bases this the moment a newer canonical answer
      // arrives, which is what makes an overlapping write roll back to what the
      // server actually confirmed rather than to a superseded predecessor.
      //
      // The draft's own value is used ONLY when nothing canonical has been
      // adopted under this token yet - a state no account write can currently
      // reach, kept as a floor rather than a crash.
      const queuedAgainst: TItem | null =
        draft.kind === "create" ? null : draft.kind === "rename" ? draft.previous : draft.item;
      const intent: Intent<TItem> = {
        ...draft,
        revision,
        resolve,
        baseline: active.adopted ? (active.canonical.get(clientId) ?? null) : queuedAgainst,
      };

      // Recorded SYNCHRONOUSLY, before the request is queued. Recording it inside
      // a state updater made it depend on React's render timing: the chain's
      // first microtask could run before the updater and find no intent at all.
      const replaced = active.intents.get(clientId);
      active.intents.set(clientId, intent);
      // Whoever was awaiting the intent this one replaces is released now rather
      // than left holding a promise that can no longer settle.
      replaced?.resolve(SUPERSEDED);

      applyIfCurrent(forToken, (prev) => ({
        ...prev,
        items: applyOptimistically(prev.items, clientId, draft, adapter),
        pending: prev.pending.includes(clientId) ? prev.pending : [...prev.pending, clientId],
        error: null,
      }));
      syncItem(clientId, forToken);
      return settled;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookFor, applyIfCurrent, syncItem],
  );

  const canWriteToAccount = authenticated && token !== null && visible !== null && !visible.loading;

  const save = useCallback(
    async (candidate: TItem): Promise<WriteResult> => {
      if (!authenticated || token === null) return deviceUpsert(candidate, null);
      if (visible === null || visible.loading) {
        return {
          ok: false,
          disposition: "failed",
          message: `Still syncing your ${adapter.noun} with your account. Try again in a moment.`,
        };
      }
      // An unconfirmed merge keeps saving fully available - it just keeps it on
      // the device, where the collection still lives.
      if (visible.origin === "device") return deviceUpsert(candidate, token);

      const existing = (visible.items ?? []).find(
        (item) => adapter.identity(item) === adapter.identity(candidate),
      );
      if (existing) {
        if (adapter.labelOf(existing) === adapter.labelOf(candidate)) {
          return { ok: true, disposition: "unchanged" };
        }
        // Awaited: the caller learns whether the ACCOUNT took the new name.
        return accountWrite(
          adapter.clientIdOf(existing),
          {
            kind: "rename",
            label: adapter.labelOf(candidate),
            previous: existing,
          },
          token,
        );
      }
      return accountWrite(
        adapter.clientIdOf(candidate),
        { kind: "create", item: candidate },
        token,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authenticated, token, visible, deviceUpsert, accountWrite],
  );

  const rename = useCallback(
    async (clientId: string, label: string): Promise<WriteResult> => {
      if (!authenticated || token === null) return deviceRename(clientId, label, null);
      if (!canWriteToAccount) {
        return {
          ok: false,
          disposition: "failed",
          message: `Still syncing your ${adapter.noun} with your account. Try again in a moment.`,
        };
      }
      if (visible.origin === "device") return deviceRename(clientId, label, token);
      const current = (visible.items ?? []).find(
        (item) => adapter.clientIdOf(item) === clientId,
      );
      if (current === undefined) return { ok: true, disposition: "unchanged" };
      if (adapter.labelOf(current) === label) return { ok: true, disposition: "unchanged" };
      return accountWrite(
        clientId,
        { kind: "rename", label, previous: current },
        token,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authenticated, token, visible, canWriteToAccount, deviceRename, accountWrite],
  );

  const remove = useCallback(
    async (clientId: string): Promise<WriteResult> => {
      if (!authenticated || token === null) return deviceRemove(clientId, null);
      if (!canWriteToAccount) {
        return {
          ok: false,
          disposition: "failed",
          message: `Still syncing your ${adapter.noun} with your account. Try again in a moment.`,
        };
      }
      if (visible.origin === "device") return deviceRemove(clientId, token);
      const at = (visible.items ?? []).findIndex(
        (item) => adapter.clientIdOf(item) === clientId,
      );
      if (at === -1) return { ok: true, disposition: "unchanged" };
      return accountWrite(
        clientId,
        { kind: "remove", at, item: (visible.items ?? [])[at] },
        token,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authenticated, token, visible, canWriteToAccount, deviceRemove, accountWrite],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const collection: SavedCollection<TItem> = {
    mode,
    items: items ?? [],
    count: mode === "resolving" || items === null ? null : items.length,
    error: visible?.error ?? null,
    retry,
  };

  return { collection, save, rename, remove };
}

// ---------------------------------------------------------------------------
// Optimistic helpers
// ---------------------------------------------------------------------------

function applyOptimistically<TItem>(
  items: TItem[] | null,
  clientId: string,
  intent: IntentDraft<TItem>,
  adapter: CollectionAdapter<TItem>,
): TItem[] {
  const base = items ?? [];
  if (intent.kind === "create") return [...base, intent.item];
  if (intent.kind === "remove") {
    return base.filter((item) => adapter.clientIdOf(item) !== clientId);
  }
  return base.map((item) =>
    adapter.clientIdOf(item) === clientId ? adapter.withLabel(item, intent.label) : item,
  );
}

/**
 * Replays still-in-flight intents on top of a canonical collection.
 *
 * The server's answer is the ordering authority, but it only knows about the ONE
 * write it just handled. Adopting it verbatim while a second write is in flight
 * would visibly undo that second write.
 */
function replayIntents<TItem>(
  base: TItem[],
  intents: Map<string, Intent<TItem>>,
  adapter: CollectionAdapter<TItem>,
): TItem[] {
  let out = base;
  for (const [clientId, intent] of intents) {
    out = applyOptimistically(out, clientId, intent, adapter);
  }
  return out;
}

/**
 * Restores ONE item to the newest state the server has confirmed, and touches
 * nothing else.
 *
 * The baseline is `intent.baseline`, which `adoptCanonical` keeps level with the
 * canonical account collection for as long as the intent is outstanding. That is
 * the whole correction: rolling back to the state a write was QUEUED against
 * undid changes the account had since accepted. With two renames overlapping -
 * `A → B` still in flight when `B → C` is submitted, `B` confirmed, `C` refused -
 * the item now settles on `B`, which is what the server holds, instead of
 * reverting to the `A` the second write happened to be queued against.
 *
 * Two cases, both item-scoped and both computed against the CURRENT collection,
 * so an unrelated create, rename or removal made while this request was in flight
 * survives it and a later canonical response remains the ordering authority:
 *
 * - **The account holds the item.** It is put back exactly as the server last
 *   reported it - in place where it is still on screen, or re-inserted at the
 *   index a failed removal took it from (clamped, and never duplicated). A saved
 *   collection is chronological rather than curated, so that index is meaningful
 *   here in a way it was not for the favourites list.
 * - **The account does not hold it** (`baseline === null`): a create that never
 *   landed, or an item a canonical response has since confirmed is gone. It is
 *   removed. Nothing is fabricated, and a rename is never left showing a label
 *   the server has never stored.
 */
function rollback<TItem>(
  items: TItem[] | null,
  clientId: string,
  intent: Intent<TItem>,
  adapter: CollectionAdapter<TItem>,
): TItem[] | null {
  if (items === null) return items;
  const { baseline } = intent;
  const present = items.some((item) => adapter.clientIdOf(item) === clientId);
  if (baseline === null) {
    return present ? items.filter((item) => adapter.clientIdOf(item) !== clientId) : items;
  }
  if (present) {
    return items.map((item) => (adapter.clientIdOf(item) === clientId ? baseline : item));
  }
  const at = intent.kind === "remove" ? Math.min(intent.at, items.length) : items.length;
  return [...items.slice(0, at), baseline, ...items.slice(at)];
}

/** What a confirmed intent did, in the vocabulary a caller reports. */
function confirmedDisposition<TItem>(intent: Intent<TItem>): WriteResult["disposition"] {
  if (intent.kind === "create") return "created";
  if (intent.kind === "rename") return "updated";
  return "removed";
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const VIEW_ADAPTER: CollectionAdapter<SavedView> = {
  noun: "saved views",
  cacheKey: "saved-views",
  readDevice: () => readSavedViews(),
  writeDevice: writeSavedViews,
  identity: savedViewIdentity,
  load: api.getSavedViews,
  merge: api.mergeViews,
  create: (token, item) =>
    api.saveView(token, { clientId: item.clientId, label: item.label, view: item.view }),
  rename: api.renameView,
  remove: api.deleteView,
  fromWire: (wire) => savedViewFromWire(wire as api.SavedViewWire),
  clientIdOf: (item) => item.clientId,
  labelOf: (item) => item.label,
  withLabel: (item, label) => ({ ...item, label, updatedAt: Date.now() }),
};

const COMPARISON_ADAPTER: CollectionAdapter<AccountSavedComparison> = {
  noun: "saved comparisons",
  cacheKey: "saved-comparisons",
  readDevice: () => {
    const read = readSavedComparisons();
    return { items: read.items.map(deviceComparisonAsAccountShape), recovered: read.recovered };
  },
  writeDevice: (items) =>
    writeSavedComparisons(
      items
        // An item with no id cannot be written to a device collection. It only
        // exists in account mode, where nothing writes to the device - so this is
        // a type-level guard rather than a case that occurs.
        .filter((item) => item.playerA.playerId !== null && item.playerB.playerId !== null)
        .map(
          (item) =>
            ({
              clientId: item.clientId,
              label: item.label,
              playerA: { playerId: item.playerA.playerId as number, name: item.playerA.name },
              playerB: { playerId: item.playerB.playerId as number, name: item.playerB.name },
              roleKey: item.roleKey,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            }) as SavedComparison,
        ),
    ),
  identity: (item) =>
    savedComparisonIdentity({
      ...item,
      playerA: { playerId: item.playerA.playerId ?? 0, name: item.playerA.name },
      playerB: { playerId: item.playerB.playerId ?? 0, name: item.playerB.name },
    } as SavedComparison),
  load: api.getSavedComparisons,
  merge: (token, items) =>
    api.mergeComparisons(
      token,
      items
        .filter((item) => item.playerA.playerId !== null && item.playerB.playerId !== null)
        .map(
          (item) =>
            ({
              clientId: item.clientId,
              label: item.label,
              playerA: { playerId: item.playerA.playerId as number, name: item.playerA.name },
              playerB: { playerId: item.playerB.playerId as number, name: item.playerB.name },
              roleKey: item.roleKey,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            }) as SavedComparison,
        ),
    ),
  create: (token, item) =>
    api.saveComparison(token, {
      clientId: item.clientId,
      label: item.label,
      playerA: { playerId: item.playerA.playerId as number, name: item.playerA.name },
      playerB: { playerId: item.playerB.playerId as number, name: item.playerB.name },
      roleKey: item.roleKey,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }),
  rename: api.renameComparison,
  remove: api.deleteComparison,
  fromWire: (wire) => savedComparisonFromWire(wire as api.SavedComparisonWire),
  clientIdOf: (item) => item.clientId,
  labelOf: (item) => item.label,
  withLabel: (item, label) => ({ ...item, label, updatedAt: Date.now() }),
};

function SavedWorkTree({
  session,
  queryClient,
  children,
}: {
  session: EffectiveAuthSession;
  queryClient: ReturnType<typeof useQueryClient> | null;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [guestSaveSignal, setGuestSaveSignal] = useState(0);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
     * Browser storage must hydrate after mount to keep the server and initial
     * client render deterministic. */
    setMounted(true);
  }, []);

  const onGuestCreate = useCallback(() => setGuestSaveSignal((n) => n + 1), []);

  const views = useDurableCollection(
    VIEW_ADAPTER,
    session,
    mounted,
    onGuestCreate,
    queryClient,
  );
  const comparisons = useDurableCollection(
    COMPARISON_ADAPTER,
    session,
    mounted,
    onGuestCreate,
    queryClient,
  );

  const saveView = useCallback(
    (label: string, view: DiscoveryView) => views.save(makeSavedView(label, view)),
    [views],
  );

  const saveComparison = useCallback(
    (
      label: string,
      playerA: SavedComparisonSide,
      playerB: SavedComparisonSide,
      roleKey: string | null,
    ) =>
      comparisons.save(
        deviceComparisonAsAccountShape(makeSavedComparison(label, playerA, playerB, roleKey)),
      ),
    [comparisons],
  );

  const value = useMemo<SavedWorkState>(
    () => ({
      accountsAvailable: session.enabled,
      views: {
        ...views.collection,
        save: saveView,
        rename: views.rename,
        remove: views.remove,
      },
      comparisons: {
        ...comparisons.collection,
        save: saveComparison,
        rename: comparisons.rename,
        remove: comparisons.remove,
      },
      guestSaveSignal,
    }),
    [session.enabled, views, comparisons, saveView, saveComparison, guestSaveSignal],
  );

  return <SavedWorkContext.Provider value={value}>{children}</SavedWorkContext.Provider>;
}

/** The account-aware tree. The only branch that touches the private query cache. */
function AccountSavedWork({
  session,
  children,
}: {
  session: EffectiveAuthSession;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  return (
    <SavedWorkTree session={session} queryClient={queryClient}>
      {children}
    </SavedWorkTree>
  );
}

/**
 * Picks the tree once, on a build-time constant.
 *
 * `session.enabled` cannot change during a session's lifetime, so the branch is
 * stable and neither subtree ever swaps hooks. Only the account subtree touches
 * React Query, which is why an auth-free build - and every existing unit test that
 * mounts a control in isolation - never needs a QueryClient to render saved work.
 * This mirrors `ScoutingStateProvider` exactly.
 */
export function SavedWorkProvider({ children }: { children: React.ReactNode }) {
  const session = useAuthSession();
  if (!session.enabled) {
    return (
      <SavedWorkTree session={session} queryClient={null}>
        {children}
      </SavedWorkTree>
    );
  }
  return <AccountSavedWork session={session}>{children}</AccountSavedWork>;
}

/**
 * The saved-work state.
 *
 * Falls back to `NO_SAVED_WORK` with no provider above it, so a control mounted
 * on its own renders rather than throwing - and, because every write in that
 * fallback reports failure, nothing can silently claim to have saved.
 */
export function useSavedWork(): SavedWorkState {
  return useContext(SavedWorkContext);
}
