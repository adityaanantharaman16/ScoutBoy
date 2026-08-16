"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { PageHeader, ScopeBanner } from "@/components/common";
import { SCOPE_BANNER, SEARCH_SCOPE_KEYS } from "@/lib/constants";
import {
  ageBounds,
  ageSelectionFromBounds,
  coherentBounds,
  DEFAULT_DISCOVERY_FILTERS,
  legacyAgeBandSelection,
  parseAgeBound,
  parseAskingEur,
  parseMinutesThreshold,
  parsePage,
  parsePageSize,
  parseRoleFitThreshold,
  parseSortOption,
  parseTextFilter,
} from "@/lib/filters";
import { activeCriteria } from "@/lib/filters/criteria";
import type { SearchFilters } from "@/lib/api/hooks";
import { usePlaystyleOptions } from "@/lib/api/hooks";

import { PlayerSearchFilters } from "./PlayerSearchFilters";
import { PlayerSearchResults } from "./PlayerSearchResults";

const DEFAULT_FILTERS: SearchFilters = { ...DEFAULT_DISCOVERY_FILTERS };

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

  const filters = useMemo<SearchFilters>(() => {
    const scope = searchParams.get("scope") ?? DEFAULT_DISCOVERY_FILTERS.scope;

    // Age hydration, in precedence order:
    //   1. explicit age_min / age_max (what the control writes)
    //   2. a legacy age_band, normalized once into a one-sided threshold
    //   3. no age bound at all
    // Whichever wins is re-expressed through `ageBounds`, so the request can only
    // ever carry a snapped, single-sided bound — never an off-stop value, never
    // both sides, and never `age_band` itself.
    const explicitAge = ageSelectionFromBounds(
      parseAgeBound(searchParams.get("age_min")),
      parseAgeBound(searchParams.get("age_max")),
    );
    const ageSelection =
      explicitAge.direction != null
        ? explicitAge
        : (legacyAgeBandSelection(searchParams.get("age_band")) ?? explicitAge);

    // Inclusive pairs are made coherent on the way in, not just on the way out.
    // A hand-crafted `?rolefit_min=80&rolefit_max=20` (or the market equivalent,
    // which the API answers with a 422) has no edited side, so the documented
    // rule treats the MINIMUM as authoritative and raises the ceiling to it. The
    // control, the active summary and the request therefore all read 80-80, and
    // the next interaction writes that canonical pair back to the URL.
    const roleFit = coherentBounds(
      parseRoleFitThreshold(searchParams.get("rolefit_min")),
      parseRoleFitThreshold(searchParams.get("rolefit_max")),
      "min",
    );
    const asking = coherentBounds(
      parseAskingEur(searchParams.get("value_min")),
      parseAskingEur(searchParams.get("value_max")),
      "min",
    );

    return {
      ...DEFAULT_FILTERS,
      q: parseTextFilter(searchParams.get("q")),
      // Not a Discovery control any more, but a scope-bearing URL must still load
      // and still mean what it said. Unknown values fall back to the default.
      scope: (SEARCH_SCOPE_KEYS as readonly string[]).includes(scope)
        ? scope
        : DEFAULT_DISCOVERY_FILTERS.scope,
      ...ageBounds(ageSelection),
      position_group: searchParams.get("position_group") || undefined,
      role: searchParams.get("role") || undefined,
      // Phase 8.2 Context group. Case-insensitive substring for league and club,
      // case-insensitive EQUALITY for nationality — the backend's own semantics;
      // nothing is re-filtered in the browser.
      league: parseTextFilter(searchParams.get("league")),
      club: parseTextFilter(searchParams.get("club")),
      nationality: parseTextFilter(searchParams.get("nationality")),
      playstyle: parseTextFilter(searchParams.get("playstyle")),
      // Clamped on the way in as well as on the way out, through the parser for the
      // right DOMAIN in each case: a hand-crafted ?rolefit_min=-5 or
      // ?min_minutes=25000 never reaches the API unbounded, and a realistic
      // ?min_minutes=1500 is no longer crushed to 99 by a RoleFit-shaped ceiling.
      min_minutes: parseMinutesThreshold(searchParams.get("min_minutes")),
      rolefit_min: roleFit.min,
      rolefit_max: roleFit.max,
      // Absolute EUR, exactly as the API contract states. The rail types these in
      // millions; the conversion happens in the control, never in the URL.
      value_min: asking.min,
      value_max: asking.max,
      // Unknown or unrepresentable values are replaced by the defaults rather than
      // forwarded, so the API never sees a request the rail cannot also display.
      sort: parseSortOption(searchParams.get("sort")),
      page: parsePage(searchParams.get("page")) ?? DEFAULT_FILTERS.page,
      page_size: parsePageSize(searchParams.get("page_size")) ?? DEFAULT_FILTERS.page_size,
    };
  }, [searchParams]);

  const setFilters = (next: SearchFilters) => {
    const params = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => {
      if (value == null || value === "") return;
      if (key === "scope" && value === DEFAULT_FILTERS.scope) return;
      if (key === "sort" && value === DEFAULT_FILTERS.sort) return;
      if (key === "page" && value === DEFAULT_FILTERS.page) return;
      if (key === "page_size" && value === DEFAULT_FILTERS.page_size) return;
      params.set(key, String(value));
    });
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
          className="filter-column"
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
