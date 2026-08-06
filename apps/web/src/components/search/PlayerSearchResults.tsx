"use client";

import { useEffect } from "react";

import { EmptyState, ErrorState, LedgerSkeleton } from "@/components/common";
import {
  LedgerActionRail,
  LedgerHeader,
  LedgerIdentity,
  LedgerRoleFitHero,
  LedgerRow,
  LedgerStatusStack,
} from "@/components/common/LedgerRow";
import { PlayerActionRail } from "@/components/common/PlayerActions";
import type { SearchFilters } from "@/lib/api/hooks";
import { usePlayerSearch } from "@/lib/api/hooks";
import type { PlayerSearchCard } from "@/lib/api/types";
import { formatAge } from "@/lib/formatters";

// A single row of the ranked ledger — not an isolated card, and not a nested
// collection of cards. Three structural regions at lg+ (player information, the
// RoleFit hero, a full-height action rail); a clean stack below it. The hierarchy
// is: RoleFit score/role as the hero, then three explicitly stacked status lines
// (coverage + confidence, market, playstyles). Profile-only players never receive
// a fabricated score, confidence, or empty badges.
//
// The hero and the confidence line read the APPLICABLE ROLE CONTEXT the API
// resolved — the selected role when a role filter is active, the player's best role
// otherwise — and never the `best_role_*` fields directly. That is what keeps the
// visible role, score and confidence identical to the ones that filtered and
// ordered the row. Reading `best_role_score` here is precisely the bug this
// replaces: under `?role=touchline_winger` the ledger displayed each player's best
// role while ranking them by the selected one, so the scores ran out of order.
// Nothing is computed here; these are stored backend values.
export function ResultCard({ p }: { p: PlayerSearchCard }) {
  const analyzed = p.has_rolefit_analysis;
  return (
    <LedgerRow testId="result-row">
      <LedgerHeader>
        <LedgerIdentity
          href={`/players/${p.id}`}
          name={p.canonical_name}
          nameTestId="player-result"
        >
          <div className="mt-0.5 text-xs text-ink-muted">
            {formatAge(p.age)} yrs · {p.primary_position ?? "-"} · {p.club ?? "-"}
          </div>
          <div className="text-xs text-ink-soft">
            {p.league ?? "-"} · {p.season} · {p.represented_minutes ?? p.minutes ?? "-"} min
          </div>
        </LedgerIdentity>
        <LedgerRoleFitHero
          hasAnalysis={analyzed}
          score={p.result_role_score}
          role={p.result_role_display}
        />
      </LedgerHeader>

      <LedgerStatusStack
        evidenceStatus={p.evidence_status}
        confidence={p.result_role_confidence}
        hasAnalysis={analyzed}
        marketLabel={p.market_label}
        marketLow={p.expected_asking_low_eur}
        marketHigh={p.expected_asking_high_eur}
        playstyles={p.top_playstyles}
      />

      <LedgerActionRail>
        <PlayerActionRail player={{ id: p.id, name: p.canonical_name }} />
      </LedgerActionRail>
    </LedgerRow>
  );
}

export function PlayerSearchResults({
  filters,
  ageSummary,
  onPage,
  onCanonicalPage,
}: {
  filters: SearchFilters;
  /** The active age condition, phrased by the shared `ageSummaryText` helper. */
  ageSummary: string;
  onPage: (page: number) => void;
  /**
   * Called with the page the API actually served when it differs from the one
   * requested, so the URL can be brought into line. See `syncCanonicalPage`.
   */
  onCanonicalPage: (page: number) => void;
}) {
  const { data, isLoading, isError, error } = usePlayerSearch(filters);

  const servedPage = data?.page;
  const requestedPage = filters.page ?? 1;
  useEffect(() => {
    if (servedPage != null && servedPage !== requestedPage) onCanonicalPage(servedPage);
    // `onCanonicalPage` closes over the current filters and is recreated each
    // render; the served/requested pair is what decides whether to act.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servedPage, requestedPage]);

  if (isLoading) return <LedgerSkeleton rows={6} label="Finding players…" />;
  if (isError) return <ErrorState message={(error as Error)?.message ?? "Failed to load players."} />;
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        label="No players match these filters."
        action={
          <span className="text-xs text-ink-soft">
            Try widening the age range or clearing a filter.
          </span>
        }
      />
    );
  }

  const page = data.page;
  return (
    <div>
      {/* The result summary is the ledger's own header row, inside the bordered
          container and separated from the first player row by the existing
          hairline divider. Keeping it inside is what lets the results ledger and
          the filter rail start at the same y on desktop — no spacer is added
          above the filter panel to fake the alignment.

          `pane-enter` is a mount-triggered opacity settle covering the whole
          ledger — count header and rows together, as one atomic unit — so the
          reported total and the visible rows can never be seen disagreeing. It
          needs no key, state, or timer: this element only mounts when real data
          replaces the skeleton or a previous result. Deliberately no row stagger,
          no fly-in, and no reorder animation. */}
      <div
        className="pane-enter divide-y divide-line overflow-hidden border border-line bg-paper-panel"
        data-testid="results-ledger"
      >
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-paper-muted px-4 py-2 text-xs text-ink-soft"
          data-testid="result-count"
        >
          {/* Analysis scope is deliberately absent: it is no longer a Discovery
              control, so reporting it here would describe a filter the user
              cannot see or change. What remains is all active information —
              count, age condition, season, pagination. */}
          <span>
            {data.total} player{data.total === 1 ? "" : "s"} · {ageSummary} ·{" "}
            {data.items[0]?.season ?? "current season"} · page {page} of {data.total_pages}
          </span>
          <span>Ranked ledger</span>
        </div>
        {data.items.map((p) => (
          <ResultCard key={p.id} p={p} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          className="btn px-3 py-1 text-sm disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </button>
        <span className="text-xs text-ink-soft">
          Page {page} of {data.total_pages}
        </span>
        <button
          className="btn px-3 py-1 text-sm disabled:opacity-40"
          disabled={page >= data.total_pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
