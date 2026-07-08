"use client";

import { POSITION_GROUPS, ROLES, SORT_OPTIONS } from "@/lib/constants";
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
    <div className="card grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="flex flex-col gap-1">
        <span className="label">Search</span>
        <input
          data-testid="search-input"
          className="rounded bg-pitch-700 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
          placeholder="Name, club, league…"
          value={filters.q ?? ""}
          onChange={(e) => set({ q: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="label">Position group</span>
        <select
          className="rounded bg-pitch-700 px-2 py-1.5 text-sm"
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
          className="rounded bg-pitch-700 px-2 py-1.5 text-sm"
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
          className="rounded bg-pitch-700 px-2 py-1.5 text-sm"
          value={filters.min_minutes ?? ""}
          onChange={(e) => set({ min_minutes: e.target.value ? Number(e.target.value) : undefined })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="label">Min RoleFit</span>
        <input
          type="number"
          className="rounded bg-pitch-700 px-2 py-1.5 text-sm"
          value={filters.rolefit_min ?? ""}
          onChange={(e) => set({ rolefit_min: e.target.value ? Number(e.target.value) : undefined })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="label">Sort</span>
        <select
          className="rounded bg-pitch-700 px-2 py-1.5 text-sm"
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
  );
}
