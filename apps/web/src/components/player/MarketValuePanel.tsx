import { DisplayTag } from "@/components/common/DisplayTag";
import { ConfidenceMeter } from "@/components/player/ConfidenceMeter";
import type { MarketPanel } from "@/lib/api/types";
import { formatEur, marketLabelText } from "@/lib/formatters";
import {
  askingVsModelGap,
  axisEurLabel,
  axisPos,
  marketRangeText,
  marketValues,
  niceAxis,
  num,
  rangeKind,
} from "@/lib/market/marketChart";

// Shared-axis geometry (display only). Tall, substantial rows so the panel
// balances the Context & Coverage card beside it without dead whitespace.
const VB_W = 340;
const VB_H = 236;
const PLOT_L = 12;
const PLOT_R = 330;
const ASK_Y = 48;
const MODEL_Y = 110;
const PUBLIC_Y = 170;
const AXIS_Y = 206;

function LegendSwatch({ kind }: { kind: "public" | "model" | "ask" }) {
  if (kind === "public") {
    return <span aria-hidden="true" className="inline-block h-3 w-1.5 bg-ink align-middle" />;
  }
  if (kind === "model") {
    return <span aria-hidden="true" className="inline-block h-3 w-4 bg-pitch align-middle" />;
  }
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-4 border border-accent-amber align-middle"
      style={{ background: "#e0cfa4" }}
    />
  );
}

