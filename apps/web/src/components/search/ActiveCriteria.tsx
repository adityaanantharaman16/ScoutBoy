"use client";

import { useState } from "react";

import {
  criterionRemoveLabel,
  criterionSummary,
  type ActiveCriterion,
} from "@/lib/filters/criteria";

const REGION_ID = "active-criteria-list";
/** How many summaries the collapsed line shows before it says "+N more". */
const COLLAPSED_SUMMARIES = 2;

/**
 * What the current Discovery request is actually narrowing by, and how to undo
 * any part of it.
 *
 * It answers two questions the filter controls alone cannot, because half of
 * them live behind a disclosure: *what is active* and *how do I get rid of one
 * of them*. Absent entirely when nothing is active, so an unfiltered rail is not
 * carrying an empty box.
 *
 * Collapsed it is one square row: the total count, the first two criteria in
 * rail order, and "+N more". Expanded it is one flat rectangular row per
 * criterion, each with its own named remove action. Deliberately NOT
 * `DisplayTag`s: a display tag is a non-interactive semantic label with no tab
 * stop, and these are filter controls. They are also not chips — same 90-degree
 * geometry as everything else in the rail.
 *
 * Clear All sits in the header row rather than only inside the expanded list, so
 * a complete reset is always one press away — including from the zero-result
 * state, where it is the fastest way out.
 */
export function ActiveCriteria({
  criteria,
  onRemove,
  onClearAll,
}: {
  criteria: ActiveCriterion[];
  /** Removes exactly this criterion's parameters. The index seeds focus restoration. */
  onRemove: (criterion: ActiveCriterion, index: number) => void;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (criteria.length === 0) return null;

  const shown = criteria.slice(0, COLLAPSED_SUMMARIES).map(criterionSummary);
  const more = criteria.length - shown.length;
  const total = `${criteria.length} Active ${criteria.length === 1 ? "Criterion" : "Criteria"}`;

  return (
    <div data-testid="active-criteria">
      <div className="flex items-stretch justify-between gap-0">
        {/* The disclosure is not `FilterDisclosure` here because this row carries
            a second control (Clear All) beside it, and a button may not nest
            inside a button. Same geometry, same aria contract. */}
        <button
          type="button"
          className="filter-disclosure min-w-0 flex-1"
          aria-expanded={open}
          aria-controls={REGION_ID}
          aria-label={`${total}, show details`}
          data-testid="active-criteria-toggle"
          onClick={() => setOpen((was) => !was)}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-bold tracking-tight" data-testid="active-criteria-count">
                {total}
              </span>
            </span>
            {/* One truncating line: a long search needle or club name shortens
                rather than widening the 240-280px rail. */}
            <span
              className="truncate text-[11px] leading-snug text-ink-soft"
              data-testid="active-criteria-summary"
            >
              {shown.join(" · ")}
              {more > 0 ? ` · +${more} more` : ""}
            </span>
          </span>
          <span className="filter-disclosure-glyph" aria-hidden="true">
            {open ? "−" : "+"}
          </span>
        </button>
        <button
          type="button"
          className="filter-clear-all"
          data-testid="clear-all-filters"
          onClick={onClearAll}
        >
          Clear All
        </button>
      </div>

      {/* `filter-region`: a visible rail region releases the desktop column's
          stickiness, so an expanded list is reachable by page scrolling instead of
          being pinned past the viewport's bottom edge. */}
      <div
        id={REGION_ID}
        className="filter-region"
        hidden={!open}
        data-testid="active-criteria-region"
      >
        <ul className="divide-y divide-line border-t border-line">
          {criteria.map((criterion, index) => (
            <li key={criterion.key} className="filter-criterion" data-testid="active-criterion">
              <span className="flex min-w-0 flex-col">
                <span className="label">{criterion.field}</span>
                <span className="truncate text-xs text-ink" data-testid="active-criterion-value">
                  {criterion.value}
                </span>
              </span>
              <button
                type="button"
                className="filter-criterion-remove"
                aria-label={criterionRemoveLabel(criterion)}
                data-testid={`remove-criterion-${criterion.key}`}
                onClick={() => onRemove(criterion, index)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
