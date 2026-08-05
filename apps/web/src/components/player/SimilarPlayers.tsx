import Link from "next/link";

import { ScoreReadout } from "@/components/common";
import { CardActionBar } from "@/components/common/PlayerActions";
import type { SimilarPlayer, SimilarResponse } from "@/lib/api/types";
import { marketRangeText } from "@/lib/market/marketChart";

/**
 * One comparable player inside a comps card.
 *
 * Three stacked logical rows, so narrowing the viewport removes horizontal
 * pressure structurally instead of letting two columns collide:
 *   1. identity — name, then `Club · League`, each on exactly one line;
 *   2. evidence — RoleFit and the expected-asking range as two clearly separate
 *      labelled channels, side by side while there is room and stacked when not;
 *   3. the reason text and the two-part action bar.
 *
 * RoleFit reuses the shared `ScoreReadout`, so the band colour, the numeric face
 * and the one-decimal formatting are Discovery's — only the size is smaller. A
 * missing score therefore renders the shared "-" sentinel and is never shown as
 * zero. The market range is monospace and non-breaking, so it can never split
 * between its low and high endpoints.
 */
function ComparablePlayer({ player }: { player: SimilarPlayer }) {
  const identity = `${player.club ?? "-"} · ${player.league ?? "-"}`;
  return (
    <li className="min-w-0 border-t border-line pt-3 first:border-t-0 first:pt-0">
      {/* Long club/league or identity text truncates rather than wrapping or
          overflowing. The DOM text stays complete, so the accessible name is the
          full value, and `title` makes that value discoverable on the surface. */}
      <Link
        href={`/players/${player.player_id}`}
        className="block truncate text-sm font-semibold no-underline hover:underline"
        title={player.canonical_name}
      >
        {player.canonical_name}
      </Link>
      <div className="truncate text-xs text-ink-soft" title={identity} data-testid="similar-identity">
        {identity}
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div data-testid="similar-rolefit">
          <div className="label mb-0.5">RoleFit</div>
          <ScoreReadout score={player.best_role_score} size="sm" />
        </div>
        <div data-testid="similar-market">
          <div className="label mb-0.5">Expected asking</div>
          <div className="mono whitespace-nowrap text-xs font-semibold text-ink">
            {marketRangeText(player.expected_asking_low_eur, player.expected_asking_high_eur)}
          </div>
        </div>
      </div>

      <p className="mt-2 text-xs text-ink-soft">{player.reason}</p>

      <div className="mt-2.5">
        <CardActionBar player={{ id: player.player_id, name: player.canonical_name }} />
      </div>
    </li>
  );
}

/**
 * Comparable-player groups on the dossier. Every group the API returns is
 * rendered with its heading, description, ordering, membership and result cap
 * unchanged; only the presentation of a single entry changed.
 */
export function SimilarPlayers({ data }: { data: SimilarResponse }) {
  const groups = data.groups.filter((g) => g.players.length > 0);
  if (groups.length === 0) return <p className="text-sm text-ink-soft">No comparable players found.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {groups.map((g) => (
        <div key={g.key} className="card min-w-0" data-testid="similar-group">
          <div className="label">{g.label}</div>
          <p className="mb-2 text-xs text-ink-soft">{g.description}</p>
          <ul className="space-y-3">
            {g.players.slice(0, 5).map((p) => (
              <ComparablePlayer key={p.player_id} player={p} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
