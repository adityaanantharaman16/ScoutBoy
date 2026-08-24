// Versioned browser storage for a durable collection.
//
// Milestone 8.4A stored favourites as a bare `[1, 2, 3]` under
// `scoutboy.shortlist.v1`. That was right for a list of integers and is
// deliberately left alone. Saved views and saved comparison setups are records
// with several fields each, and a bare array of those has no way to say what
// shape it is — so a future field change would have to guess whether an
// unrecognised object was old data or corruption. These collections therefore
// carry an explicit envelope:
//
//     { "version": 1, "items": [ ... ] }
//
// The rules every read follows, and why each one exists rather than being
// assumed:
//
//   * Unreadable storage is not an error the product surfaces. Private-mode
//     Safari and locked-down browsers THROW on `localStorage` access rather than
//     returning null, and a saved view is never worth breaking a page over.
//   * Malformed JSON, a non-object root, a missing `items` array and an unknown
//     version all read as "no collection". They are indistinguishable from a
//     first visit, which is the only honest interpretation of state we cannot
//     parse.
//   * A malformed ITEM is dropped, its valid siblings are kept. Discarding a
//     whole collection because one record went bad would destroy work that is
//     perfectly readable.
//   * Duplicates collapse to their FIRST occurrence, so the earliest position —
//     the one the scout actually saw their collection in — survives, and
//     re-reading the same store twice produces the same order.
//
// A WRITE CAN FAIL, AND SAYS SO. `writeCollection` returns a boolean rather than
// swallowing a quota error, because the one thing worse than failing to save is
// telling somebody their work is saved when it is not.

/** The only envelope version in existence. Bump deliberately, with a migration. */
export const COLLECTION_VERSION = 1;

export interface CollectionEnvelope<T> {
  version: number;
  items: T[];
}

/** What a read recovered, and whether anything was lost getting there. */
export interface CollectionRead<T> {
  items: T[];
  /**
   * True when the stored state was not cleanly readable: unparseable, the wrong
   * shape, an unknown version, or carrying at least one item that failed
   * validation. The caller uses it to rewrite the cleaned collection back, so a
   * single bad record does not have to be re-dropped on every load.
   */
  recovered: boolean;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads and validates one durable collection.
 *
 * `validate` returns the canonical item or `null`. It is given `unknown` and must
 * check every field it relies on — nothing upstream has verified anything, and a
 * hand-edited or half-written store is exactly the input this has to survive.
 *
 * `identity` decides what a duplicate is. Two items with the same identity
 * collapse to the first.
 */
export function readCollection<T>(
  key: string,
  validate: (raw: unknown) => T | null,
  identity: (item: T) => string,
  limit: number,
): CollectionRead<T> {
  const store = storage();
  if (!store) return { items: [], recovered: false };

  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return { items: [], recovered: false };
  }
  if (!raw) return { items: [], recovered: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Truncated by a crash mid-write, or hand-edited. Not recoverable, and not
    // worth a thrown exception on a page load.
    return { items: [], recovered: true };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    // Includes the pre-envelope shape (a bare array). These collections have
    // never had one, so an array here is corruption rather than old data.
    return { items: [], recovered: true };
  }

  const envelope = parsed as Partial<CollectionEnvelope<unknown>>;
  if (envelope.version !== COLLECTION_VERSION) {
    // A version this build does not know how to read — most likely written by a
    // NEWER build in another tab. Reading it as "empty" is safe (nothing is
    // deleted until this build writes, and the caller only writes what the user
    // just did); guessing at its shape would not be.
    return { items: [], recovered: true };
  }
  if (!Array.isArray(envelope.items)) return { items: [], recovered: true };

  const items: T[] = [];
  const seen = new Set<string>();
  let recovered = false;

  for (const candidate of envelope.items) {
    const item = validate(candidate);
    if (item === null) {
      recovered = true;
      continue;
    }
    const id = identity(item);
    if (seen.has(id)) {
      recovered = true;
      continue;
    }
    seen.add(id);
    if (items.length >= limit) {
      recovered = true;
      continue;
    }
    items.push(item);
  }

  return { items, recovered };
}

/**
 * Writes one durable collection. Returns whether it actually landed.
 *
 * `false` means the browser refused — a full quota, a private-mode store, a
 * disabled origin. The caller must treat that as "this was not saved" and say so,
 * never as a silent success.
 */
export function writeCollection<T>(key: string, items: T[]): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const envelope: CollectionEnvelope<T> = { version: COLLECTION_VERSION, items };
    store.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/** Removes one durable collection. Used after a confirmed successful merge. */
export function clearCollection(key: string): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared field validators
// ---------------------------------------------------------------------------

/**
 * Control characters a stored plain-text label may not contain: C0, DEL, C1, and
 * the Unicode line/paragraph separators. The same set the API rejects, so a label
 * that survives here is a label the server will also accept — a device item that
 * cannot be merged is worse than one that was never saved.
 */
function isControlCharacter(code: number): boolean {
  return (
    code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
  );
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (isControlCharacter(value.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * A user-authored plain-text label: trimmed, bounded, and free of control
 * characters. Returns `null` when the value cannot be a label at all.
 *
 * Nothing is escaped or stripped. `<script>alert(1)</script>` is a perfectly
 * valid 24-character label and is stored verbatim, because it is rendered as
 * React text and never interpolated into markup, a URL or a query. Sanitising it
 * would corrupt legitimate labels ("Wingers < EUR 5M") while defending nothing
 * that is not already defended where it is rendered.
 */
export function validLabel(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  if (hasControlCharacter(trimmed)) return null;
  return trimmed;
}

/** A canonical lower-case hyphenated UUID — the same form the API path accepts. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validClientId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/** A positive integer id, or null. Never coerces a float or a numeric string. */
export function validPlayerId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** An epoch-millisecond timestamp, or `fallback` when the stored one is unusable. */
export function validTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * A fresh client id.
 *
 * `crypto.randomUUID` where it exists — every browser this product supports and
 * jsdom under Node 19+. The fallback is only reached in an insecure context or an
 * older engine, and is built from `crypto.getRandomValues` where that exists so
 * it is still a real v4 UUID rather than a `Math.random` string. These ids are
 * row addresses scoped to a verified account, never secrets or capabilities, so
 * the last-resort branch is a collision concern and not a security one.
 */
export function newClientId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
