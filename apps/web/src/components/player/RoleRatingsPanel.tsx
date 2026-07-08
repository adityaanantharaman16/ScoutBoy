import Link from "next/link";

import { ConfidenceBadge, StatBar } from "@/components/common";
import type { RoleRatingSummary } from "@/lib/api/types";
import { formatScore, scoreColor } from "@/lib/formatters";

export function RoleRatingsPanel({ ratings }: { ratings: RoleRatingSummary[] }) {
  return (
    <div className="space-y-2" data-testid="role-ratings">
      {ratings.map((r) => (
        <div key={r.role_key} className="card flex items-center gap-3">
          <div className="w-44 shrink-0">
            <div className="flex items-center gap-2 font-medium">
              {r.display_name}
              {r.is_best && <span className="chip border-accent/40 bg-accent/15 text-accent-soft">best</span>}
            </div>
            <div className="text-[11px] text-slate-500">
              {r.rank_in_peer_group ? `rank #${r.rank_in_peer_group} in peer group` : ""}
            </div>
          </div>
          <div className="flex-1">
            <StatBar score={r.final_score} />
          </div>
          <div className={`w-12 text-right text-lg font-bold ${scoreColor(r.final_score)}`}>
            {formatScore(r.final_score)}
          </div>
          <ConfidenceBadge confidence={r.confidence} />
          <Link
            href={`/roles/${r.role_key}`}
            className="text-xs text-accent-soft hover:underline"
          >
            board →
          </Link>
        </div>
      ))}
    </div>
  );
}
