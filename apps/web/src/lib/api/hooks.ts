import { useQuery } from "@tanstack/react-query";

import { apiGet } from "./client";
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

export interface SearchFilters {
  q?: string;
  age_min?: number;
  age_max?: number;
  position_group?: string;
  role?: string;
  league?: string;
  playstyle?: string;
  min_minutes?: number;
  rolefit_min?: number;
  sort?: string;
  page?: number;
  page_size?: number;
}

export function usePlayerSearch(filters: SearchFilters) {
  return useQuery({
    queryKey: ["players", filters],
    queryFn: () => apiGet<Paginated<PlayerSearchCard>>("/players", filters as Record<string, unknown>),
  });
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

export function useAllPlayersLite() {
  // Small helper for the compare selectors: fetch a large first page.
  return useQuery({
    queryKey: ["players-lite"],
    queryFn: () => apiGet<Paginated<PlayerSearchCard>>("/players", { page_size: 100 }),
  });
}
