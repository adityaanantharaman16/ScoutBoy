"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { PageHeader, ScopeBanner } from "@/components/common";
import { DEFAULT_SEARCH_SCOPE, SCOPE_BANNER, SEARCH_SCOPE_KEYS } from "@/lib/constants";
import {
  ageBounds,
  ageSelectionFromBounds,
  ageSummaryText,
  legacyAgeBandSelection,
  parseAgeBound,
  parseThreshold,
} from "@/lib/filters";
import type { SearchFilters } from "@/lib/api/hooks";

import { PlayerSearchFilters } from "./PlayerSearchFilters";
import { PlayerSearchResults } from "./PlayerSearchResults";

const DEFAULT_FILTERS: SearchFilters = {
  scope: DEFAULT_SEARCH_SCOPE,
  sort: "rolefit_desc",
  page: 1,
  page_size: 12,
};

function numberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function SearchExperience() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo<SearchFilters>(() => {
    const scope = searchParams.get("scope") ?? DEFAULT_SEARCH_SCOPE;

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

    return {
      ...DEFAULT_FILTERS,
      q: searchParams.get("q") || undefined,
      // Not a Discovery control any more, but a scope-bearing URL must still load
      // and still mean what it said. Unknown values fall back to the default.
      scope: (SEARCH_SCOPE_KEYS as readonly string[]).includes(scope)
        ? scope
        : DEFAULT_SEARCH_SCOPE,
      ...ageBounds(ageSelection),
      position_group: searchParams.get("position_group") || undefined,
      role: searchParams.get("role") || undefined,
      league: searchParams.get("league") || undefined,
      playstyle: searchParams.get("playstyle") || undefined,
      // Clamped on the way in as well as on the way out: a hand-crafted
      // ?rolefit_min=-5 or ?min_minutes=500 never reaches the API unbounded.
      min_minutes: parseThreshold(searchParams.get("min_minutes")),
      rolefit_min: parseThreshold(searchParams.get("rolefit_min")),
      sort: searchParams.get("sort") || DEFAULT_FILTERS.sort,
      page: numberParam(searchParams.get("page")) ?? DEFAULT_FILTERS.page,
      page_size: numberParam(searchParams.get("page_size")) ?? DEFAULT_FILTERS.page_size,
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
     */
    window.history.replaceState(null, "", url);
  };

  const ageSummary = ageSummaryText(ageSelectionFromBounds(filters.age_min, filters.age_max));

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
        {/* Sticky only from lg up, at the existing restrained offset. Below lg the
            column stays in normal document flow above the results ledger.
            `lg:items-start` on the grid keeps this item content-height, which is
            what makes `position: sticky` take effect at all. */}
        <aside
          className="lg:sticky lg:top-4"
          aria-label="Discovery filters"
          data-testid="filter-column"
        >
          <PlayerSearchFilters filters={filters} onChange={setFilters} />
        </aside>
        <section aria-label="Results" className="min-w-0">
          <PlayerSearchResults
            filters={filters}
            ageSummary={ageSummary}
            onPage={(page) => setFilters({ ...filters, page })}
          />
        </section>
      </div>
    </div>
  );
}
