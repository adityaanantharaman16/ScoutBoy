"use client";

import Link from "next/link";

import { PageHeader, ScopeBanner } from "@/components/common";
import {
  FavoritesPanel,
  favoritesScopeLead,
  useResolvedFavorites,
} from "@/components/saved/FavoritesPanel";
import { SCOPE_BANNER } from "@/lib/constants";
import { favoritesScopeLabel, useScoutingState } from "@/lib/state/scouting-state";

/**
 * The legacy My Favorites route.
 *
 * 8.4B moved this surface into the Saved Work hub at `/saved`, where it is the
 * default section. This route stays, and it RENDERS rather than redirects:
 * existing bookmarks and shared links must not reach a 404, and a redirect would
 * cost a returning scout a navigation and a flash of the wrong page for no
 * benefit. It renders the same `FavoritesPanel` component the hub does — one
 * implementation, so the two surfaces cannot drift — with the page title,
 * heading and copy it has always had.
 *
 * The primary navigation now points at `/saved`, and the pointer below makes the
 * move discoverable from here without changing anything about how this page works.
 */
export default function ShortlistPage() {
  const { favorites } = useScoutingState();
  // The same resolution the panel below is rendering, so the heading's count and
  // the ledger can never disagree about how many players actually resolved.
  const { cards } = useResolvedFavorites();

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      <PageHeader
        eyebrow="My Favorites"
        title="Saved Players"
        lead={favoritesScopeLead(favorites.mode)}
        meta={
          cards.length > 0
            ? `${cards.length} resolved player${cards.length === 1 ? "" : "s"} · ${favoritesScopeLabel(favorites.mode)}`
            : undefined
        }
      />

      <p className="mb-5 text-xs text-ink-soft" data-testid="shortlist-moved-notice">
        My Favorites now lives in{" "}
        <Link href="/saved" className="font-semibold text-pitch-dark">
          Saved
        </Link>
        , alongside your saved Discovery views and saved comparisons.
      </p>

      <FavoritesPanel />
    </div>
  );
}
