"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import {
  ConfidenceMeter,
  ConfidenceReadout,
  EmptyState,
  ErrorState,
  LedgerSkeleton,
  PageHeader,
  ScopeBanner,
  ScoreReadout,
} from "@/components/common";
import {
  CompareQueueButton,
  PlayerActionRow,
  ShortlistButton,
} from "@/components/common/PlayerActions";
import { ROLES, SCOPE_BANNER } from "@/lib/constants";
import { useRoleLeaderboard } from "@/lib/api/hooks";
import { formatAge, formatScore, scoreColor } from "@/lib/formatters";
import { marketRangeText } from "@/lib/market/marketChart";

export default function RoleLeaderboardPage() {
  const params = useParams();
  const router = useRouter();
  const roleKey = String(params.roleId);
  const { data, isLoading, isError, error } = useRoleLeaderboard(roleKey, { limit: 50 });
  const fallbackName = ROLES.find((r) => r.key === roleKey)?.label ?? "Role leaderboard";

  const roleSelect = (
    <label className="flex flex-col gap-1">
      <span className="label">Role</span>
      <select
        data-testid="role-select"
        className="input"
        value={roleKey}
        onChange={(e) => router.push(`/roles/${e.target.value}`)}
      >
        {ROLES.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      {/* Role masthead: the selector plus the cohort context the row contract
          alone can't convey (position group, rated total, season, rating version). */}
      <PageHeader
        eyebrow="Role leaderboard"
        title={data?.display_name ?? fallbackName}
        lead={data?.description ?? undefined}
        meta={
          data
            ? `${data.position_group} · ${data.total} rated player${data.total === 1 ? "" : "s"} · ${data.season} · rating ${data.rating_version}`
            : undefined
        }
        aside={roleSelect}
      />

      {isLoading && <LedgerSkeleton rows={8} label="Loading leaderboard…" />}
      {isError && <ErrorState message={(error as Error)?.message ?? "Failed to load leaderboard."} />}

      {data &&
        (data.rows.length === 0 ? (
          <EmptyState label="No rated players for this role in the current dataset yet." />
        ) : (
          <>
            {/* Desktop: a genuine ranking table. Rank, score magnitude, and RoleFit
                confidence are kept as separate columns. Evidence coverage is not
                shown here — the leaderboard row contract does not provide it. */}
            <div className="table-shell hidden md:block">
              <table className="data-table" data-testid="leaderboard-table">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>Player</th>
                    <th className="text-right">Score</th>
                    <th>RoleFit Confidence</th>
                    <th>Playstyles</th>
                    <th className="text-right">Expected asking</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.player_id}>
                      <td className="font-mono text-ink-soft">{r.rank}</td>
                      <td>
                        <Link
                          href={`/players/${r.player_id}`}
                          className="font-semibold hover:underline"
                        >
                          {r.canonical_name}
                        </Link>
                        <div className="text-xs text-ink-soft">
                          {formatAge(r.age)} yrs · {r.club ?? "—"} · {r.league ?? "—"}
                        </div>
                      </td>
                      <td className={`text-right font-mono font-bold ${scoreColor(r.final_score)}`}>
                        {formatScore(r.final_score)}
                      </td>
                      <td>
                        <ConfidenceMeter level={r.confidence} />
                      </td>
                      <td className="text-xs text-ink-muted">
                        {r.top_playstyles.slice(0, 3).join(", ") || "—"}
                      </td>
                      <td className="text-right font-mono text-xs">
                        {marketRangeText(r.expected_asking_low_eur, r.expected_asking_high_eur)}
                      </td>
                      <td>
                        <div className="flex flex-nowrap justify-end gap-2">
                          <ShortlistButton
                            player={{ id: r.player_id, name: r.canonical_name }}
                            size="sm"
                          />
                          <CompareQueueButton
                            player={{ id: r.player_id, name: r.canonical_name }}
                            size="sm"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: a linear ranked ledger (not a compressed table). Rank order
                and every critical evidence channel are preserved. */}
            <div
              className="divide-y divide-line overflow-hidden border border-line bg-paper-panel md:hidden"
              data-testid="leaderboard-ledger"
            >
              {data.rows.map((r) => (
                <article key={r.player_id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="mono text-sm font-bold text-ink-soft">#{r.rank}</span>
                        <Link
                          href={`/players/${r.player_id}`}
                          className="truncate tracking-tight text-lg font-bold hover:underline"
                        >
                          {r.canonical_name}
                        </Link>
                      </div>
                      <div className="text-xs text-ink-soft">
                        {formatAge(r.age)} yrs · {r.club ?? "—"} · {r.league ?? "—"}
                      </div>
                    </div>
                    <ScoreReadout score={r.final_score} size="md" className="shrink-0 text-right" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <ConfidenceReadout level={r.confidence} />
                    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                      Expected asking:
                      <span className="mono text-ink">
                        {marketRangeText(r.expected_asking_low_eur, r.expected_asking_high_eur)}
                      </span>
                    </span>
                  </div>
                  {r.top_playstyles.length > 0 && (
                    <div className="mt-1.5 text-xs text-ink-muted">
                      {r.top_playstyles.slice(0, 3).join(", ")}
                    </div>
                  )}
                  <div className="mt-3">
                    <PlayerActionRow
                      player={{ id: r.player_id, name: r.canonical_name }}
                      size="sm"
                    />
                  </div>
                </article>
              ))}
            </div>
          </>
        ))}
    </div>
  );
}
