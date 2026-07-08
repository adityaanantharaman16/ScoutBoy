"use client";

import { useState } from "react";

import { ScopeBanner } from "@/components/common";
import { SCOPE_BANNER } from "@/lib/constants";
import type { SearchFilters } from "@/lib/api/hooks";

import { PlayerSearchFilters } from "./PlayerSearchFilters";
import { PlayerSearchResults } from "./PlayerSearchResults";

export function SearchExperience() {
  const [filters, setFilters] = useState<SearchFilters>({
    sort: "rolefit_desc",
    page: 1,
    page_size: 12,
  });

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      <h1 className="mb-1 text-2xl font-bold">Discover players</h1>
      <p className="mb-4 text-sm text-slate-400">
        Search U23 attackers and midfielders, then open a card to see role ratings, playstyles, and
        market context — with the reasoning behind every number.
      </p>
      <div className="mb-4">
        <PlayerSearchFilters filters={filters} onChange={setFilters} />
      </div>
      <PlayerSearchResults filters={filters} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
    </div>
  );
}
