"use client";

import Link from "next/link";

import { EmptyState, ErrorState, Loading, ScopeBanner } from "@/components/common";
import { CompareQueueButton } from "@/components/common/PlayerActions";
import { SCOPE_BANNER } from "@/lib/constants";
import { usePlayersByIds } from "@/lib/api/hooks";
import { useScoutingState } from "@/lib/state/scouting-state";
import { formatAge, formatEurRange, formatScore, scoreColor } from "@/lib/formatters";

export default function ShortlistPage() {
  const { shortlistIds, removeShortlist } = useScoutingState();
  const queries = usePlayersByIds(shortlistIds);
  const loading = queries.some((q) => q.isLoading);
  const cards = queries.flatMap((q) => (q.data ? [q.data] : []));
  const staleIds = shortlistIds.filter((id, index) => queries[index]?.isError);

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      <div className="mb-5 max-w-3xl">
        <p className="label mb-1">Shortlist</p>
        <h1 className="font-serif text-4xl font-bold leading-tight text-ink">Saved players</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Saved on this device. These selections are stored in local browser storage and are not
          synced to an account.
        </p>
      </div>

      {shortlistIds.length === 0 && (
        <EmptyState label="No players saved yet. Add players from discovery, profiles, similar players, or leaderboards." />
      )}

      {loading && <Loading label="Resolving shortlisted players..." />}

      {staleIds.length > 0 && (
        <div className="mb-4">
          <ErrorState message={`${staleIds.length} saved player id${staleIds.length === 1 ? "" : "s"} could not be resolved and may be stale.`} />
          <div className="mt-2 flex flex-wrap gap-2">
            {staleIds.map((id) => (
              <button key={id} type="button" className="btn px-2 py-1 text-xs" onClick={() => removeShortlist(id)}>
                Remove stale id {id}
              </button>
            ))}
          </div>
        </div>
      )}

      {cards.length > 0 && (
        <>
          <div className="mb-3 text-xs text-ink-soft">
            {cards.length} resolved player{cards.length === 1 ? "" : "s"} · saved on this device
          </div>
          <div className="table-shell hidden md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Age</th>
                  <th>Club</th>
                  <th>RoleFit</th>
                  <th>Evidence</th>
                  <th className="text-right">Asking</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => {
                  const best = card.role_ratings.find((r) => r.is_best);
                  const id = card.identity;
                  return (
                    <tr key={id.id}>
                      <td>
                        <Link href={`/players/${id.id}`} className="font-semibold hover:underline">
                          {id.canonical_name}
                        </Link>
                        <div className="text-xs text-ink-soft">{id.primary_position ?? "—"} · {card.season}</div>
                      </td>
                      <td>{formatAge(id.age)}</td>
                      <td>{id.club ?? "—"}</td>
                      <td className={`font-mono font-bold ${scoreColor(best?.final_score)}`}>
                        {best ? `${formatScore(best.final_score)} · ${best.display_name}` : "Profile only"}
                      </td>
                      <td className="text-xs text-ink-muted">{card.evidence_status.replaceAll("_", " ")}</td>
                      <td className="text-right text-xs">
                        {formatEurRange(card.market?.expected_asking_low_eur, card.market?.expected_asking_high_eur)}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <CompareQueueButton player={{ id: id.id, name: id.canonical_name }} />
                          <button type="button" className="btn px-2 py-1 text-xs" onClick={() => removeShortlist(id.id)}>
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {cards.map((card) => {
              const best = card.role_ratings.find((r) => r.is_best);
              const id = card.identity;
              return (
                <article key={id.id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/players/${id.id}`} className="font-serif text-xl font-bold hover:underline">
                        {id.canonical_name}
                      </Link>
                      <div className="text-xs text-ink-soft">{formatAge(id.age)} yrs · {id.club ?? "—"} · {id.primary_position ?? "—"}</div>
                    </div>
                    <div className={`font-serif text-2xl font-bold ${scoreColor(best?.final_score)}`}>
                      {best ? formatScore(best.final_score) : "Profile only"}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-ink-muted">
                    {card.evidence_status.replaceAll("_", " ")} · {formatEurRange(card.market?.expected_asking_low_eur, card.market?.expected_asking_high_eur)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <CompareQueueButton player={{ id: id.id, name: id.canonical_name }} />
                    <button type="button" className="btn px-2 py-1 text-xs" onClick={() => removeShortlist(id.id)}>
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
