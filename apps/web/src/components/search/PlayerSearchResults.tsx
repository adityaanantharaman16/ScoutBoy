"use client";

import Link from "next/link";

import {
  ConfidenceReadout,
  EmptyState,
  ErrorState,
  EvidenceTag,
  LedgerSkeleton,
  MarketReadout,
  ScoreReadout,
} from "@/components/common";
import { PlayerActionRow } from "@/components/common/PlayerActions";
import type { SearchFilters } from "@/lib/api/hooks";
import { usePlayerSearch } from "@/lib/api/hooks";
import type { PlayerSearchCard } from "@/lib/api/types";
import { formatAge } from "@/lib/formatters";

// A single compact scouting-ledger row (not an isolated large card). The reading
// order is fixed: identity → best RoleFit role/score → evidence coverage →
// RoleFit confidence → market → playstyles → actions. Profile-only players never
// receive a fabricated score, confidence, or empty analytical badges.
export function ResultCard({ p }: { p: PlayerSearchCard }) {
  return (
    <article
      className="grid gap-x-4 gap-y-2.5 px-4 py-3 transition hover:bg-paper-muted/50 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start"
      data-testid="result-row"
    >
      <div className="min-w-0">
        {/* 1. identity + 2. best RoleFit role/score (honest profile-only otherwise) */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href={`/players/${p.id}`} data-testid="player-result" className="no-underline">
              <span className="font-serif text-lg font-bold leading-tight text-ink hover:underline">
                {p.canonical_name}
              </span>
            </Link>
            <div className="mt-0.5 text-xs text-ink-muted">
              {formatAge(p.age)} yrs · {p.primary_position ?? "—"} · {p.club ?? "—"}
            </div>
            <div className="text-xs text-ink-soft">
              {p.league ?? "—"} · {p.season} · {p.represented_minutes ?? p.minutes ?? "—"} min
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="label mb-0.5">RoleFit</div>
            {p.has_rolefit_analysis ? (
              <ScoreReadout
                score={p.best_role_score}
                caption={p.best_role_display ?? "—"}
                size="md"
              />
            ) : (
              <span
                className="inline-flex border border-line-strong px-2 py-1 text-xs font-semibold text-ink-muted"
                style={{ borderRadius: 4 }}
              >
                Profile Only
              </span>
            )}
          </div>
        </div>

        {/* 3–6. evidence coverage · RoleFit confidence · market · playstyles */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span data-testid="card-evidence">
            <EvidenceTag status={p.evidence_status} />
          </span>
          {p.has_rolefit_analysis && (
            <span data-testid="card-confidence">
              <ConfidenceReadout level={p.confidence} />
            </span>
          )}
          <MarketReadout
            label={p.market_label}
            low={p.expected_asking_low_eur}
            high={p.expected_asking_high_eur}
          />
          {p.top_playstyles.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              {p.top_playstyles.map((s) => (
                <span key={s} className="chip border-line bg-paper-panel text-ink-muted">
                  {s}
                </span>
              ))}
            </span>
          ) : !p.has_rolefit_analysis ? (
            <span className="text-xs text-ink-soft" data-testid="profile-only-card">
              Analysis unavailable
            </span>
          ) : (
            <span className="text-xs text-ink-soft" data-testid="no-playstyles">
              No qualifying playstyles
            </span>
          )}
        </div>
      </div>

      {/* 7. shortlist + comparison actions */}
      <div className="lg:pt-5">
        <PlayerActionRow player={{ id: p.id, name: p.canonical_name }} />
      </div>
    </article>
  );
}

export function PlayerSearchResults({
  filters,
  selectedScope,
  selectedAgeBand,
  onPage,
}: {
  filters: SearchFilters;
  selectedScope: string;
  selectedAgeBand: string;
  onPage: (page: number) => void;
}) {
  const { data, isLoading, isError, error } = usePlayerSearch(filters);

  if (isLoading) return <LedgerSkeleton rows={6} label="Finding players…" />;
  if (isError) return <ErrorState message={(error as Error)?.message ?? "Failed to load players."} />;
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        label="No players match these filters."
        action={
          <span className="text-xs text-ink-soft">
            Try widening the analysis scope or clearing a filter.
          </span>
        }
      />
    );
  }

  const page = data.page;
  return (
    <div>
      <div
        className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft"
        data-testid="result-count"
      >
        <span>
          {data.total} player{data.total === 1 ? "" : "s"} · {selectedScope} · {selectedAgeBand} ·{" "}
          {data.items[0]?.season ?? "current season"} · page {page} of {data.total_pages}
        </span>
        <span>Ranked ledger</span>
      </div>
      <div
        className="divide-y divide-line overflow-hidden border border-line bg-paper-panel"
        style={{ borderRadius: 6 }}
        data-testid="results-ledger"
      >
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
