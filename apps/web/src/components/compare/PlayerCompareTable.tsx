import type { CompareResponse, CompareSide, CompareStatRow } from "@/lib/api/types";
import { formatEurRange, formatScore, scoreColor } from "@/lib/formatters";

function SideHead({ side }: { side: CompareSide }) {
  return (
    <div>
      <div className="font-semibold">{side.identity.canonical_name}</div>
      <div className="text-xs text-slate-400">
        {side.identity.club ?? "—"} · {side.identity.league ?? "—"}
      </div>
    </div>
  );
}

export function PlayerCompareTable({ data }: { data: CompareResponse }) {
  const roleRatingFor = (side: CompareSide) =>
    side.role_ratings.find((r) => r.role_key === data.role_key);

  return (
    <div className="space-y-6" data-testid="compare-table">
      <div className="card">
        <div className="grid grid-cols-3 items-center gap-2">
          <SideHead side={data.player_a} />
          <div className="text-center text-xs uppercase text-slate-500">
            {data.role_display ?? "role"}
          </div>
          <div className="text-right">
            <SideHead side={data.player_b} />
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 items-center">
          <div className={`text-3xl font-black ${scoreColor(roleRatingFor(data.player_a)?.final_score)}`}>
            {formatScore(roleRatingFor(data.player_a)?.final_score)}
          </div>
          <div className="text-center text-xs text-slate-400">RoleFit</div>
          <div className={`text-right text-3xl font-black ${scoreColor(roleRatingFor(data.player_b)?.final_score)}`}>
            {formatScore(roleRatingFor(data.player_b)?.final_score)}
          </div>
        </div>
        <p className="mt-3 rounded bg-white/5 p-2 text-sm text-slate-200" data-testid="why-higher">
          {data.why_higher}
        </p>
        {data.confidence_warnings.map((w, i) => (
          <p key={i} className="mt-1 text-xs text-amber-300">
            ⚠ {w}
          </p>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <div className="label mb-2">Normalized stats (percentile score)</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase text-slate-500">
              <th className="py-1 text-left">A</th>
              <th className="py-1 text-center">Metric</th>
              <th className="py-1 text-right">B</th>
            </tr>
          </thead>
          <tbody>
            {(data.stat_rows as unknown as CompareStatRow[]).map((r) => (
              <tr key={r.metric} className="border-t border-white/5">
                <td className={`py-1 text-left font-medium ${scoreColor(r.a_score)}`}>
                  {r.a_score == null ? "—" : Math.round(r.a_score)}
                </td>
                <td className="py-1 text-center text-slate-400">{r.display}</td>
                <td className={`py-1 text-right font-medium ${scoreColor(r.b_score)}`}>
                  {r.b_score == null ? "—" : Math.round(r.b_score)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[data.player_a, data.player_b].map((side, i) => (
          <div key={i} className="card">
            <div className="label mb-1">{side.identity.canonical_name} — market</div>
            <div className="text-sm">
              {side.market?.label ?? "unknown"} ·{" "}
              {formatEurRange(side.market?.expected_asking_low_eur, side.market?.expected_asking_high_eur)}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {side.playstyles.slice(0, 4).map((b) => (
                <span key={b.playstyle_key} className="chip border-white/15 bg-white/5">
                  {b.display_name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
