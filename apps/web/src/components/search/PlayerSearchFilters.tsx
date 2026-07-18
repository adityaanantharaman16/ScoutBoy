"use client";

import { AGE_BANDS, POSITION_GROUPS, ROLES, SEARCH_SCOPES, SORT_OPTIONS } from "@/lib/constants";
import type { SearchFilters } from "@/lib/api/hooks";

export function PlayerSearchFilters({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch, page: 1 });

  return (
    <div className="card space-y-5">
      <div>
        <div className="mb-1 label">Analysis scope</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="scope-filter">
          {SEARCH_SCOPES.map((scope) => (
            <button
              key={scope.key}
              type="button"
              className={`border px-3 py-2 text-left text-sm ${
                (filters.scope ?? "analyzed") === scope.key
                  ? "border-pitch bg-[#e9f0ea] text-pitch-dark"
                  : "border-line bg-paper-panel text-ink-muted"
              }`}
              style={{ borderRadius: 5 }}
              onClick={() => set({ scope: scope.key })}
            >
              <span className="block font-medium">{scope.label}</span>
              <span className="block text-xs text-ink-soft">{scope.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 label">Age band</div>
        <div className="flex flex-wrap gap-2" data-testid="age-band-filter">
          {AGE_BANDS.map((band) => (
            <button
              key={band.key}
              type="button"
              className={`border px-3 py-1.5 text-sm font-semibold ${
                (filters.age_band ?? "all") === band.key
                  ? "border-pitch bg-[#e9f0ea] text-pitch-dark"
                  : "border-line bg-paper-panel text-ink-muted"
              }`}
              style={{ borderRadius: 999 }}
              onClick={() => set({ age_band: band.key })}
            >
              {band.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="flex flex-col gap-1">
        <span className="label">Search</span>
        <input
          data-testid="search-input"
          className="input"
          placeholder="Name, club, league…"
          value={filters.q ?? ""}
          onChange={(e) => set({ q: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="label">Position group</span>
        <select
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
