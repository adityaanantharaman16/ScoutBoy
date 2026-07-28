"use client";

import Link from "next/link";

import {
  ConfidenceReadout,
  EmptyState,
  ErrorState,
  EvidenceTag,
  LedgerSkeleton,
  LinkButton,
  MarketReadout,
  PageHeader,
  ScopeBanner,
  ScoreReadout,
} from "@/components/common";
import { CompareQueueButton } from "@/components/common/PlayerActions";
import { SCOPE_BANNER } from "@/lib/constants";
import { usePlayersByIds } from "@/lib/api/hooks";
import { useScoutingState } from "@/lib/state/scouting-state";
import type { PlayerCard } from "@/lib/api/types";
import { formatAge } from "@/lib/formatters";

function SavedRecord({
  card,
  onRemove,
}: {
  card: PlayerCard;
  onRemove: (id: number) => void;
}) {
  const id = card.identity;
  const best = card.role_ratings.find((r) => r.is_best) ?? card.role_ratings[0];
  const analyzed = card.has_rolefit_analysis && !!best;

  return (
    <article className="card flex flex-col gap-2.5" data-testid="shortlist-record">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/players/${id.id}`}
            data-testid="shortlist-player"
            className="font-serif text-xl font-bold leading-tight text-ink no-underline hover:underline"
          >
            {id.canonical_name}
          </Link>
          <div className="mt-0.5 text-xs text-ink-muted">
            {id.primary_position ?? "—"} · {card.season}
          </div>
          <div className="text-xs text-ink-soft">
            {formatAge(id.age)} yrs · {id.club ?? "—"} · {id.league ?? "—"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="label mb-0.5">RoleFit</div>
          {analyzed ? (
            <ScoreReadout score={best.final_score} caption={best.display_name} size="md" />
          ) : (
            <span
              className="inline-flex border border-line-strong px-2 py-1 text-xs font-semibold text-ink-muted"
              style={{ borderRadius: 4 }}
            >
              Profile only
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {analyzed && <ConfidenceReadout level={best.confidence} />}
        <EvidenceTag status={card.evidence_status} />
        <MarketReadout
          label={card.market?.label}
          low={card.market?.expected_asking_low_eur}
          high={card.market?.expected_asking_high_eur}
        />
      </div>

      {card.playstyles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.playstyles.slice(0, 3).map((b) => (
            <span key={b.playstyle_key} className="chip border-line bg-paper-panel text-ink-muted">
              {b.display_name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-2 border-t border-line pt-2.5">
        <CompareQueueButton player={{ id: id.id, name: id.canonical_name }} size="sm" />
        <button
          type="button"
          className="btn px-2 py-1 text-xs"
          onClick={() => onRemove(id.id)}
        >
          Remove
        </button>
      </div>
    </article>
  );
}

export default function ShortlistPage() {
  const { shortlistIds, removeShortlist } = useScoutingState();
  const queries = usePlayersByIds(shortlistIds);
  const loading = queries.some((q) => q.isLoading);
  const cards = queries.flatMap((q) => (q.data ? [q.data] : []));
  const staleIds = shortlistIds.filter((id, index) => queries[index]?.isError);

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      <PageHeader
        eyebrow="Shortlist"
        title="Saved decisions"
        lead="Players you have set aside to revisit. These are stored in this browser only — saved on this device, not synced to an account."
        meta={
          cards.length > 0
            ? `${cards.length} resolved player${cards.length === 1 ? "" : "s"} · saved on this device`
            : undefined
        }
      />

      {shortlistIds.length === 0 && (
        <EmptyState
          label="No players saved yet. Save players from discovery, profiles, similar players, or leaderboards to revisit them here."
          action={<LinkButton href="/">Go to discovery</LinkButton>}
        />
      )}

      {loading && shortlistIds.length > 0 && (
        <LedgerSkeleton rows={Math.min(shortlistIds.length, 4)} label="Resolving shortlisted players…" />
      )}

      {staleIds.length > 0 && (
        <div className="mb-4">
          <ErrorState
            message={`${staleIds.length} saved player id${staleIds.length === 1 ? "" : "s"} could not be resolved and may be stale.`}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {staleIds.map((id) => (
              <button
                key={id}
                type="button"
                className="btn px-2 py-1 text-xs"
                onClick={() => removeShortlist(id)}
              >
                Remove stale id {id}
              </button>
            ))}
          </div>
        </div>
      )}

      {cards.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="shortlist-grid">
          {cards.map((card) => (
            <SavedRecord key={card.identity.id} card={card} onRemove={removeShortlist} />
          ))}
        </div>
      )}
    </div>
  );
}
