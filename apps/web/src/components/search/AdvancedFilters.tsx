"use client";

import { useState } from "react";

import { ANY_PLAYSTYLE_LABEL } from "@/lib/constants";
import {
  coherentBounds,
  MIN_MINUTES_CEILING,
  MIN_MINUTES_FLOOR,
  parseMinutesThreshold,
  parseRoleFitThreshold,
  ROLEFIT_SCALE_MAX,
  ROLEFIT_SCALE_MIN,
} from "@/lib/filters";
import {
  ADVANCED_CATEGORIES,
  countAdvanced,
  countInGroup,
  firstActiveCategory,
  type ActiveCriterion,
  type AdvancedCategoryKey,
} from "@/lib/filters/criteria";
import type { PlaystyleOption, SearchFilters } from "@/lib/api/hooks";

import { AskingPriceInput } from "./AskingPriceInput";
import { FilterDisclosure } from "./FilterDisclosure";
import { TextFilterInput } from "./TextFilterInput";

const REGION_ID = "advanced-filters-region";

/**
 * Specialized Discovery criteria, behind progressive disclosure.
 *
 * The rail's always-visible core is Search, Age Threshold, Position Group, Role
 * and Sort. Everything else lives here, in three compact categories, because a
 * rail that shows all twelve fields at once is neither calm nor scannable and
 * does not fit a laptop viewport without a nested scroller.
 *
 * Two rules govern the nesting:
 *
 *  1. **Only one category is expanded at a time.** Opening Market closes
 *     Context. That keeps the expanded rail roughly one category tall however
 *     many criteria are in play.
 *  2. **Closing never clears.** Every field is derived from URL-backed request
 *     state, so collapsing a category is pure presentation: no value changes, no
 *     URL write, no refetch. The category's own count keeps reporting what is
 *     active inside it while it is shut.
 *
 * The open/closed state is local React state, deliberately NOT in the URL —
 * a shared link describes a filtered cohort, not which drawer the sender had
 * open. It is seeded once, at mount, from the hydrated request: a hard-loaded
 * compound URL opens Advanced Filters onto the first category it is actually
 * using, so nothing is active-but-invisible.
 *
 * Both regions stay in the DOM and are toggled with the `hidden` attribute, so
 * every `aria-controls` reference resolves in both states and no field is
 * focusable while its category is shut.
 */
