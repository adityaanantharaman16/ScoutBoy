"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { ErrorState, Loading, ScopeBanner } from "@/components/common";
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
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Role leaderboard</h1>
        <select
          data-testid="role-select"
          className="rounded bg-pitch-700 px-2 py-1.5 text-sm"
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
          <p className="mb-3 text-sm text-slate-400">
            {data.display_name} · {data.position_group} · {data.total} rated players · {data.season}
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm" data-testid="leaderboard-table">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500">
                  <th className="py-2">#</th>
                  <th className="py-2">Player</th>
                  <th className="py-2">Age</th>
                  <th className="py-2">Club</th>
                  <th className="py-2">League</th>
                  <th className="py-2 text-right">Score</th>
                  <th className="py-2">Conf</th>
                  <th className="py-2">Playstyles</th>
                  <th className="py-2 text-right">Asking</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.player_id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="py-2">{r.rank}</td>
                    <td className="py-2">
                      <Link href={`/players/${r.player_id}`} className="hover:text-accent-soft">
                        {r.canonical_name}
                      </Link>
                    </td>
                    <td className="py-2">{formatAge(r.age)}</td>
                    <td className="py-2">{r.club ?? "—"}</td>
                    <td className="py-2 text-slate-400">{r.league ?? "—"}</td>
                    <td className={`py-2 text-right font-bold ${scoreColor(r.final_score)}`}>
                      {formatScore(r.final_score)}
                    </td>
                    <td className="py-2 text-xs text-slate-400">{r.confidence}</td>
                    <td className="py-2 text-xs text-slate-400">
                      {r.top_playstyles.slice(0, 2).join(", ")}
                    </td>
                    <td className="py-2 text-right text-xs">
                      {formatEurRange(r.expected_asking_low_eur, r.expected_asking_high_eur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
