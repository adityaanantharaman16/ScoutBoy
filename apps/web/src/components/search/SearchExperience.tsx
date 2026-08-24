"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { PageHeader, ScopeBanner } from "@/components/common";
import { SaveViewControl } from "@/components/saved/SaveViewControl";
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SEARCH_SCOPE,
  DEFAULT_SORT,
  SCOPE_BANNER,
  SEARCH_SCOPE_KEYS,
} from "@/lib/constants";
import { DEFAULT_DISCOVERY_FILTERS, parsePage } from "@/lib/filters";
import {
  discoveryViewFromFilters,
  discoveryViewFromParams,
  discoveryViewToParams,
} from "@/lib/filters/canonical";
import { activeCriteria } from "@/lib/filters/criteria";
import type { SearchFilters } from "@/lib/api/hooks";
import { usePlaystyleOptions } from "@/lib/api/hooks";

import { PlayerSearchFilters } from "./PlayerSearchFilters";
import { PlayerSearchResults } from "./PlayerSearchResults";

const DEFAULT_FILTERS: SearchFilters = { ...DEFAULT_DISCOVERY_FILTERS };

/**
 * The Analysis Scope a URL carries, validated.
 *
 * Not a Discovery control any more (Phase 8.1A retired it) and deliberately not
 * part of a saved view — but a scope-bearing URL must still load and still mean
 * what it said, so it is validated here and carried through the request. Unknown
 * values fall back to the default rather than reaching the API.
 */
function scopeFromParams(params: URLSearchParams): string {
  const scope = params.get("scope") ?? DEFAULT_SEARCH_SCOPE;
  return (SEARCH_SCOPE_KEYS as readonly string[]).includes(scope) ? scope : DEFAULT_SEARCH_SCOPE;
}

