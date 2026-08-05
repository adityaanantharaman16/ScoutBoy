import {
  ConfidenceReadout,
  DisplayTag,
  MarketReadout,
  Notice,
  ScoreReadout,
} from "@/components/common";
import type {
  CompareResponse,
  CompareSide,
  CompareStatRow,
  ContextPanel,
  RoleRatingSummary,
} from "@/lib/api/types";
import { scoreColor, titleCase } from "@/lib/formatters";

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

/**
 * Compact, parallel evidence-context summary for one comparison column. It only
 * reports fields the API actually supplied — nothing is recomputed, combined,
 * ranked, or graded, and a genuine numeric zero is preserved (missing values are
 * omitted, never shown as 0). When the whole context object is absent it shows a
 * restrained, explicit fallback. Flat + hairline (no nested card / elevation).
 */
function EvidenceContext({
  context,
  align,
}: {
  context: ContextPanel | null | undefined;
  align: "left" | "right";
}) {
  const alignCls = align === "right" ? "sm:text-right" : "";

  if (!context) {
    return (
      <div
        className={`w-full border-t border-line pt-2 ${alignCls}`}
        data-testid={`compare-context-${align}`}
      >
        <p className="text-[11px] text-ink-soft">Evidence context unavailable</p>
      </div>
    );
  }

  // Short labelled facts — each included only when genuinely supplied.
  const facts: Array<{ label: string; value: React.ReactNode }> = [];
  if (context.minutes != null) facts.push({ label: "Minutes", value: context.minutes });
  const played: string[] = [];
  if (context.appearances != null) played.push(`${context.appearances} apps`);
  if (context.starts != null) played.push(`${context.starts} starts`);
  if (played.length > 0) facts.push({ label: "Played", value: played.join(" · ") });
  if (context.matches_covered != null) {
    facts.push({ label: "Matches covered", value: context.matches_covered });
  }
  if (context.competition_coverage_pct != null) {
    facts.push({
      label: "Competition coverage",
      value: `${Math.round(context.competition_coverage_pct * 100)}%`,
    });
  }
  const sampleConf = context.sample_size_confidence ?? context.sample_confidence;
  if (sampleConf != null) facts.push({ label: "Sample confidence", value: titleCase(sampleConf) });
  if (context.coverage_confidence != null) {
    facts.push({ label: "Coverage confidence", value: titleCase(context.coverage_confidence) });
  }
  if (context.overall_rating_confidence != null) {
    facts.push({ label: "Overall evidence", value: titleCase(context.overall_rating_confidence) });
  }
  if (context.data_source != null) facts.push({ label: "Source", value: context.data_source });
  if (context.data_type != null) facts.push({ label: "Data type", value: context.data_type });

  // Longer free-text notes — must wrap safely, shown verbatim.
  const notes: Array<{ label: string; text: string }> = [];
  if (context.translation_risk) notes.push({ label: "Translation risk", text: context.translation_risk });
  if (context.limitations && context.limitations.length > 0) {
    notes.push({ label: "Limitation", text: context.limitations[0] });
  }

  return (
    <div
      className={`w-full border-t border-line pt-2 ${alignCls}`}
      data-testid={`compare-context-${align}`}
    >
      <div className="label mb-1">Evidence context</div>
      {facts.length === 0 && notes.length === 0 ? (
        <p className="text-[11px] text-ink-soft">No detailed evidence supplied</p>
      ) : (
        <>
          <div className="space-y-0.5">
            {facts.map((f) => (
              <div key={f.label} className="text-[11px] leading-snug text-ink-soft">
                {f.label} <span className="font-semibold text-ink">{f.value}</span>
              </div>
            ))}
          </div>
          {notes.map((n) => (
            <p key={n.label} className="mt-1 break-words text-[11px] leading-snug text-ink-soft">
              <span className="font-semibold text-ink-muted">{n.label}:</span> {n.text}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

function roleRatingFor(side: CompareSide, roleKey: string | null | undefined): RoleRatingSummary | undefined {
  if (!roleKey) return undefined;
  return side.role_ratings.find((r) => r.role_key === roleKey);
}

/**
 * One side of the balance sheet. Renders the player's stored RoleFit score and
 * role-level confidence for the selected role — or an explicit "not rated in
 * this role" state when a role *is* selected and that rating is absent. When no
 * role was selected at all (no shared rated role) the role slot stays empty
 * rather than blaming either side. Market and playstyles are shown in parallel
 * with the other side. Nothing here is recomputed.
 */
function BalanceColumn({
  side,
  roleKey,
  align,
}: {
  side: CompareSide;
  roleKey: string | null | undefined;
  align: "left" | "right";
}) {
  const rating = roleRatingFor(side, roleKey);
  const alignCls = align === "right" ? "sm:text-right sm:items-end" : "";
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${alignCls}`} data-testid={`compare-side-${align}`}>
      <div className="min-w-0">
        <div className="tracking-tight text-xl font-bold leading-tight text-ink">
          {side.identity.canonical_name}
        </div>
        <div className="text-xs text-ink-soft">
          {side.identity.club ?? "-"} · {side.identity.league ?? "-"}
        </div>
      </div>
      {rating ? (
        <>
          <ScoreReadout
            score={rating.final_score}
            className={align === "right" ? "sm:self-end" : ""}
          />
          <ConfidenceReadout level={rating.confidence} />
        </>
      ) : roleKey ? (
        <div
          className="inline-flex w-fit border border-line-strong bg-paper-muted px-2 py-1 text-xs font-semibold text-ink-muted"
          data-testid={`compare-unavailable-${align}`}
        >
          Not rated in this role
        </div>
      ) : null}
      {/* The right column mirrors the left: its risk tag hugs the outer (right)
          edge with the range reading inward. */}
      <MarketReadout
        label={side.market?.label}
        low={side.market?.expected_asking_low_eur}
        high={side.market?.expected_asking_high_eur}
        align={align === "right" ? "end" : "start"}
      />
      {side.playstyles.length > 0 && (
        <div className={`flex flex-wrap gap-1 ${align === "right" ? "sm:justify-end" : ""}`}>
          {side.playstyles.slice(0, 4).map((b) => (
            <DisplayTag key={b.playstyle_key} variant="playstyle">
              {b.display_name}
            </DisplayTag>
          ))}
        </div>
      )}
      <EvidenceContext context={side.context} align={align} />
    </div>
  );
}

export function PlayerCompareTable({ data }: { data: CompareResponse }) {
  const rows = data.stat_rows as unknown as CompareStatRow[];
  const aName = firstName(data.player_a.identity.canonical_name);
  const bName = firstName(data.player_b.identity.canonical_name);
  // A null role_key means the API found no role both players are rated in. No
  // score or confidence is invented for either side; the rest of the evidence
  // (market, context, normalized metrics) stays usable.
  const hasRole = data.role_key != null;

  const value = (v: number | null) => (v == null ? "Unknown" : String(Math.round(v)));
  const leads = (a: number | null, b: number | null, side: "a" | "b") => {
    if (a == null || b == null || a === b) return false;
    return side === "a" ? a > b : b > a;
  };

  return (
    <div className="space-y-6" data-testid="compare-table">
      {/* Balance sheet: two equal player columns divided by a central role spine.
          The role label sits on its own full-width row so long names never crush
          it, and the API's `why_higher` is the main editorial conclusion. */}
      <div className="card">
        <div className="text-center">
          <div className="label">{hasRole ? "Comparing as" : "Role comparison"}</div>
          {/* Title case for the visible heading only — the API's explanatory
              sentence keeps its sentence case and is not restyled here. */}
          <div className="text-2xl font-bold tracking-tight text-ink" data-testid="compare-role">
            {data.role_display ?? "No Shared Rated Role"}
          </div>
          <div
            className="mt-0.5 text-[11px] text-ink-soft"
            data-testid={hasRole ? "compare-role-note" : "compare-no-shared-role"}
          >
            {hasRole
              ? `RoleFit score and confidence shown per side · ${data.season}`
              : `Market, evidence context and normalized metrics below are unaffected · ${data.season}`}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-0">
          <div className="sm:pr-5">
            <BalanceColumn side={data.player_a} roleKey={data.role_key} align="left" />
          </div>
          <div className="border-t border-line pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <BalanceColumn side={data.player_b} roleKey={data.role_key} align="right" />
          </div>
        </div>

        <p
          className="mt-5 border border-line bg-paper-muted p-3 text-sm leading-relaxed text-ink"
          data-testid="why-higher"
        >
          {data.why_higher}
        </p>

        {data.confidence_warnings.length > 0 && (
          <div className="mt-3 space-y-2" data-testid="confidence-warnings">
            {data.confidence_warnings.map((w, i) => (
              <Notice key={i} tone="caution" title="Confidence warning">
                {w}
              </Notice>
            ))}
          </div>
        )}
      </div>

      {/* Metric comparison ledger — the stored normalized (0–100) percentile
          scores, re-presented for comparison. Missing scores read "Unknown",
          never zero; no metric categories are invented and nothing is recomputed. */}
      <div>
        <div className="label mb-2">Normalized metric comparison · percentile score (0–100)</div>

        {/* Desktop: aligned three-column balance table. */}
        <div className="table-shell hidden md:block">
          <table className="data-table" data-testid="compare-metric-ledger">
            <thead>
              <tr>
                <th className="text-right">{aName}</th>
                <th className="text-center">Metric</th>
                <th>{bName}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.metric}>
                  <td
                    className={`text-right font-mono ${scoreColor(r.a_score)} ${
                      leads(r.a_score, r.b_score, "a") ? "font-bold" : "font-normal"
                    }`}
                  >
                    {value(r.a_score)}
                  </td>
                  <td className="text-center text-ink-muted">{r.display}</td>
                  <td
                    className={`font-mono ${scoreColor(r.b_score)} ${
                      leads(r.a_score, r.b_score, "b") ? "font-bold" : "font-normal"
                    }`}
                  >
                    {value(r.b_score)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: metric label plus both player values, no horizontal overflow. */}
        <div
          className="divide-y divide-line overflow-hidden border border-line bg-paper-panel md:hidden"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] gap-2 bg-paper-muted px-3 py-2">
            <span className="label">Metric</span>
            <span className="label truncate text-right">{aName}</span>
            <span className="label truncate text-right">{bName}</span>
          </div>
          {rows.map((r) => (
            <div key={r.metric} className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] gap-2 px-3 py-2">
              <span className="text-xs text-ink-muted">{r.display}</span>
              <span
                className={`text-right font-mono text-xs ${scoreColor(r.a_score)} ${
                  leads(r.a_score, r.b_score, "a") ? "font-bold" : ""
                }`}
              >
                {value(r.a_score)}
              </span>
              <span
                className={`text-right font-mono text-xs ${scoreColor(r.b_score)} ${
                  leads(r.a_score, r.b_score, "b") ? "font-bold" : ""
                }`}
              >
                {value(r.b_score)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
