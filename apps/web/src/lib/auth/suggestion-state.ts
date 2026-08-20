/**
 * Guest preference state for the contextual account suggestion.
 *
 * Small, versioned, and separate from `scoutboy.shortlist.v1` on purpose: the
 * shortlist format is a plain array of ids that three surfaces already read, and
 * bolting a preference object onto it would force a migration of real user data
 * to store a UI preference. This key can be corrupted, cleared or ignored
 * without touching anybody's saved players.
 *
 * The suppression window is a deliberate product promise: pressing "Not now"
 * means not now, for thirty days, not "until you reload".
 */

export const SUGGESTION_KEY = "scoutboy.accountSuggestion.v1";

/** Thirty days, in milliseconds. Documented in the 8.4A milestone record. */
export const DISMISSAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface SuggestionPreference {
  v: 1;
  /** Epoch milliseconds of the last explicit "Not now". */
  dismissedAt: number;
}

function storage(): Storage | null {
  // Private-mode Safari and locked-down browsers throw on access rather than
  // returning null, and a suggestion is never worth breaking a page over.
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads the stored dismissal, treating anything unrecognisable as "no dismissal".
 *
 * Corrupt state must fail OPEN here — showing a restrained suggestion one extra
 * time is a smaller harm than a thrown exception on the favourite path, which is
 * the interaction this whole feature is attached to.
 */
export function readDismissedAt(now: number = Date.now()): number | null {
  const store = storage();
  if (!store) return null;

  let raw: string | null;
  try {
    raw = store.getItem(SUGGESTION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<SuggestionPreference>;
    if (record.v !== 1) return null;

    const at = record.dismissedAt;
    // A non-number, a NaN, a negative, or a timestamp from the future (a clock
    // change, or hand-edited state) is not a dismissal we can reason about.
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at > now) return null;
    return at;
  } catch {
    return null;
  }
}

/** True when an explicit dismissal is still inside its cooling-off window. */
export function isSuppressed(now: number = Date.now()): boolean {
  const dismissedAt = readDismissedAt(now);
  return dismissedAt !== null && now - dismissedAt < DISMISSAL_WINDOW_MS;
}

/** Records an explicit "Not now". Silently does nothing if storage is unavailable. */
export function recordDismissal(now: number = Date.now()): void {
  const store = storage();
  if (!store) return;
  try {
    const record: SuggestionPreference = { v: 1, dismissedAt: now };
    store.setItem(SUGGESTION_KEY, JSON.stringify(record));
  } catch {
    /* quota or private mode: the suggestion simply reappears next session */
  }
}

/**
 * Clears the preference. Used after a successful sign-in, since the suggestion
 * can never apply to an account holder and leaving stale guest preference state
 * behind serves nobody.
 */
export function clearDismissal(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SUGGESTION_KEY);
  } catch {
    /* ignore */
  }
}
