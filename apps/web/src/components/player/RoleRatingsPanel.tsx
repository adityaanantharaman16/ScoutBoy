import Link from "next/link";

import { ConfidenceBadge, StatBar } from "@/components/common";
import type { RoleRatingSummary } from "@/lib/api/types";
import { formatScore, scoreColor } from "@/lib/formatters";

export function RoleRatingsPanel({ ratings }: { ratings: RoleRatingSummary[] }) {
  return (
    <div className="space-y-2" data-testid="role-ratings">
      {ratings.map((r) => (
        <div key={r.role_key} className="card grid gap-3 sm:grid-cols-[180px_1fr_auto_auto] sm:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-semibold text-ink">
              {r.display_name}
              {r.is_best && <span className="chip border-pitch bg-[#e9f0ea] text-pitch-dark">best</span>}
            </div>
            <div className="text-[11px] text-ink-soft">
              {r.rank_in_peer_group ? `rank #${r.rank_in_peer_group} in peer group` : ""}
            </div>
          </div>
          <div>
            <StatBar score={r.final_score} />
          </div>
          <div className={`font-serif text-2xl font-bold ${scoreColor(r.final_score)}`}>
            {formatScore(r.final_score)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceBadge confidence={r.confidence} />
            <Link href={`/roles/${r.role_key}`} className="text-xs font-semibold text-pitch-dark hover:underline">
              board
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
