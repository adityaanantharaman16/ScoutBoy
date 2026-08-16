import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { apiGet } from "./client";
import type { operations } from "./schema.gen";
import type {
  CompareResponse,
  Methodology,
  Paginated,
  PlayerCard,
  PlayerPlaystylesResponse,
  PlayerSearchCard,
  RoleLeaderboard,
  RoleRatingDetail,
  SimilarResponse,
} from "./types";

/** Every query parameter `GET /players` accepts, straight from the generated contract. */
type PlayerSearchQuery = NonNullable<
  operations["search_players_api_players_get"]["parameters"]["query"]
>;

/**
 * The Discovery request, DERIVED from the generated operation rather than
 * hand-listed beside it.
 *
 * The previous handwritten interface had silently fallen behind the API: `club`,
 * `nationality`, `rolefit_max`, `value_min`, `value_max` and `universe` all existed
 * as real parameters with no way to express them, and nothing would have caught a
 * renamed or retyped one. Deriving from `operations` makes any such change a compile
 * error here instead. Only the nullability differs: the client omits a parameter it
 * has no value for rather than sending an explicit null.
 */
export type SearchFilters = {
  [K in keyof PlayerSearchQuery]?: Exclude<PlayerSearchQuery[K], null>;
};

/** The one query-key shape for a player search, so callers can address a cached page. */
export function playerSearchQueryKey(filters: SearchFilters) {
  return ["players", filters] as const;
}

export function usePlayerSearch(filters: SearchFilters) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: playerSearchQueryKey(filters),
    queryFn: () =>
      apiGet<Paginated<PlayerSearchCard>>("/players", filters as Record<string, unknown>),
  });

  /**
   * Out-of-range page canonicalization, without a second round trip.
   *
   * A valid request for a page past the end is answered with the LAST available
   * page, and the response says which page that was. The surface then rewrites the
   * URL to it — which changes these filters, and so would normally start a fresh
   * request for a page we are already holding, dropping the ledger to a skeleton on
   * the way. Seeding the canonical key with the response we already have makes that
   * render resolve from cache: no duplicate fetch, no skeleton flash, no scroll jump.
   */
  const served = query.data?.page;
  useEffect(() => {
    if (served == null || served === (filters.page ?? 1)) return;
    queryClient.setQueryData(playerSearchQueryKey({ ...filters, page: served }), query.data);
    // `query.data` is the value being copied; `served` identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [served, filters, queryClient]);

  return query;
}

export function usePlayer(id: number | null) {
  return useQuery({
    queryKey: ["player", id],
    queryFn: () => apiGet<PlayerCard>(`/players/${id}`),
    enabled: id != null,
  });
}

export function usePlayerRatings(id: number | null) {
  return useQuery({
    queryKey: ["player-ratings", id],
    queryFn: () => apiGet<RoleRatingDetail>(`/players/${id}/ratings`),
    enabled: id != null,
  });
}

export function usePlayerPlaystyles(id: number | null) {
  return useQuery({
    queryKey: ["player-playstyles", id],
    queryFn: () => apiGet<PlayerPlaystylesResponse>(`/players/${id}/playstyles`),
    enabled: id != null,
  });
}

export function usePlayerSimilar(id: number | null) {
  return useQuery({
    queryKey: ["player-similar", id],
    queryFn: () => apiGet<SimilarResponse>(`/players/${id}/similar`),
    enabled: id != null,
  });
}

export function useRoleLeaderboard(roleKey: string, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ["role-leaderboard", roleKey, params],
    queryFn: () => apiGet<RoleLeaderboard>(`/roles/${roleKey}/rankings`, params),
    enabled: !!roleKey,
  });
}

export function useCompare(a: number | null, b: number | null, roleKey?: string) {
  return useQuery({
    queryKey: ["compare", a, b, roleKey],
    queryFn: () =>
      apiGet<CompareResponse>("/compare", { player_a: a, player_b: b, role_key: roleKey }),
    enabled: a != null && b != null && a !== b,
  });
}

export function useMethodology() {
  return useQuery({
    queryKey: ["methodology"],
    queryFn: () => apiGet<Methodology>("/methodology"),
  });
}

/** One playstyle option: the query-parameter value and its display name. */
export interface PlaystyleOption {
  key: string;
  label: string;
}

/**
 * The Playstyle filter's options, read from the Methodology contract.
 *
 * `GET /methodology` serializes `configs/playstyles/playstyles_v1.yaml`, which is
 * the same file the rating engine applies badges from, so it is the single source
 * of truth for playstyle keys and display names. A hand-written list in the
 * frontend would be a second copy free to drift from the one the backend actually
 * filters by.
 *
 * `positives` only. `concerns` are a separate, deliberately unfilterable list:
 * `playstyle=<key>` matches a QUALIFYING positive badge (`is_concern = false`),
 * so offering a concern here would silently return nothing.
 */
export function usePlaystyleOptions(): PlaystyleOption[] {
  const { data } = useMethodology();
  return useMemo(
    () => (data?.playstyles ?? []).map((p) => ({ key: p.key, label: p.display_name })),
    [data],
  );
}

export function useAllPlayersLite() {
  // Small helper for the compare selectors: fetch a large first page.
  return useQuery({
    queryKey: ["players-lite"],
    queryFn: () => apiGet<Paginated<PlayerSearchCard>>("/players", { page_size: 100 }),
  });
}

export function usePlayersByIds(ids: number[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ["player", id],
      queryFn: () => apiGet<PlayerCard>(`/players/${id}`),
      enabled: Number.isInteger(id) && id > 0,
      staleTime: 30_000,
      retry: 1,
    })),
  });
}
