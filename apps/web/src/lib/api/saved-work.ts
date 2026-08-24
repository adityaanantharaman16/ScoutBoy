import { apiAuthed } from "./client";

/**
 * The private saved-work surface.
 *
 * Every call takes a freshly minted Clerk token. None of them take a user id: the
 * account is derived server-side from the verified token, so there is no argument
 * this module could pass that would address somebody else's saved work. The
 * `clientId` in a path addresses a row WITHIN the caller's own account.
 *
 * The wire shapes below are snake_case because the API is; the browser-side
 * records are camelCase because the rest of the frontend is. The two mappers at
 * the bottom are the only place that boundary is crossed, so a field rename shows
 * up as one compile error rather than as a silently missing value.
 */

import type { DiscoveryView } from "@/lib/filters/canonical";
import type { SavedComparison, SavedView } from "@/lib/storage/saved-work";
import { recoverDiscoveryView } from "@/lib/filters/canonical";

// -- Wire shapes -------------------------------------------------------------

export interface SavedViewWire {
  client_id: string;
  label: string;
  filters: Record<string, unknown>;
  fingerprint: string;
  created_at: string;
  updated_at: string;
}

export interface SavedComparisonSideWire {
  player_id: number | null;
  label: string;
  available: boolean;
}

export interface SavedComparisonWire {
  client_id: string;
  label: string;
  player_a: SavedComparisonSideWire;
  player_b: SavedComparisonSideWire;
  role_key: string | null;
  fingerprint: string;
  created_at: string;
  updated_at: string;
}

export interface SavedViewsResponse {
  items: SavedViewWire[];
  count: number;
}

export interface SavedComparisonsResponse {
  items: SavedComparisonWire[];
  count: number;
}

export interface MergeRejection {
  client_id: string;
  reason: string;
}

export interface SavedViewsMergeResponse extends SavedViewsResponse {
  added: string[];
  already_present: string[];
  rejected: MergeRejection[];
}

export interface SavedComparisonsMergeResponse extends SavedComparisonsResponse {
  added: string[];
  already_present: string[];
  rejected: MergeRejection[];
}

// -- Saved Discovery views ---------------------------------------------------

export function getSavedViews(token: string): Promise<SavedViewsResponse> {
  return apiAuthed<SavedViewsResponse>("/me/saved-views", token);
}

export function saveView(
  token: string,
  item: { clientId: string; label: string; view: DiscoveryView },
): Promise<SavedViewsResponse> {
  return apiAuthed<SavedViewsResponse>("/me/saved-views", token, {
    method: "POST",
    body: { client_id: item.clientId, label: item.label, filters: item.view },
  });
}

export function renameView(
  token: string,
  clientId: string,
  label: string,
): Promise<SavedViewsResponse> {
  return apiAuthed<SavedViewsResponse>(`/me/saved-views/${clientId}`, token, {
    method: "PATCH",
    body: { label },
  });
}

export function deleteView(token: string, clientId: string): Promise<SavedViewsResponse> {
  return apiAuthed<SavedViewsResponse>(`/me/saved-views/${clientId}`, token, {
    method: "DELETE",
  });
}

export function mergeViews(token: string, items: SavedView[]): Promise<SavedViewsMergeResponse> {
  return apiAuthed<SavedViewsMergeResponse>("/me/saved-views/merge", token, {
    method: "POST",
    body: {
      items: items.map((item) => ({
        client_id: item.clientId,
        label: item.label,
        filters: item.view,
      })),
    },
  });
}

// -- Saved comparison setups -------------------------------------------------

export function getSavedComparisons(token: string): Promise<SavedComparisonsResponse> {
  return apiAuthed<SavedComparisonsResponse>("/me/saved-comparisons", token);
}

function comparisonBody(item: SavedComparison) {
  return {
    client_id: item.clientId,
    label: item.label,
    player_a_id: item.playerA.playerId,
    player_b_id: item.playerB.playerId,
    player_a_label: item.playerA.name,
    player_b_label: item.playerB.name,
    role_key: item.roleKey,
  };
}

