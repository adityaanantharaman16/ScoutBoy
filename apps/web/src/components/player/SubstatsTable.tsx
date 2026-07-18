import type { SubStat } from "@/lib/api/types";
import { scoreColor } from "@/lib/formatters";

export function SubstatsTable({ substats }: { substats: SubStat[] }) {
  if (substats.length === 0) return <p className="text-sm text-ink-soft">No sub-stats available.</p>;
  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="text-right">Per 90</th>
            <th className="text-right">Percentile</th>
          </tr>
        </thead>
        <tbody>
          {substats.map((s) => (
            <tr key={s.name}>
              <td>{s.display}</td>
              <td className="text-right font-mono">{s.per90_value == null ? "—" : s.per90_value.toFixed(2)}</td>
              <td className={`text-right font-mono font-semibold ${scoreColor(s.score)}`}>
                {s.score == null ? "—" : Math.round(s.score)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
