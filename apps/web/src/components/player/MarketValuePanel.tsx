import { ConfidenceBadge } from "@/components/common";
import type { MarketPanel } from "@/lib/api/types";
import { formatEur, formatEurRange, marketLabelColor } from "@/lib/formatters";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="font-mono text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

export function MarketValuePanel({ market }: { market: MarketPanel | null | undefined }) {
  if (!market) return <div className="card text-sm text-ink-soft">No market data.</div>;
  const labelBasis = (market.explanation?.label_basis as string) ?? "";
  return (
    <div className="card" data-testid="market-panel">
      <div className="mb-2 flex items-center justify-between">
        <span className={`chip ${marketLabelColor(market.label)}`}>{market.label}</span>
        <ConfidenceBadge confidence={market.confidence} />
      </div>
      <Row label="Public market value" value={formatEur(market.public_value_eur)} />
      <Row
        label="Model value range"
        value={formatEurRange(market.model_value_low_eur, market.model_value_high_eur)}
      />
      <Row
        label="Expected asking price"
        value={formatEurRange(market.expected_asking_low_eur, market.expected_asking_high_eur)}
      />
      {market.manual_review_required && (
        <div className="mt-2 border border-accent-amber/50 bg-[#f6ecd7] px-2 py-1 text-xs text-accent-amber" style={{ borderRadius: 4 }}>
          Flagged for manual review (outlier guardrail).
        </div>
      )}
      {labelBasis && <p className="mt-2 text-xs text-ink-soft">{labelBasis}</p>}
      <p className="mt-1 text-[11px] text-ink-soft">
        Ranges, not exact values. Public value, model value, and asking price are distinct.
      </p>
    </div>
  );
}
