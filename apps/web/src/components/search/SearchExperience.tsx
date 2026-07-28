"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PageHeader, ScopeBanner } from "@/components/common";
import { AGE_BANDS, SCOPE_BANNER, SEARCH_SCOPES } from "@/lib/constants";
import type { SearchFilters } from "@/lib/api/hooks";

import { PlayerSearchFilters } from "./PlayerSearchFilters";
import { PlayerSearchResults } from "./PlayerSearchResults";

const DEFAULT_FILTERS: SearchFilters = {
  scope: "analyzed",
  age_band: "all",
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo<SearchFilters>(() => {
    const scope = searchParams.get("scope") ?? DEFAULT_FILTERS.scope;
    const ageBand = searchParams.get("age_band") ?? DEFAULT_FILTERS.age_band;
    return {
      ...DEFAULT_FILTERS,
      q: searchParams.get("q") || undefined,
      scope: SEARCH_SCOPES.some((s) => s.key === scope) ? scope : DEFAULT_FILTERS.scope,
      age_band: AGE_BANDS.some((a) => a.key === ageBand) ? ageBand : DEFAULT_FILTERS.age_band,
      position_group: searchParams.get("position_group") || undefined,
      role: searchParams.get("role") || undefined,
      league: searchParams.get("league") || undefined,
      playstyle: searchParams.get("playstyle") || undefined,
      min_minutes: numberParam(searchParams.get("min_minutes")),
      rolefit_min: numberParam(searchParams.get("rolefit_min")),
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
      if (key === "age_band" && value === DEFAULT_FILTERS.age_band) return;
      if (key === "sort" && value === DEFAULT_FILTERS.sort) return;
      if (key === "page" && value === DEFAULT_FILTERS.page) return;
      if (key === "page_size" && value === DEFAULT_FILTERS.page_size) return;
      params.set(key, String(value));
    });
    const suffix = params.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
  };

  const selectedScope = SEARCH_SCOPES.find((s) => s.key === filters.scope) ?? SEARCH_SCOPES[0];
  const selectedAge = AGE_BANDS.find((a) => a.key === filters.age_band) ?? AGE_BANDS[0];

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
        <aside className="lg:sticky lg:top-4" aria-label="Discovery filters">
          <PlayerSearchFilters filters={filters} onChange={setFilters} />
        </aside>
        <section aria-label="Results" className="min-w-0">
          <PlayerSearchResults
            filters={filters}
            selectedScope={selectedScope.label}
            selectedAgeBand={selectedAge.label}
            onPage={(page) => setFilters({ ...filters, page })}
          />
        </section>
      </div>
    </div>
  );
}
