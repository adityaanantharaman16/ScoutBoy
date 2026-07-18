import type { CompareResponse, CompareSide, CompareStatRow } from "@/lib/api/types";
import { formatEurRange, formatScore, scoreColor } from "@/lib/formatters";

function SideHead({ side }: { side: CompareSide }) {
  return (
    <div>
      <div className="font-serif text-2xl font-bold leading-tight text-ink">{side.identity.canonical_name}</div>
      <div className="text-xs text-ink-soft">
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
          <div className="text-center text-xs font-bold uppercase tracking-[0.12em] text-ink-soft">
            {data.role_display ?? "role"}
          </div>
          <div className="text-right">
            <SideHead side={data.player_b} />
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 items-center">
          <div className={`font-serif text-4xl font-bold ${scoreColor(roleRatingFor(data.player_a)?.final_score)}`}>
            {formatScore(roleRatingFor(data.player_a)?.final_score)}
          </div>
          <div className="text-center text-xs text-ink-soft">RoleFit difference</div>
          <div className={`text-right font-serif text-4xl font-bold ${scoreColor(roleRatingFor(data.player_b)?.final_score)}`}>
            {formatScore(roleRatingFor(data.player_b)?.final_score)}
          </div>
        </div>
        <p className="mt-3 border border-line bg-paper-muted p-3 text-sm text-ink-muted" style={{ borderRadius: 5 }} data-testid="why-higher">
          {data.why_higher}
        </p>
        {data.confidence_warnings.map((w, i) => (
          <p key={i} className="mt-2 text-xs font-semibold text-accent-amber">
            Confidence warning: {w}
          </p>
        ))}
      </div>

      <div className="table-shell">
        <div className="label mb-2">Normalized stats (percentile score)</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>A</th>
              <th className="text-center">Metric</th>
              <th className="text-right">B</th>
            </tr>
          </thead>
          <tbody>
            {(data.stat_rows as unknown as CompareStatRow[]).map((r) => (
              <tr key={r.metric}>
                <td className={`font-mono font-semibold ${scoreColor(r.a_score)}`}>
                  {r.a_score == null ? "—" : Math.round(r.a_score)}
                </td>
                <td className="text-center text-ink-muted">{r.display}</td>
                <td className={`text-right font-mono font-semibold ${scoreColor(r.b_score)}`}>
                  {r.b_score == null ? "—" : Math.round(r.b_score)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[data.player_a, data.player_b].map((side, i) => (
          <div key={i} className="card">
            <div className="label mb-1">{side.identity.canonical_name} — market</div>
            <div className="text-sm text-ink-muted">
              {side.market?.label ?? "unknown"} ·{" "}
              {formatEurRange(side.market?.expected_asking_low_eur, side.market?.expected_asking_high_eur)}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {side.playstyles.slice(0, 4).map((b) => (
                <span key={b.playstyle_key} className="chip border-line bg-paper-panel text-ink-muted">
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