export function MarketValuePanel({ market }: { market: MarketPanel | null | undefined }) {
  if (!market) return <div className="card text-sm text-ink-soft" data-testid="market-panel">No market data.</div>;

  const publicV = num(market.public_value_eur);
  const modelLow = num(market.model_value_low_eur);
  const modelHigh = num(market.model_value_high_eur);
  const askLow = num(market.expected_asking_low_eur);
  const askHigh = num(market.expected_asking_high_eur);

  const values = marketValues(market);
  const axis = values.length > 0 ? niceAxis(Math.min(...values), Math.max(...values)) : null;
  const gap = askingVsModelGap(market);
  const labelBasis = (market.explanation?.label_basis as string) ?? "";

  const x = (v: number) => PLOT_L + (axis ? axisPos(v, axis) : 0.5) * (PLOT_R - PLOT_L);
  const clampLabelX = (cx: number) => Math.max(PLOT_L + 16, Math.min(PLOT_R - 16, cx));

  let interpretation = "";
  if (gap != null) {
    if (gap > 0) interpretation = `Expected ask opens ${formatEur(gap)} above the model’s high end.`;
    else if (gap < 0) interpretation = `Expected ask sits ${formatEur(Math.abs(gap))} below the model’s high end.`;
    else interpretation = "Expected ask meets the model’s high end.";
  }

  const publicText = publicV != null ? formatEur(publicV) : "Unknown";
  const modelText = marketRangeText(modelLow, modelHigh);
  const askText = marketRangeText(askLow, askHigh);

  // One chart row: a full interval, a one-sided open bound ("From"/"Up to"), or an
  // explicit "unknown" — a missing endpoint is never plotted at zero.
  const renderRow = (low: number | null, high: number | null, y: number, fill: string, stroke: string) => {
    if (!axis) return null;
    const kind = rangeKind(low, high);
    if (kind === "both") {
      const x1 = x(Math.min(low!, high!));
      const x2 = x(Math.max(low!, high!));
      const w = Math.max(4, x2 - x1);
      return <rect x={x1} y={y - 12} width={w} height={24} fill={fill} stroke={stroke} strokeWidth={1} />;
    }
    if (kind === "from" || kind === "upto") {
      const value = kind === "from" ? low! : high!;
      const cx = x(value);
      const dir = kind === "from" ? 1 : -1;
      const tail = cx + dir * 34;
      return (
        <g>
          <line x1={cx} y1={y} x2={tail} y2={y} stroke={stroke} strokeWidth={2.5} strokeDasharray="2 3" opacity={0.7} />
          <path d={`M ${tail} ${y - 4} L ${tail + dir * 5} ${y} L ${tail} ${y + 4}`} fill="none" stroke={stroke} strokeWidth={2.5} opacity={0.7} />
          <circle cx={cx} cy={y} r={7} fill={fill} stroke={stroke} strokeWidth={1.5} />
        </g>
      );
    }
    return (
      <text x={PLOT_L} y={y + 3} style={{ fontSize: 9 }} className="fill-[color:var(--ink-soft)]">
        unknown
      </text>
    );
  };

  return (
    <div className="card flex h-full flex-col" data-testid="market-panel">
      <p className="mb-2 text-xs text-ink-soft" data-testid="market-lead">
        Public value, model range, and expected ask on a shared euro axis.
      </p>

      {/* Legend — the accessible source of every value. */}
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 text-ink-muted">
          <LegendSwatch kind="public" /> Public market value{" "}
          <span className="font-mono font-semibold text-ink">{publicText}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-muted">
          <LegendSwatch kind="model" /> Model value range{" "}
          <span className="font-mono font-semibold text-ink">{modelText}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-muted">
          <LegendSwatch kind="ask" /> Expected asking price{" "}
          <span className="font-mono font-semibold text-ink">{askText}</span>
        </span>
      </div>

      {/* Chart (decorative; every value is in the legend above + summary below). */}
      {axis ? (
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          role="img"
          aria-label={`Market valuation on a shared euro axis. Public market value ${publicText}. Model value range ${modelText}. Expected asking price ${askText}.`}
          className="mx-auto block h-auto w-full max-w-[520px]"
          data-testid="market-chart"
        >
          {/* row labels */}
          <g className="fill-[color:var(--ink-soft)]" style={{ fontSize: 9, letterSpacing: "0.06em" }}>
            <text x={PLOT_L} y={ASK_Y - 17}>EXPECTED ASK</text>
            <text x={PLOT_L} y={MODEL_Y - 17}>MODEL</text>
            <text x={PLOT_L} y={PUBLIC_Y - 17}>PUBLIC</text>
          </g>

          {/* expected ask — full interval, one-sided bound, or unknown */}
          {renderRow(askLow, askHigh, ASK_Y, "#e0cfa4", "var(--amber)")}
          {/* model — full interval, one-sided bound, or unknown */}
          {renderRow(modelLow, modelHigh, MODEL_Y, "var(--pitch)", "var(--pitch-dark)")}
          {/* public point (exact value is in the legend above) */}
          {publicV != null ? (
            <line x1={x(publicV)} y1={PUBLIC_Y - 13} x2={x(publicV)} y2={PUBLIC_Y + 13} stroke="var(--ink)" strokeWidth={3} />
          ) : (
            <text x={PLOT_L} y={PUBLIC_Y + 3} style={{ fontSize: 9 }} className="fill-[color:var(--ink-soft)]">unknown</text>
          )}

          {/* axis */}
          <line x1={PLOT_L} y1={AXIS_Y} x2={PLOT_R} y2={AXIS_Y} stroke="var(--line-strong)" strokeWidth={1} />
          {axis.ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} y1={AXIS_Y} x2={x(t)} y2={AXIS_Y + 4} stroke="var(--line-strong)" strokeWidth={1} />
              <text x={clampLabelX(x(t))} y={AXIS_Y + 15} textAnchor="middle" style={{ fontSize: 9 }} className="fill-[color:var(--ink-soft)] font-mono">
                {axisEurLabel(t)}
              </text>
            </g>
          ))}
        </svg>
      ) : (
        <p className="py-3 text-sm text-ink-soft">No plottable market values - all reads are unknown.</p>
      )}

      {/* label + confidence + interpretation */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-sm">
        <DisplayTag variant="market" value={market.label}>{marketLabelText(market.label)}</DisplayTag>
        <span className="inline-flex items-center gap-1.5 text-ink-muted">
          Valuation confidence <ConfidenceMeter level={market.confidence} />
        </span>
        {interpretation && <span className="text-ink-muted">{interpretation}</span>}
      </div>

      {market.manual_review_required && (
        <div
          className="mt-2 border border-accent-amber/60 bg-[#f6ecd7] px-3 py-2 text-xs font-semibold text-accent-amber"
          data-testid="market-review"
        >
          Flagged for manual review (outlier guardrail).
        </div>
      )}

      {labelBasis && (
        <div className="mt-3 border-t border-line pt-3" data-testid="market-why">
          <div className="label mb-1">Why This Valuation</div>
          <p className="text-xs text-ink-muted">{labelBasis}</p>
        </div>
      )}

      <p className="mt-auto pt-3 text-[11px] text-ink-soft">
        Ranges, not exact values. Public value, model value, and asking price are distinct reads.
      </p>
    </div>
  );
}
