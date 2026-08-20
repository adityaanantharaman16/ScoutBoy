import { apiAuthed } from "./client";
import type {
  FavoriteMutationResponse,
  FavoritesMergeResponse,
  FavoritesResponse,
} from "./types";

/**
 * The private favourites surface, typed against the generated contract.
 *
 * Every call takes a freshly minted Clerk token. None of them take a user id:
 * the account is derived server-side from the verified token, so there is no
 * argument this module could pass that would address somebody else's list.
 */

export function getFavorites(token: string): Promise<FavoritesResponse> {
  return apiAuthed<FavoritesResponse>("/me/favorites", token);
}

export function addFavorite(token: string, playerId: number): Promise<FavoriteMutationResponse> {
  return apiAuthed<FavoriteMutationResponse>(`/me/favorites/${playerId}`, token, {
    method: "PUT",
  });
}

export function removeFavorite(token: string, playerId: number): Promise<FavoriteMutationResponse> {
  return apiAuthed<FavoriteMutationResponse>(`/me/favorites/${playerId}`, token, {
    method: "DELETE",
  });
}

export function mergeFavorites(
  token: string,
  playerIds: number[],
): Promise<FavoritesMergeResponse> {
  return apiAuthed<FavoritesMergeResponse>("/me/favorites/merge", token, {
    method: "POST",
    body: { player_ids: playerIds },
  });
}
