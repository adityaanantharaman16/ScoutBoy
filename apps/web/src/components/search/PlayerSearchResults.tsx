"use client";

import Link from "next/link";

import { ConfidenceBadge, EmptyState, ErrorState, Loading } from "@/components/common";
import { PlayerActionRow } from "@/components/common/PlayerActions";
import type { SearchFilters } from "@/lib/api/hooks";
import { usePlayerSearch } from "@/lib/api/hooks";
import type { PlayerSearchCard } from "@/lib/api/types";
import { formatAge, formatEurRange, formatScore, marketLabelColor, scoreColor } from "@/lib/formatters";

const EVIDENCE_LABELS: Record<string, string> = {
  high_coverage: "High coverage",
  analyzed_limited: "Analyzed, limited coverage",
  profile_only: "Profile only",
};

export function ResultCard({ p }: { p: PlayerSearchCard }) {
  const evidenceLabel = EVIDENCE_LABELS[p.evidence_status] ?? p.evidence_status;
  return (
    <article className="card grid gap-3 transition hover:border-line-strong lg:grid-cols-[1.25fr_0.7fr_0.9fr_auto] lg:items-center">
      <Link href={`/players/${p.id}`} data-testid="player-result" className="block no-underline hover:underline">
        <div className="font-serif text-xl font-bold leading-tight text-ink">{p.canonical_name}</div>
        <div className="mt-1 text-xs text-ink-muted">
          {formatAge(p.age)} yrs · {p.primary_position ?? "—"} · {p.club ?? "—"}
        </div>
        <div className="text-xs text-ink-soft">
          {p.league ?? "—"} · {p.season} · {p.represented_minutes ?? p.minutes ?? "—"} min
        </div>
      </Link>

      <div>
        <div className="label">RoleFit</div>
        {p.has_rolefit_analysis ? (
          <div>
            <div className={`font-serif text-3xl font-bold leading-none ${scoreColor(p.best_role_score)}`}>
              {formatScore(p.best_role_score)}
            </div>
            <div className="mt-1 text-[11px] text-ink-soft">{p.best_role_display ?? "—"}</div>
          </div>
        ) : (
          <div className="mt-1 inline-flex border border-line-strong px-2 py-1 text-xs font-semibold text-ink-muted" style={{ borderRadius: 4 }}>
            Profile only
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap gap-1">
          <span className="chip border-line-strong bg-paper-muted text-ink-muted">{evidenceLabel}</span>
          {p.has_rolefit_analysis && <ConfidenceBadge confidence={p.confidence} />}
          <span className={`chip ${marketLabelColor(p.market_label)}`}>
            {p.market_label ?? "unknown"} ·{" "}
            {formatEurRange(p.expected_asking_low_eur, p.expected_asking_high_eur)}
          </span>
        </div>
        {p.top_playstyles.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
          {p.top_playstyles.map((s) => (
            <span key={s} className="chip border-line bg-paper-panel text-ink-muted">
              {s}
            </span>
          ))}
          </div>
        ) : !p.has_rolefit_analysis ? (
          <div className="mt-2 text-xs text-ink-soft" data-testid="profile-only-card">
            Analysis unavailable
          </div>
        ) : null}
      </div>

      <div className="lg:justify-self-end">
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

  if (isLoading) return <Loading label="Finding players…" />;
  if (isError) return <ErrorState message={(error as Error)?.message ?? "Failed to load"} />;
  if (!data || data.items.length === 0) return <EmptyState label="No players match these filters." />;

  const page = data.page;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft" data-testid="result-count">
        <span>
        {data.total} player{data.total === 1 ? "" : "s"} · {selectedScope} · {selectedAgeBand} ·{" "}
        {data.items[0]?.season ?? "current season"} · page {page} of {data.total_pages}
        </span>
        <span>URL-backed filters</span>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {data.items.map((p) => (
          <ResultCard key={p.id} p={p} />
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-2">
        <button
          className="btn px-3 py-1 text-sm disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </button>
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
