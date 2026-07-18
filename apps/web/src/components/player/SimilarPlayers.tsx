import Link from "next/link";

import { PlayerActionRow } from "@/components/common/PlayerActions";
import type { SimilarResponse } from "@/lib/api/types";
import { formatEurRange, formatScore } from "@/lib/formatters";

export function SimilarPlayers({ data }: { data: SimilarResponse }) {
  const groups = data.groups.filter((g) => g.players.length > 0);
  if (groups.length === 0) return <p className="text-sm text-ink-soft">No comparable players found.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {groups.map((g) => (
        <div key={g.key} className="card">
          <div className="label">{g.label}</div>
          <p className="mb-2 text-xs text-ink-soft">{g.description}</p>
          <ul className="space-y-3">
            {g.players.slice(0, 5).map((p) => (
              <li key={p.player_id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <Link href={`/players/${p.player_id}`} className="font-semibold hover:underline">
                      {p.canonical_name}
                    </Link>
                    <div className="text-xs text-ink-soft">{p.club ?? "—"} · {p.league ?? "—"}</div>
                  </div>
                  <span className="font-mono text-xs text-ink-muted">
                    {formatScore(p.best_role_score)} · {formatEurRange(p.expected_asking_low_eur, p.expected_asking_high_eur)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{p.reason}</p>
                <div className="mt-2">
                  <PlayerActionRow player={{ id: p.player_id, name: p.canonical_name }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