export function AdvancedFilters({
  filters,
  set,
  criteria,
  playstyleOptions,
}: {
  filters: SearchFilters;
  /** The rail's page-resetting patch helper. */
  set: (patch: Partial<SearchFilters>) => void;
  /** Every active criterion, for the disclosure and per-category counts. */
  criteria: ActiveCriterion[];
  /** Playstyle keys + display names, from the Methodology contract. */
  playstyleOptions: PlaystyleOption[];
}) {
  const advancedCount = countAdvanced(criteria);

  const [open, setOpen] = useState(() => advancedCount > 0);
  const [openCategory, setOpenCategory] = useState<AdvancedCategoryKey | null>(
    () => firstActiveCategory(criteria) ?? "context",
  );

  // ---- range-safe pairs ---------------------------------------------------
  // One rule, stated in `coherentBounds`: the edited bound wins and its
  // companion follows, so `min > max` cannot reach the API and the control, the
  // URL, the active summary and the request are written in the same update.
  const setRoleFit = (raw: string, edited: "min" | "max") => {
    const parsed = parseRoleFitThreshold(raw);
    const { min, max } = coherentBounds(
      edited === "min" ? parsed : filters.rolefit_min,
      edited === "max" ? parsed : filters.rolefit_max,
      edited,
    );
    set({ rolefit_min: min, rolefit_max: max });
  };

  // The asking fields commit absolute EUR (or `undefined` to clear); their raw text
  // draft lives in the control, so a half-typed decimal never reaches this point.
  const setAsking = (eur: number | undefined, edited: "min" | "max") => {
    const { min, max } = coherentBounds(
      edited === "min" ? eur : filters.value_min,
      edited === "max" ? eur : filters.value_max,
      edited,
    );
    set({ value_min: min, value_max: max });
  };

  const fieldsHidden = (key: AdvancedCategoryKey) => openCategory !== key;

  return (
    <div data-testid="advanced-filters">
      <FilterDisclosure
        controls={REGION_ID}
        label="Advanced Filters"
        open={open}
        count={advancedCount}
        onToggle={() => setOpen((was) => !was)}
        testId="advanced-filters-toggle"
      />

      {/* `filter-region` marks this as a rail region whose visibility releases the
          column's stickiness (see globals.css); it carries no geometry of its own.
          No display utility on this wrapper either: a `flex`/`grid` class here
          would override the `hidden` attribute's `display: none`. */}
      <div
        id={REGION_ID}
        className="filter-region"
        hidden={!open}
        data-testid="advanced-filters-region"
      >
        <div className="divide-y divide-line border-t border-line">
          {ADVANCED_CATEGORIES.map((category) => (
            <div key={category.key} data-testid={`advanced-category-${category.key}`}>
              <FilterDisclosure
                controls={`${category.id}-fields`}
                label={category.label}
                level="sub"
                open={openCategory === category.key}
                count={countInGroup(criteria, category.key)}
                // One at a time: selecting a category replaces whichever was
                // open rather than adding to it.
                onToggle={() =>
                  setOpenCategory((was) => (was === category.key ? null : category.key))
                }
                testId={`advanced-category-toggle-${category.key}`}
              />
              <div
                id={`${category.id}-fields`}
                hidden={fieldsHidden(category.key)}
                data-testid={`advanced-category-fields-${category.key}`}
              >
                {/* Same three column counts as the core grid, and no `order`
                    utility anywhere: one column at mobile and in the narrow
                    desktop rail, a balanced two on tablet. DOM order is
                    therefore visual and keyboard order at every width. */}
                <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-1">
                  {category.key === "context" && (
                    <>
                      <TextFilterInput
                        label="League"
                        testId="league-filter"
                        placeholder="Bundesliga, England, eng"
                        describedBy="advanced-context-help"
                        value={filters.league}
                        onCommit={(league) => set({ league })}
                      />

                      <TextFilterInput
                        label="Club"
                        testId="club-filter"
                        placeholder="Leverkusen, PSG, Spurs"
                        describedBy="advanced-context-help"
                        value={filters.club}
                        onCommit={(club) => set({ club })}
                      />

                      <TextFilterInput
                        label="Nationality"
                        testId="nationality-filter"
                        placeholder="Germany"
                        describedBy="advanced-context-help"
                        value={filters.nationality}
                        onCommit={(nationality) => set({ nationality })}
                      />

                      <p
                        id="advanced-context-help"
                        className="text-[11px] leading-snug text-ink-soft sm:col-span-2 lg:col-span-1"
                      >
                        League matches name, country, or code. Club accepts names and common
                        aliases. Nationality matches any part of the country. All ignore case.
                      </p>
                    </>
                  )}

                  {category.key === "evidence" && (
                    <>
                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="label">Minimum Minutes</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          data-testid="min-minutes-filter"
                          className="input"
                          min={MIN_MINUTES_FLOOR}
                          max={MIN_MINUTES_CEILING}
                          step={1}
                          aria-describedby="filter-threshold-help"
                          value={filters.min_minutes ?? ""}
                          onChange={(e) =>
                            set({ min_minutes: parseMinutesThreshold(e.target.value) })
                          }
                        />
                      </label>

                      {/* Minutes and RoleFit are separate domains with separate
                          ceilings; each input declares and clamps its own. */}
                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="label">Minimum RoleFit</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          data-testid="rolefit-min-filter"
                          className="input"
                          min={ROLEFIT_SCALE_MIN}
                          max={ROLEFIT_SCALE_MAX}
                          step={1}
                          aria-describedby="filter-threshold-help"
                          value={filters.rolefit_min ?? ""}
                          onChange={(e) => setRoleFit(e.target.value, "min")}
                        />
                      </label>

                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="label">Maximum RoleFit</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          data-testid="rolefit-max-filter"
                          className="input"
                          min={ROLEFIT_SCALE_MIN}
                          max={ROLEFIT_SCALE_MAX}
                          step={1}
                          aria-describedby="filter-threshold-help"
                          value={filters.rolefit_max ?? ""}
                          onChange={(e) => setRoleFit(e.target.value, "max")}
                        />
                      </label>

                      {/* A native <select>: the platform's keyboard handling and
                          option list, not a custom combobox. Its options are the
                          Methodology contract's positive playstyles. */}
                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="label">Playstyle</span>
                        <select
                          data-testid="playstyle-filter"
                          className="input"
                          aria-describedby="filter-threshold-help"
                          value={filters.playstyle ?? ""}
                          onChange={(e) => set({ playstyle: e.target.value || undefined })}
                        >
                          <option value="">{ANY_PLAYSTYLE_LABEL}</option>
                          {playstyleOptions.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                          {/* A hard-loaded key the contract has not delivered yet
                              still shows as the selected option, so the control
                              never silently disagrees with the request. */}
                          {filters.playstyle &&
                            !playstyleOptions.some((p) => p.key === filters.playstyle) && (
                              <option value={filters.playstyle}>{filters.playstyle}</option>
                            )}
                        </select>
                      </label>

                      <p
                        id="filter-threshold-help"
                        className="text-[11px] leading-snug text-ink-soft sm:col-span-2 lg:col-span-1"
                      >
                        Whole minutes {MIN_MINUTES_FLOOR}-
                        {MIN_MINUTES_CEILING.toLocaleString("en-US")}; whole RoleFit{" "}
                        {ROLEFIT_SCALE_MIN}-{ROLEFIT_SCALE_MAX}. Blank for none. RoleFit bounds
                        apply to the selected role, or to each player&apos;s best role when no
                        role is selected. Playstyle means a qualifying strength, never a concern.
                      </p>
                    </>
                  )}

                  {category.key === "market" && (
                    <>
                      {/* Typed in EUR millions because the rail is 248px wide and
                          "12500000" is both unreadable and a mistype away from a
                          tenfold error. The request and the URL stay absolute EUR:
                          12.5 here is value_min=12500000 there. Each field keeps a
                          raw text draft while it is being edited, so typing a decimal
                          one key at a time survives (see AskingPriceInput). */}
                      <AskingPriceInput
                        label={<>Minimum Expected Asking (&euro;M)</>}
                        testId="value-min-filter"
                        describedBy="advanced-market-help"
                        valueEur={filters.value_min}
                        onCommit={(eur) => setAsking(eur, "min")}
                      />

                      <AskingPriceInput
                        label={<>Maximum Expected Asking (&euro;M)</>}
                        testId="value-max-filter"
                        describedBy="advanced-market-help"
                        valueEur={filters.value_max}
                        onCommit={(eur) => setAsking(eur, "max")}
                      />

                      <p
                        id="advanced-market-help"
                        className="text-[11px] leading-snug text-ink-soft sm:col-span-2 lg:col-span-1"
                      >
                        Bounds on the modelled expected-asking range, in EUR millions: 12.5 means
                        &euro;12.5M. A player qualifies when that range overlaps these bounds; a
                        player with no expected asking is excluded rather than read as &euro;0.
                        Blank for no bound.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
