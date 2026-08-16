"use client";

import { useEffect, useRef } from "react";

import { ANY_ROLE_LABEL, DEFAULT_SORT, POSITION_GROUPS, ROLES, SORT_OPTIONS } from "@/lib/constants";
import {
  ageBounds,
  ageSelectionFromBounds,
  DEFAULT_DISCOVERY_FILTERS,
  type AgeSelection,
} from "@/lib/filters";
import { activeCriteria, removalPatch, type ActiveCriterion } from "@/lib/filters/criteria";
import type { PlaystyleOption, SearchFilters } from "@/lib/api/hooks";

import { ActiveCriteria } from "./ActiveCriteria";
import { AdvancedFilters } from "./AdvancedFilters";
import { AgeThresholdFilter } from "./AgeThresholdFilter";
import { TextFilterInput } from "./TextFilterInput";

// Discovery filter rail. It is deliberately subordinate to the results ledger:
// a quiet hairline panel that sits in a narrow left column on desktop and stacks
// above the results on tablet/mobile.
//
// ---- Compact information architecture (Phase 8.2) ---------------------------
// One outer panel, divided by internal hairlines into four square regions, in
// this order:
//
//   1. header ............. "Narrow results" + the URL-backed note
//   2. active criteria .... what is narrowing, and how to remove any of it
//                           (absent entirely when nothing is active)
//   3. core controls ...... Search, Age Threshold, Position Group, Role, Sort
//   4. Advanced Filters ... one disclosure row over three compact categories
//
// The panel is built the same way the results ledger is (`divide-y divide-line`
// inside one bordered box) rather than as a stack of cards, so the two columns
// read as two objects of the same kind and their top edges still line up.
//
// The CORE is deliberately five controls. Phase 8.2 exposes seven more filters
// (league, club, nationality, rolefit_max, playstyle, value_min, value_max) and
// moves the two existing specialized thresholds (min_minutes, rolefit_min) out
// of the default view, so the collapsed rail is SHORTER than the six-group rail
// it replaces while the request it can express is twice as expressive. A rail
// that showed all twelve fields at once would not fit a laptop viewport without
// the nested scroller this design forbids.
//
// ---- Responsive composition -------------------------------------------------
// One grid for the core, three column counts, and NO `order` utilities anywhere:
//
//   < sm (up to 639px, incl. 320px)   one column
//   sm .. lg-1 (640-1023px)           two columns
//   lg+ (1024px+)                     one narrow sticky column
//
//   Search .................... full width (spans both columns)
//   Age Threshold ............. full width (spans both columns)
//   Position Group | Role
//   Sort ...................... full width (spans both columns)
//
// The two full-width rows are the only spanning items; the remaining controls
// fall into place from DOM order alone. That matters for more than tidiness:
// because nothing is visually reordered, the tab order is the visual order at
// EVERY width (WCAG 2.2 SC 1.3.2 / 2.4.3), which `order` or `grid-template-areas`
// would have quietly broken. It also means 320px needs no special case — one
// column, same sequence. The advanced categories repeat the same three counts.
export function PlayerSearchFilters({
  filters,
  onChange,
  playstyleOptions = [],
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  /**
   * Playstyle keys + display names from the Methodology contract. Defaulted so
   * the rail can be rendered in isolation; `SearchExperience` supplies the real
   * list (see `usePlaystyleOptions`).
   */
  playstyleOptions?: PlaystyleOption[];
}) {
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch, page: 1 });

  const playstyleLabels = Object.fromEntries(playstyleOptions.map((p) => [p.key, p.label]));
  const criteria = activeCriteria(filters, playstyleLabels);

  // The control is derived from the request's own bounds, so URL hydration and
  // browser back/forward restore it without a second source of truth.
  const ageSelection = ageSelectionFromBounds(filters.age_min, filters.age_max);
  const onAgeChange = (next: AgeSelection) =>
    // `ageBounds` always returns both keys, with the inactive side `undefined`, so
    // switching direction clears the opposite bound from the request and the URL.
    // `age_band` is never written back: a legacy value has already been normalized
    // into these bounds by the time it reaches here.
    set({ ...ageBounds(next), age_band: undefined });

  /**
   * Focus survives a removal (WCAG 2.2 SC 3.2.x / 2.4.3 in spirit: the keyboard
   * user is not dropped onto `<body>`).
   *
   * Removing a criterion unmounts the button that was focused, so the next
   * sensible stop is chosen explicitly: the remove action that slid into that
   * position, else the last one, else Clear All, else the summary toggle, else —
   * once the whole area has gone, which is what Clear All does — the Search box
   * at the top of the rail.
   */
  const railRef = useRef<HTMLDivElement>(null);
  const restoreFocusFrom = useRef<number | null>(null);

  useEffect(() => {
    const index = restoreFocusFrom.current;
    if (index == null) return;
    restoreFocusFrom.current = null;
    const root = railRef.current;
    if (!root) return;
    const removers = Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid^="remove-criterion-"]'),
    );
    const next =
      removers[Math.min(index, removers.length - 1)] ??
      root.querySelector<HTMLElement>('[data-testid="clear-all-filters"]') ??
      root.querySelector<HTMLElement>('[data-testid="active-criteria-toggle"]') ??
      root.querySelector<HTMLElement>('[data-testid="search-input"]');
    next?.focus();
  }, [criteria.length]);

  const removeCriterion = (criterion: ActiveCriterion, index: number) => {
    restoreFocusFrom.current = index;
    // Only this criterion's own parameters, and the page reset `set` supplies.
    // Every unrelated criterion is carried through untouched.
    set(removalPatch(criterion));
  };

  /**
   * The complete reset. Handing the serializer exactly the default request is
   * what produces the clean root URL: every default is omitted, and any legacy
   * `scope` / `universe` / `age_band` the incoming link carried is simply not
   * among the keys written back. Device-local shortlist and compare state lives
   * outside the URL and is untouched.
   */
  const clearAll = () => {
    restoreFocusFrom.current = 0;
    onChange({ ...DEFAULT_DISCOVERY_FILTERS });
  };

  return (
    <div
      ref={railRef}
      className="divide-y divide-line border border-line bg-paper-panel"
      data-testid="filter-rail"
    >
      <div className="flex items-center justify-between gap-2 bg-paper-muted px-4 py-2">
        <div className="label">Narrow results</div>
        <div className="text-[11px] text-ink-soft">URL-backed</div>
      </div>

      <ActiveCriteria criteria={criteria} onRemove={removeCriterion} onClearAll={clearAll} />

      <div className="p-4">
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1"
          data-testid="filter-grid"
        >
          {/* Draft-backed like every free-text predicate: the URL carries the
              trimmed value, the field shows what is being typed. */}
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <TextFilterInput
              label="Search"
              testId="search-input"
              className="input text-base"
              placeholder="Name, club, league…"
              value={filters.q}
              onCommit={(q) => set({ q })}
            />
          </div>

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

          {/* Full width at tablet: Position Group and Role already pair off, so
              spanning Sort keeps the two-column block square instead of leaving a
              hole beside it, and its long option labels get the room they need. */}
          <label className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1">
            <span className="label">Sort</span>
            <select
              data-testid="sort-filter"
              className="input"
              value={filters.sort ?? DEFAULT_SORT}
              // `set`, like every other control: changing the ranking changes which
              // players appear first, so holding the previous page number would show
              // page 4 of a freshly reordered ledger. It used to bypass `set` and keep
              // the stale page. A non-default sort is still not a NARROWING criterion,
              // so it never inflates the active-criteria count.
              onChange={(e) => set({ sort: e.target.value })}
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

      <AdvancedFilters
        filters={filters}
        set={set}
        criteria={criteria}
        playstyleOptions={playstyleOptions}
      />
    </div>
  );
}
