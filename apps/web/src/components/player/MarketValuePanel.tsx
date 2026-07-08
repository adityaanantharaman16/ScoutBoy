import { ConfidenceBadge } from "@/components/common";
import type { MarketPanel } from "@/lib/api/types";
import { formatEur, formatEurRange, marketLabelColor } from "@/lib/formatters";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-1.5 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export function MarketValuePanel({ market }: { market: MarketPanel | null | undefined }) {
  if (!market) return <div className="card text-sm text-slate-400">No market data.</div>;
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
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
          Flagged for manual review (outlier guardrail).
        </div>
      )}
      {labelBasis && <p className="mt-2 text-xs text-slate-500">{labelBasis}</p>}
      <p className="mt-1 text-[11px] text-slate-500">
        Ranges, not exact values. Public value, model value, and asking price are distinct.
      </p>
    </div>
  );
}
