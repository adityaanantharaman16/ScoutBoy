"use client";

import Link from "next/link";

import { ConfidenceBadge, EmptyState, ErrorState, Loading } from "@/components/common";
import type { SearchFilters } from "@/lib/api/hooks";
import { usePlayerSearch } from "@/lib/api/hooks";
import type { PlayerSearchCard } from "@/lib/api/types";
import { formatAge, formatEurRange, formatScore, marketLabelColor, scoreColor } from "@/lib/formatters";

function ResultCard({ p }: { p: PlayerSearchCard }) {
  return (
    <Link
      href={`/players/${p.id}`}
      data-testid="player-result"
      className="card block transition hover:border-accent/50"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold">{p.canonical_name}</div>
          <div className="text-xs text-slate-400">
            {formatAge(p.age)} · {p.primary_position ?? "—"} · {p.club ?? "—"}
          </div>
          <div className="text-xs text-slate-500">{p.league ?? "—"}</div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${scoreColor(p.best_role_score)}`}>
            {formatScore(p.best_role_score)}
          </div>
          <div className="text-[11px] text-slate-400">{p.best_role_display ?? "—"}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {p.top_playstyles.map((s) => (
          <span key={s} className="chip border-white/15 bg-white/5 text-slate-200">
            {s}
          </span>
        ))}
        {p.top_playstyles.length === 0 && (
          <span className="text-xs text-slate-500">No qualifying playstyles</span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className={`chip ${marketLabelColor(p.market_label)}`}>
          {p.market_label ?? "unknown"} · {formatEurRange(p.expected_asking_low_eur, p.expected_asking_high_eur)}
        </span>
        <ConfidenceBadge confidence={p.confidence} />
      </div>
    </Link>
  );
}

export function PlayerSearchResults({
  filters,
  onPage,
}: {
  filters: SearchFilters;
  onPage: (page: number) => void;
}) {
  const { data, isLoading, isError, error } = usePlayerSearch(filters);

  if (isLoading) return <Loading label="Finding players…" />;
  if (isError) return <ErrorState message={(error as Error)?.message ?? "Failed to load"} />;
  if (!data || data.items.length === 0) return <EmptyState label="No players match these filters." />;

  const page = data.page;
  return (
    <div>
      <div className="mb-3 text-xs text-slate-400" data-testid="result-count">
        {data.total} player{data.total === 1 ? "" : "s"} · page {page} of {data.total_pages}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.items.map((p) => (
          <ResultCard key={p.id} p={p} />
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-2">
        <button
          className="rounded border border-white/15 px-3 py-1 text-sm disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </button>
        <button
          className="rounded border border-white/15 px-3 py-1 text-sm disabled:opacity-40"
          disabled={page >= data.total_pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
