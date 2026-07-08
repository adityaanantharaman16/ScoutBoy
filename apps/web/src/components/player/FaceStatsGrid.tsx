import { StatBar } from "@/components/common";
import type { FaceStat } from "@/lib/api/types";
import { formatScore, scoreColor } from "@/lib/formatters";

export function FaceStatsGrid({ faceStats }: { faceStats: FaceStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {faceStats.map((f) => (
        <div key={f.group_key} className="card">
          <div className="label">{f.group_label}</div>
          <div className={`text-xl font-bold ${scoreColor(f.score)}`}>
            {f.score == null ? "unknown" : formatScore(f.score)}
          </div>
          <div className="mt-2">
            <StatBar score={f.score} />
          </div>
        </div>
      ))}
    </div>
  );
}
