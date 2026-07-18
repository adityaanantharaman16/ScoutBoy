"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { ErrorState, Loading, ScopeBanner } from "@/components/common";
import { PlayerActionRow } from "@/components/common/PlayerActions";
import { ROLES, SCOPE_BANNER } from "@/lib/constants";
import { useRoleLeaderboard } from "@/lib/api/hooks";
import { formatAge, formatEurRange, formatScore, scoreColor } from "@/lib/formatters";

export default function RoleLeaderboardPage() {
  const params = useParams();
  const router = useRouter();
  const roleKey = String(params.roleId);
  const { data, isLoading, isError, error } = useRoleLeaderboard(roleKey, { limit: 50 });

  return (
    <div>
      <ScopeBanner text={SCOPE_BANNER} />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label mb-1">Leaderboards</p>
          <h1 className="font-serif text-4xl font-bold leading-tight text-ink">Role leaderboard</h1>
        </div>
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
      </div>

      {isLoading && <Loading />}
      {isError && <ErrorState message={(error as Error)?.message ?? "Failed to load"} />}
      {data && (
        <>
          <p className="mb-3 text-sm text-ink-muted">
            {data.display_name} · {data.position_group} · {data.total} rated players · {data.season}
          </p>
          <div className="table-shell hidden md:block">
            <table className="data-table" data-testid="leaderboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Age</th>
                  <th>Club</th>
                  <th>League</th>
                  <th className="text-right">Score</th>
                  <th>Conf</th>
                  <th>Playstyles</th>
                  <th className="text-right">Asking</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.player_id}>
                    <td className="font-mono">{r.rank}</td>
                    <td>
                      <Link href={`/players/${r.player_id}`} className="font-semibold hover:underline">
                        {r.canonical_name}
                      </Link>
                    </td>
                    <td>{formatAge(r.age)}</td>
                    <td>{r.club ?? "—"}</td>
                    <td className="text-ink-muted">{r.league ?? "—"}</td>
                    <td className={`text-right font-mono font-bold ${scoreColor(r.final_score)}`}>
                      {formatScore(r.final_score)}
                    </td>
                    <td className="text-xs text-ink-muted">{r.confidence}</td>
                    <td className="text-xs text-ink-muted">
                      {r.top_playstyles.slice(0, 2).join(", ")}
                    </td>
                    <td className="text-right text-xs">
                      {formatEurRange(r.expected_asking_low_eur, r.expected_asking_high_eur)}
                    </td>
                    <td>
                      <PlayerActionRow player={{ id: r.player_id, name: r.canonical_name }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden" data-testid="leaderboard-table">
            {data.rows.map((r) => (
              <article key={r.player_id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="label">Rank {r.rank}</div>
                    <Link href={`/players/${r.player_id}`} className="font-serif text-xl font-bold hover:underline">
                      {r.canonical_name}
                    </Link>
                    <div className="text-xs text-ink-soft">{formatAge(r.age)} yrs · {r.club ?? "—"} · {r.league ?? "—"}</div>
                  </div>
                  <div className={`font-serif text-3xl font-bold ${scoreColor(r.final_score)}`}>{formatScore(r.final_score)}</div>
                </div>
                <div className="mt-2 text-xs text-ink-muted">
                  {r.confidence} confidence · {formatEurRange(r.expected_asking_low_eur, r.expected_asking_high_eur)}
                </div>
                <div className="mt-3">
                  <PlayerActionRow player={{ id: r.player_id, name: r.canonical_name }} />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