export function SearchExperience() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * The Playstyle filter's options and display names, from the Methodology
   * contract — the same YAML the engine applies badges from. Nothing here is
   * hand-listed, so the select's keys cannot drift from the ones the backend
   * filters by. It resolves independently of the search request, so a slow or
   * failed methodology fetch leaves every other control working.
   */
  const playstyleOptions = usePlaystyleOptions();

  /**
   * The canonical Discovery view this URL means.
   *
   * ONE hydration path, shared with saved views, saved-view identity, device
   * storage and the API contract (see `lib/filters/canonical.ts`). Every
   * normalization the rail needs — legacy `age_band`, off-stop age snapping,
   * single-sided age bounds, coherent inclusive pairs, domain-correct clamping,
   * unrepresentable sort falling back to the default — happens in there, so a
   * hard load, a back/forward restore and a reopened saved view cannot produce
   * three different states from the same parameters.
   */
  const view = useMemo(
    () => discoveryViewFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const filters = useMemo<SearchFilters>(() => {
    const params = new URLSearchParams(searchParams.toString());
    return {
      ...DEFAULT_FILTERS,
      ...view,
      // The three request fields a canonical view deliberately does not carry.
      scope: scopeFromParams(params),
      sort: view.sort ?? DEFAULT_SORT,
      page_size: view.page_size ?? DEFAULT_PAGE_SIZE,
      page: parsePage(params.get("page")) ?? DEFAULT_PAGE,
    };
  }, [searchParams, view]);

  const setFilters = (next: SearchFilters) => {
    // Serialized through the SAME canonicalizer that parsed it, so the URL the
    // rail writes and the URL a saved view opens are byte-identical for the same
    // cohort. Before this, the two derived their own default-omission rules and
    // could disagree about whether `?sort=rolefit_desc` was part of the view.
    const params = discoveryViewToParams(discoveryViewFromFilters(next as Record<string, unknown>));

    // Page and scope are request state, not view state, so they are appended
    // here. Both are omitted at their defaults, which is what keeps the root URL
    // clean and keeps a saved view's href free of a page number.
    if (next.page != null && next.page !== DEFAULT_PAGE) params.set("page", String(next.page));
    const scope = next.scope ?? DEFAULT_SEARCH_SCOPE;
    if (scope !== DEFAULT_SEARCH_SCOPE) params.set("scope", scope);

    const suffix = params.toString();
    const url = suffix ? `${pathname}?${suffix}` : pathname;

    /**
     * `window.history.replaceState`, not `router.replace`.
     *
     * Discovery is a statically generated route. After a HARD load of a
     * filter-bearing URL (`/?age_max=25`, `/?q=Anton`, a legacy `/?scope=...` —
     * exactly the shared links the filters produce), `router.replace` to the same
     * pathname with different search params was silently dropped: the address bar
     * never moved and every control in the rail stopped responding, so a shared
     * filtered link arrived read-only. It only worked when the visit started at a
     * bare `/`. Reproduced against a production build for the age control, the
     * search box and the pre-existing `scope` parameter alike, so this is the
     * mechanism failing rather than any one filter.
     *
     * Next.js supports the native History methods for exactly this case and keeps
     * `usePathname` / `useSearchParams` in sync with them, so the URL-backed flow
     * is unchanged in every respect that matters: same URLs, same replace
     * semantics (a filter change still adds no history entry), same hydration on
     * reload and on back/forward, and no scroll jump.
     *
     * Replace-style is also what keeps typing cheap: a search needle or an
     * asking-price bound is a keystroke-per-render control, and pushing would
     * leave one history entry per character.
     */
    window.history.replaceState(null, "", url);
  };

  /**
   * The active narrowing criteria, derived ONCE here from the same request the
   * rail and the ledger are both looking at, so the rail's count and the ledger
   * header's count cannot disagree. Sort, pagination and the retired analysis
   * scope are deliberately not criteria — see `lib/filters/criteria.ts`.
   */
  const criteriaCount = activeCriteria(
    filters,
    Object.fromEntries(playstyleOptions.map((p) => [p.key, p.label])),
  ).length;

  /**
   * The URL follows the page the API actually served.
   *
   * A shared or hand-edited `?page=99` is a valid request; the API answers it with
   * the last page that exists and reports which one that was. Rewriting the URL to
   * that page keeps the address honest and makes reload and back/forward land on the
   * same ledger. It is the same replace-style write as any other filter change, so
   * no history entry is added and the scroll position is untouched, and the response
   * is already cached under the canonical page (see `usePlayerSearch`), so this does
   * not re-fetch. It converges immediately: the canonical page IS in range, so the
   * next response reports it unchanged and the effect stops firing.
   */
  const syncCanonicalPage = (page: number) => setFilters({ ...filters, page });

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      <PageHeader
        eyebrow="Player discovery"
        title="Discover players"
        lead="Scan the available player pool and narrow it down. Detailed RoleFit analysis is shown only where evidence supports it."
        /**
         * Save view lives in the heading's existing control slot.
         *
         * Not in the FILTER RAIL: it is 248px wide and already intentionally
         * dense, and adding collection management there would push the controls a
         * scout came for below the fold.
         *
         * Not in a new bar above the ledger either, which is the more obvious
         * "results-level" spot: the ledger's own count header is deliberately
         * INSIDE its bordered container precisely so the rail and the ledger start
         * at the same y on desktop without a faked spacer. A row above the ledger
         * would reintroduce exactly the misalignment that arrangement exists to
         * avoid.
         *
         * This slot is always present, so a cohort with no matches — the case
         * where coming back later matters most — can still be saved.
         */
        aside={
          <div className="flex justify-start sm:justify-end">
            <SaveViewControl view={view} />
          </div>
        }
      />
      {/* Filter rail (subordinate) beside the results ledger on desktop; stacked
          above the ledger on tablet/mobile. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] lg:items-start">
        {/* Sticky only from lg up, at the existing restrained offset, and only
            while the rail is compact — `.filter-column` releases to normal flow
            whenever a disclosure region is showing, because a sticky box taller
            than the scrollport would pin its own overflow out of reach and the
            alternative (a nested rail scroller) is not allowed. Below lg the
            column stays in normal document flow above the results ledger.
            `lg:items-start` on the grid keeps this item content-height, which is
            what makes `position: sticky` take effect at all. */}
        <aside
          // Grid items default to `min-width: auto`. On Linux Chromium's classic
          // scrollbar layout, the expanded active-criteria row made this item's
          // min-content width 15px wider than a 390px viewport. Let the rail shrink
          // inside the single mobile grid track; its own children already truncate
          // or wrap deliberately.
          className="filter-column min-w-0"
          aria-label="Discovery filters"
          data-testid="filter-column"
        >
          <PlayerSearchFilters
            filters={filters}
            onChange={setFilters}
            playstyleOptions={playstyleOptions}
          />
        </aside>
        <section aria-label="Results" className="min-w-0">
          <PlayerSearchResults
            filters={filters}
            criteriaCount={criteriaCount}
            onPage={(page) => setFilters({ ...filters, page })}
            onCanonicalPage={syncCanonicalPage}
          />
        </section>
      </div>
    </div>
  );
}
