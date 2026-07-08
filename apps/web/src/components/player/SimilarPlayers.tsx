import Link from "next/link";

import type { SimilarResponse } from "@/lib/api/types";
import { formatEurRange, formatScore } from "@/lib/formatters";

export function SimilarPlayers({ data }: { data: SimilarResponse }) {
  const groups = data.groups.filter((g) => g.players.length > 0);
  if (groups.length === 0) return <p className="text-sm text-slate-500">No comparable players found.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {groups.map((g) => (
        <div key={g.key} className="card">
          <div className="label">{g.label}</div>
          <p className="mb-2 text-xs text-slate-500">{g.description}</p>
          <ul className="space-y-1">
            {g.players.slice(0, 5).map((p) => (
              <li key={p.player_id} className="flex items-center justify-between text-sm">
                <Link href={`/players/${p.player_id}`} className="hover:text-accent-soft">
                  {p.canonical_name}
                </Link>
                <span className="text-xs text-slate-400">
                  {formatScore(p.best_role_score)} · {formatEurRange(p.expected_asking_low_eur, p.expected_asking_high_eur)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
