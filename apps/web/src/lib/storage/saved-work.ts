// The two device collections 8.4B introduces, and the record shapes they hold.
//
// Separate keys, deliberately: a saved Discovery view and a saved comparison
// setup have different shapes, different failure modes and different sizes, and
// one corrupt comparison must not be able to take a scout's saved views with it.
// Neither shares a key with `scoutboy.shortlist.v1`, so nothing here can damage
// the favourites list 8.4A already stores.
//
// What is stored is the MINIMUM needed to reopen the artifact:
//
//   * a saved view holds its canonical filter state, a label, and timestamps;
//   * a saved comparison holds two player ids with the names they were saved
//     under, an optional role, a label, and timestamps.
//
// A player's name is stored because it is the only way to explain an unavailable
// participant honestly after that player is gone — a saved setup that reads
// "player 4118 is no longer available" tells a scout nothing. No API response, no
// score, no conclusion, no confidence value and nothing identifying a person is
// stored anywhere in here.

import {
  discoveryViewIdentity,
  recoverDiscoveryView,
  type DiscoveryView,
  type DiscoveryViewField,
} from "@/lib/filters/canonical";

import {
  clearCollection,
  newClientId,
  readCollection,
  validClientId,
  validLabel,
  validPlayerId,
  validTimestamp,
  writeCollection,
  type CollectionRead,
} from "./durable-collection";

export const SAVED_VIEWS_KEY = "scoutboy.savedViews.v1";
export const SAVED_COMPARISONS_KEY = "scoutboy.savedComparisons.v1";

/** Mirrors `LABEL_MAX` in the API schema, so a device label is always mergeable. */
export const LABEL_MAX = 80;

/** Mirrors `MAX_COLLECTION_ITEMS`. A device collection cannot outgrow the account. */
export const COLLECTION_LIMIT = 200;

/** The longest player name a saved comparison will carry. Mirrors the API column. */
const PLAYER_LABEL_MAX = 160;

export interface SavedView {
  clientId: string;
  label: string;
  view: DiscoveryView;
  createdAt: number;
  updatedAt: number;
  /**
   * Criteria that were stored but are no longer representable, resolved at read
   * time. Empty for a healthy item. Carried on the record so the Saved Work list
   * and the reopen path can both say the same thing about it.
   */
  unavailable: DiscoveryViewField[];
}

export interface SavedComparisonSide {
  playerId: number;
  name: string;
}

