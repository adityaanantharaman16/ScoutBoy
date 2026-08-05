"use client";

import { ANY_ROLE_LABEL, POSITION_GROUPS, ROLES, SORT_OPTIONS } from "@/lib/constants";
import {
  ageBounds,
  ageSelectionFromBounds,
  parseThreshold,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  type AgeSelection,
} from "@/lib/filters";
import type { SearchFilters } from "@/lib/api/hooks";

import { AgeThresholdFilter } from "./AgeThresholdFilter";

// Discovery filter rail. It is deliberately subordinate to the results ledger:
// a quiet hairline panel that sits in a narrow left column on desktop and stacks
// above the results on tablet/mobile.
//
// Every control is the same compact, square box, so the rail is short enough to
// stay wholly usable inside a normal laptop viewport while sticky — no nested
// scroller, no accordion, no custom combobox. Position group, role and sort are
// native <select>s carrying exactly the options they always had; age is the
// five-stop threshold control that took over the space the retired Analysis Scope
// selector used to occupy. All remaining filters, the URL sync and the stable test
// hooks are preserved.
//
// ---- Responsive composition -------------------------------------------------
// One grid, three column counts, and NO `order` utilities anywhere:
//
//   < sm (up to 639px, incl. 320px)   one column
//   sm .. lg-1 (640-1023px)           two columns
//   lg+ (1024px+)                     one narrow sticky column
//
//   Search .................... full width (spans both columns)
//   Age Threshold ............. full width (spans both columns)
//   Position Group | Min Minutes + Min RoleFit
//   Role           | Sort
//
// The two full-width rows are the only spanning items; the four remaining
// controls fall into place from DOM order alone. That matters for more than
// tidiness: because nothing is visually reordered, the tab order is the visual
// order at EVERY width (WCAG 2.2 SC 1.3.2 / 2.4.3), which `order` or
// `grid-template-areas` would have quietly broken. It also means 320px needs no
// special case — one column, same sequence.
//
// The numeric pair and its helper sentence are ONE grid item, so the helper can
// never land in a cell of its own and leave a hole beside it.
export function PlayerSearchFilters({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch, page: 1 });

  // The control is derived from the request's own bounds, so URL hydration and
  // browser back/forward restore it without a second source of truth.
  const ageSelection = ageSelectionFromBounds(filters.age_min, filters.age_max);
  const onAgeChange = (next: AgeSelection) =>
    // `ageBounds` always returns both keys, with the inactive side `undefined`, so
    // switching direction clears the opposite bound from the request and the URL.
    // `age_band` is never written back: a legacy value has already been normalized
    // into these bounds by the time it reaches here.
    set({ ...ageBounds(next), age_band: undefined });

  return (
    <div className="card space-y-3" data-testid="filter-rail">
      <div className="flex items-center justify-between gap-2">
        <div className="label">Narrow results</div>
        <div className="text-[11px] text-ink-soft">URL-backed</div>
      </div>

      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1"
        data-testid="filter-grid"
      >
        <label className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <span className="label">Search</span>
          <input
            data-testid="search-input"
            className="input text-base"
            placeholder="Name, club, league…"
            value={filters.q ?? ""}
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>

        {/* Full width below lg so the rail stretches edge to edge and nothing is
            stranded beside it; back to the single narrow column at lg. */}
        <AgeThresholdFilter
          selection={ageSelection}
          onChange={onAgeChange}
          className="sm:col-span-2 lg:col-span-1"
        />

        <label className="flex min-w-0 flex-col gap-1">
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

        {/* The two short numeric thresholds share a row at every breakpoint —
            they are the narrowest controls in the rail and pairing them keeps
            the sticky panel materially shorter. The helper sentence is inside
            this same grid item, structurally attached to the inputs it
            describes, so it cannot occupy a cell of its own.

            Both are bounded to whole numbers 0-99 semantically (`min`/`max`/`step`)
            AND deterministically in the handler, so a pasted, typed or
            URL-supplied value outside the range is clamped before it can reach a
            request. An empty field stays empty ("no threshold"); a typed 0 stays 0
            and is never mistaken for empty. */}
        <div className="flex min-w-0 flex-col gap-1.5" data-testid="threshold-pair">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="label">Min minutes</span>
              <input
                type="number"
                inputMode="numeric"
                className="input"
                min={THRESHOLD_MIN}
                max={THRESHOLD_MAX}
                step={1}
                aria-describedby="filter-threshold-help"
                value={filters.min_minutes ?? ""}
                onChange={(e) => set({ min_minutes: parseThreshold(e.target.value) })}
              />
            </label>

            <label className="flex min-w-0 flex-col gap-1">
              <span className="label">Min RoleFit</span>
              <input
                type="number"
                inputMode="numeric"
                className="input"
                min={THRESHOLD_MIN}
                max={THRESHOLD_MAX}
                step={1}
                aria-describedby="filter-threshold-help"
                value={filters.rolefit_min ?? ""}
                onChange={(e) => set({ rolefit_min: parseThreshold(e.target.value) })}
              />
            </label>
          </div>
          <p id="filter-threshold-help" className="text-[11px] leading-snug text-ink-soft">
            Whole numbers {THRESHOLD_MIN}-{THRESHOLD_MAX}. Leave blank for no threshold.
          </p>
        </div>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="label">Role</span>
          <select
            data-testid="role-filter"
            className="input"
            value={filters.role ?? ""}
            onChange={(e) => set({ role: e.target.value || undefined })}
          >
            <option value="">{ANY_ROLE_LABEL}</option>
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="label">Sort</span>
          <select
            data-testid="sort-filter"
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
