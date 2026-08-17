"use client";

import { useState } from "react";

import type { RankingExplanation, RankingKey } from "@/lib/api/types";

/** There is exactly one of these per ledger, so the region id is a constant. */
const REGION_ID = "ranking-explanation-region";

/**
 * "Why this order" — the ledger's own statement of the ordering it just applied.
 *
 * **Everything rendered here is supplied by the API.** The backend owns one sort
 * specification that builds both the SQL `ORDER BY` and this description, so the key
 * sequence, each key's direction and rule, the role context, the unknown-value
 * placement and the tie-breaks arrive as structured fields with bounded deterministic
 * text. This component chooses layout and nothing else: there is deliberately no
 * ordering rule, no direction map and no sentence construction in the browser,
 * because a second copy of the rules here would be free to drift from the SQL that
 * actually ordered the page.
 *
 * It is deliberately PAGE-LEVEL: it states which ordering is active and what that
 * ordering does, and says nothing about any individual player. So it stays a few
 * short rows tall whatever the page size, and a scout reads the ordering itself off
 * the sorted column of the ledger below.
 *
 * Placement is the results ledger, between its count header and the first player row,
 * and never the filter rail: the rail narrows the cohort, and a filter never explains
 * rank. It is ONE disclosure for the page — no panel per row, no repeated "Why?"
 * button — collapsed by default, so the ledger stays as compact as it was.
 *
 * Open state is local React state rather than URL state, for the same reason the
 * rail's disclosures are: a shared link describes a cohort and its ordering, not
 * which drawer the sender had open.
 */
export function WhyThisOrder({ ranking }: { ranking: RankingExplanation }) {
  const [open, setOpen] = useState(false);

  return (
    <div data-testid="why-this-order">
      <button
        type="button"
        className="ledger-explain"
        aria-expanded={open}
        aria-controls={REGION_ID}
        // The visible label leads the accessible name (WCAG 2.5.3 Label in Name)
        // and the purpose is spoken rather than left to the icon.
        aria-label={`Why this order. ${ranking.summary}`}
        data-testid="why-this-order-toggle"
        onClick={() => setOpen((was) => !was)}
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="label">Why This Order</span>
          {/* A short statement of the ACTIVE sort, and only that. This row is not
              a second header: the cohort counts stay in the header above it. */}
          <span className="min-w-0 text-xs text-ink-muted" data-testid="ranking-summary-collapsed">
            {ranking.summary}
          </span>
        </span>
        {/* Decorative: the state is already carried by `aria-expanded`. */}
        <span className="ledger-explain-glyph" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>

      {/* Stays in the DOM in both states, so `aria-controls` always resolves, and
          `hidden` keeps its contents out of the tab order while shut. No display
          utility on this wrapper: a `flex`/`grid` class would override `hidden`. */}
      <div
        id={REGION_ID}
        className="divide-y divide-line border-t border-line"
        hidden={!open}
        data-testid="why-this-order-region"
      >
        <ActiveSort ranking={ranking} />
        <OrderingRules keys={ranking.keys} tieBreakers={ranking.tie_breakers} />
        <div className="ledger-explain-block">
          <p className="text-xs leading-snug text-ink-soft" data-testid="ranking-limitation">
            {ranking.limitation}
          </p>
        </div>
      </div>
    </div>
  );
}

/** The active mode, the role context it read, and how it places unknown values. */
function ActiveSort({ ranking }: { ranking: RankingExplanation }) {
  return (
    <div className="ledger-explain-block space-y-2">
      <div className="label">Active Sort</div>
      <p className="text-sm font-semibold leading-snug text-ink" data-testid="ranking-summary">
        {ranking.summary}
      </p>
      {/* Which stored rating every result DISPLAYS, and — separately — whether that
          rating also ordered the page. The backend decides both; under Age,
          Expected Asking and Name it says plainly that RoleFit did not order. */}
      <div data-testid="ranking-role-context">
        <p className="text-xs font-semibold leading-snug text-ink-muted">
          {ranking.role_context.label}
        </p>
        <p className="text-xs leading-snug text-ink-soft">{ranking.role_context.detail}</p>
      </div>
      <p className="text-xs leading-snug text-ink-soft" data-testid="ranking-missing-values">
        {ranking.missing_values}
      </p>
    </div>
  );
}

/**
 * The exact ordered key sequence the database applied, first key first.
 *
 * Rendered straight from `ranking.keys` in the order supplied — the list is not
 * re-sorted, filtered or annotated here.
 */
function OrderingRules({
  keys,
  tieBreakers,
}: {
  keys: RankingKey[];
  tieBreakers: RankingKey[];
}) {
  return (
    <div data-testid="ranking-rules">
      <div className="ledger-explain-block pb-1">
        <div className="label">Ordering Rules, In Order</div>
      </div>
      <ol className="divide-y divide-line border-t border-line">
        {keys.map((key) => (
          <li
            key={`${key.position}-${key.key}`}
            className="ledger-explain-row"
            data-testid="ranking-key"
            data-ranking-key={key.key}
            data-ranking-position={key.position}
          >
            <span className="ledger-explain-index mono" aria-hidden="true">
              {key.position}
            </span>
            <span className="min-w-0 break-words">
              <span className="text-xs font-bold text-ink">{key.label}</span>
              <span className="text-xs text-ink-muted"> · {key.direction_label}</span>
              <span className="block text-xs leading-snug text-ink-soft">{key.rule}</span>
            </span>
          </li>
        ))}
      </ol>
      {tieBreakers.length > 0 && (
        <div className="ledger-explain-block pt-2">
          <p className="text-xs leading-snug text-ink-soft" data-testid="ranking-tie-breakers">
            Final tie-breakers, always applied last:{" "}
            {tieBreakers.map((key) => key.label).join(", ")}.
          </p>
        </div>
      )}
    </div>
  );
}