export interface SavedComparison {
  clientId: string;
  label: string;
  playerA: SavedComparisonSide;
  playerB: SavedComparisonSide;
  /** `null` is Automatic Role, canonically. There is no "auto" sentinel. */
  roleKey: string | null;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** A saved view IS its filter state, so that is what decides a duplicate. */
export function savedViewIdentity(item: SavedView): string {
  return discoveryViewIdentity(item.view);
}

/**
 * A saved comparison is its ORDERED pair plus its role.
 *
 * Side order is preserved: Player 1 and Player 2 are meaningful screen
 * positions, so `7|5` and `5|7` are different saved setups. The separator cannot
 * appear in either component, so no two distinct setups can collide.
 */
export function savedComparisonIdentity(item: SavedComparison): string {
  return `${item.playerA.playerId}|${item.playerB.playerId}|${item.roleKey ?? ""}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One stored saved view, validated field by field.
 *
 * A view whose FILTERS partly failed validation is still a valid item: the
 * surviving criteria are kept and the lost ones are named, because a scout whose
 * playstyle was retired should get their league, age and club back rather than
 * losing the saved view entirely. Only a missing id or an unusable label makes
 * the record itself unrecoverable.
 */
export function validateSavedView(raw: unknown, now: number = Date.now()): SavedView | null {
  if (!isPlainObject(raw)) return null;

  const clientId = validClientId(raw.clientId);
  if (clientId === null) return null;

  const label = validLabel(raw.label, LABEL_MAX);
  if (label === null) return null;

  const { view, dropped } = recoverDiscoveryView(raw.view);
  const createdAt = validTimestamp(raw.createdAt, now);

  return {
    clientId,
    label,
    view,
    createdAt,
    // A stored `updatedAt` older than `createdAt` is nonsense; the later of the
    // two is the only defensible reading.
    updatedAt: Math.max(createdAt, validTimestamp(raw.updatedAt, createdAt)),
    unavailable: dropped,
  };
}

function validateSide(raw: unknown): SavedComparisonSide | null {
  if (!isPlainObject(raw)) return null;
  const playerId = validPlayerId(raw.playerId);
  if (playerId === null) return null;
  const name = validLabel(raw.name, PLAYER_LABEL_MAX);
  if (name === null) return null;
  return { playerId, name };
}

/** A role key as every ScoutBoy config writes them, or null for Automatic Role. */
function validateRoleKey(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return undefined;
  return /^[a-z0-9_]{1,64}$/.test(raw) ? raw : undefined;
}

/**
 * One stored saved comparison, validated field by field.
 *
 * Rejected outright when it could never be a comparison at all: a missing or
 * non-positive player id, two of the same player, or a role key that is not
 * shaped like one. Whether those players still EXIST is a different question,
 * answered by the API at read time — a device has no way to know, and guessing
 * would delete saved work over a slow network.
 */
export function validateSavedComparison(
  raw: unknown,
  now: number = Date.now(),
): SavedComparison | null {
  if (!isPlainObject(raw)) return null;

  const clientId = validClientId(raw.clientId);
  if (clientId === null) return null;

  const label = validLabel(raw.label, LABEL_MAX);
  if (label === null) return null;

  const playerA = validateSide(raw.playerA);
  const playerB = validateSide(raw.playerB);
  if (playerA === null || playerB === null) return null;
  if (playerA.playerId === playerB.playerId) return null;

  const roleKey = validateRoleKey(raw.roleKey);
  if (roleKey === undefined) return null;

  const createdAt = validTimestamp(raw.createdAt, now);

  return {
    clientId,
    label,
    playerA,
    playerB,
    roleKey,
    createdAt,
    updatedAt: Math.max(createdAt, validTimestamp(raw.updatedAt, createdAt)),
  };
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

export function readSavedViews(now?: number): CollectionRead<SavedView> {
  return readCollection(
    SAVED_VIEWS_KEY,
    (raw) => validateSavedView(raw, now),
    savedViewIdentity,
    COLLECTION_LIMIT,
  );
}

export function readSavedComparisons(now?: number): CollectionRead<SavedComparison> {
  return readCollection(
    SAVED_COMPARISONS_KEY,
    (raw) => validateSavedComparison(raw, now),
    savedComparisonIdentity,
    COLLECTION_LIMIT,
  );
}

/**
 * Persists saved views. Returns whether the write actually landed.
 *
 * `unavailable` is deliberately NOT written back: it is derived at read time from
 * what is currently representable, so persisting it would freeze today's answer
 * into tomorrow's storage and keep reporting a criterion as lost after the
 * config that dropped it came back.
 */
export function writeSavedViews(items: SavedView[]): boolean {
  return writeCollection(
    SAVED_VIEWS_KEY,
    items.map(({ clientId, label, view, createdAt, updatedAt }) => ({
      clientId,
      label,
      view,
      createdAt,
      updatedAt,
    })),
  );
}

export function writeSavedComparisons(items: SavedComparison[]): boolean {
  return writeCollection(SAVED_COMPARISONS_KEY, items);
}

export function clearSavedViews(): boolean {
  return clearCollection(SAVED_VIEWS_KEY);
}

export function clearSavedComparisons(): boolean {
  return clearCollection(SAVED_COMPARISONS_KEY);
}

// ---------------------------------------------------------------------------
// Building new records
// ---------------------------------------------------------------------------

export function makeSavedView(label: string, view: DiscoveryView, now = Date.now()): SavedView {
  return {
    clientId: newClientId(),
    label,
    view,
    createdAt: now,
    updatedAt: now,
    unavailable: [],
  };
}

export function makeSavedComparison(
  label: string,
  playerA: SavedComparisonSide,
  playerB: SavedComparisonSide,
  roleKey: string | null,
  now = Date.now(),
): SavedComparison {
  return {
    clientId: newClientId(),
    label,
    playerA,
    playerB,
    roleKey,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Adds an item, or updates the existing one with the same canonical identity.
 *
 * The existing item keeps its POSITION and its `createdAt` — a scout renaming a
 * view should not watch it jump to the bottom of their list — and takes the new
 * label, because naming it is exactly what they just asked for. Returns the
 * resulting collection and which of the two happened, so the caller can report
 * "saved" or "updated" honestly rather than inferring it from a length change.
 */
/** The three fields every durable saved record carries, whatever else it holds. */
export interface LabelledRecord {
  clientId: string;
  label: string;
  updatedAt: number;
}

export function upsertByIdentity<T extends LabelledRecord>(
  items: T[],
  candidate: T,
  identity: (item: T) => string,
  now = Date.now(),
): { items: T[]; disposition: "created" | "updated" | "unchanged"; item: T } {
  const id = identity(candidate);
  const at = items.findIndex((item) => identity(item) === id);
  if (at === -1) {
    return { items: [...items, candidate], disposition: "created", item: candidate };
  }

  const existing = items[at];
  if (existing.label === candidate.label) {
    return { items, disposition: "unchanged", item: existing };
  }

  const merged = { ...existing, label: candidate.label, updatedAt: now };
  const next = [...items];
  next[at] = merged;
  return { items: next, disposition: "updated", item: merged };
}
