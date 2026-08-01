"use client";

import { AGE_BANDS, POSITION_GROUPS, ROLES, SEARCH_SCOPES, SORT_OPTIONS } from "@/lib/constants";
import type { SearchFilters } from "@/lib/api/hooks";

// Discovery filter rail. It is deliberately subordinate to the results ledger:
// a quiet hairline panel that sits in a narrow left column on desktop and stacks
// above the results on tablet/mobile.
//
// Every control is the same compact, square selector box, so the rail is short
// enough to stay wholly usable inside a normal laptop viewport while sticky —
// no nested scroller, no accordion, no custom combobox. Analysis scope and age
// band are native <select>s carrying exactly the options they always had; scope
// keeps its per-option explanation as restrained helper text beneath the
// selector rather than as three tall option cards. All existing filters, URL
// sync and stable test hooks are preserved.
export function PlayerSearchFilters({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch, page: 1 });

  const scopeKey = filters.scope ?? "analyzed";
  const selectedScope = SEARCH_SCOPES.find((s) => s.key === scopeKey) ?? SEARCH_SCOPES[0];

  return (
    <div className="card space-y-3" data-testid="filter-rail">
      <div className="flex items-center justify-between gap-2">
        <div className="label">Narrow results</div>
        <div className="text-[11px] text-ink-soft">URL-backed</div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <span className="label">Search</span>
          <input
            data-testid="search-input"
            className="input text-base"
            placeholder="Name, club, league…"
            value={filters.q ?? ""}
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>

        {/* Explicit label + description ids: the helper sentence describes the
            control without being absorbed into its accessible name. */}
        <div className="flex flex-col gap-1">
          <label className="label" htmlFor="filter-scope">
            Analysis scope
          </label>
          <select
            id="filter-scope"
            data-testid="scope-filter"
            className="input"
            aria-describedby="filter-scope-help"
            value={scopeKey}
            onChange={(e) => set({ scope: e.target.value })}
          >
            {SEARCH_SCOPES.map((scope) => (
              <option key={scope.key} value={scope.key}>
                {scope.label}
              </option>
            ))}
          </select>
          <p
            id="filter-scope-help"
            className="text-[11px] leading-snug text-ink-soft"
            data-testid="scope-description"
          >
            {selectedScope.description}
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="label">Age band</span>
          <select
            data-testid="age-band-filter"
            className="input"
            value={filters.age_band ?? "all"}
            onChange={(e) => set({ age_band: e.target.value })}
          >
            {AGE_BANDS.map((band) => (
              <option key={band.key} value={band.key}>
                {band.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label">Position group</span>
          <select
            data-testid="position-group-filter"
            className="input"
            value={filters.position_group ?? ""}
            onChange={(e) => set({ position_group: e.target.value || undefined })}
          >
            {POSITION_GROUPS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label">Role</span>
          <select
            data-testid="role-filter"
            className="input"
            value={filters.role ?? ""}
            onChange={(e) => set({ role: e.target.value || undefined })}
          >
            <option value="">Any role (best)</option>
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        {/* The two short numeric thresholds share a row at every breakpoint —
            they are the narrowest controls in the rail and pairing them keeps
            the sticky panel materially shorter. */}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="label">Min minutes</span>
            <input
              type="number"
              className="input"
              value={filters.min_minutes ?? ""}
              onChange={(e) => set({ min_minutes: e.target.value ? Number(e.target.value) : undefined })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="label">Min RoleFit</span>
            <input
              type="number"
              className="input"
              value={filters.rolefit_min ?? ""}
              onChange={(e) => set({ rolefit_min: e.target.value ? Number(e.target.value) : undefined })}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="label">Sort</span>
          <select
            className="input"
            value={filters.sort ?? "rolefit_desc"}
            onChange={(e) => onChange({ ...filters, sort: e.target.value })}
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
