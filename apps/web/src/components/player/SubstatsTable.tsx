import type { SubStat } from "@/lib/api/types";
import { scoreColor } from "@/lib/formatters";

export function SubstatsTable({ substats }: { substats: SubStat[] }) {
  if (substats.length === 0) return <p className="text-sm text-slate-500">No sub-stats available.</p>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1">Metric</th>
            <th className="py-1 text-right">Per 90</th>
            <th className="py-1 text-right">Percentile</th>
          </tr>
        </thead>
        <tbody>
          {substats.map((s) => (
            <tr key={s.name} className="border-t border-white/5">
              <td className="py-1">{s.display}</td>
              <td className="py-1 text-right">{s.per90_value == null ? "—" : s.per90_value.toFixed(2)}</td>
              <td className={`py-1 text-right font-medium ${scoreColor(s.score)}`}>
                {s.score == null ? "—" : Math.round(s.score)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