export function saveComparison(
  token: string,
  item: SavedComparison,
): Promise<SavedComparisonsResponse> {
  return apiAuthed<SavedComparisonsResponse>("/me/saved-comparisons", token, {
    method: "POST",
    body: comparisonBody(item),
  });
}

export function renameComparison(
  token: string,
  clientId: string,
  label: string,
): Promise<SavedComparisonsResponse> {
  return apiAuthed<SavedComparisonsResponse>(`/me/saved-comparisons/${clientId}`, token, {
    method: "PATCH",
    body: { label },
  });
}

export function deleteComparison(
  token: string,
  clientId: string,
): Promise<SavedComparisonsResponse> {
  return apiAuthed<SavedComparisonsResponse>(`/me/saved-comparisons/${clientId}`, token, {
    method: "DELETE",
  });
}

export function mergeComparisons(
  token: string,
  items: SavedComparison[],
): Promise<SavedComparisonsMergeResponse> {
  return apiAuthed<SavedComparisonsMergeResponse>("/me/saved-comparisons/merge", token, {
    method: "POST",
    body: { items: items.map(comparisonBody) },
  });
}

// -- Wire to browser records -------------------------------------------------

/**
 * An account saved view, as the browser holds it.
 *
 * The filters are re-validated through `recoverDiscoveryView` rather than trusted
 * as-is. That is not distrust of our own API: an account item may have been saved
 * by an older build against a role or playstyle that has since been retired from
 * configuration, so the stale-recovery path has to run for account items exactly
 * as it does for device ones. Skipping it here would leave "part of this view is
 * no longer available" a guest-only behaviour.
 */
export function savedViewFromWire(wire: SavedViewWire): SavedView {
  const { view, dropped } = recoverDiscoveryView(wire.filters);
  const created = Date.parse(wire.created_at);
  const updated = Date.parse(wire.updated_at);
  return {
    clientId: wire.client_id,
    label: wire.label,
    view,
    createdAt: Number.isFinite(created) ? created : 0,
    updatedAt: Number.isFinite(updated) ? updated : 0,
    unavailable: dropped,
  };
}

/**
 * An account saved comparison, as the browser holds it.
 *
 * An unavailable side arrives with `player_id: null`, and that is preserved
 * rather than papered over: the record keeps the name it was saved under so the
 * interface can name the missing participant, and carries no id so nothing can
 * try to open it.
 */
export interface AccountSavedComparison extends Omit<SavedComparison, "playerA" | "playerB"> {
  playerA: { playerId: number | null; name: string; available: boolean };
  playerB: { playerId: number | null; name: string; available: boolean };
}

export function savedComparisonFromWire(wire: SavedComparisonWire): AccountSavedComparison {
  const created = Date.parse(wire.created_at);
  const updated = Date.parse(wire.updated_at);
  return {
    clientId: wire.client_id,
    label: wire.label,
    playerA: {
      playerId: wire.player_a.player_id,
      name: wire.player_a.label,
      available: wire.player_a.available,
    },
    playerB: {
      playerId: wire.player_b.player_id,
      name: wire.player_b.label,
      available: wire.player_b.available,
    },
    roleKey: wire.role_key,
    createdAt: Number.isFinite(created) ? created : 0,
    updatedAt: Number.isFinite(updated) ? updated : 0,
  };
}

/**
 * A device saved comparison, widened to the shape the interface renders.
 *
 * A device has no way to know whether a player still exists — asking would mean a
 * request per participant on every render — so it reports both sides as
 * available. The account path reports the truth the server knows, and the Saved
 * Work list renders whichever it is given. This is the honest reading of a guest
 * collection, and it matches how guest Favorites already treats a stale id:
 * retained, shown, and reported as unresolvable only once something actually
 * tries to load it.
 */
export function deviceComparisonAsAccountShape(item: SavedComparison): AccountSavedComparison {
  return {
    ...item,
    playerA: { playerId: item.playerA.playerId, name: item.playerA.name, available: true },
    playerB: { playerId: item.playerB.playerId, name: item.playerB.name, available: true },
  };
}
