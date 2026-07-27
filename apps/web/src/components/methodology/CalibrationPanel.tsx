import type { Methodology } from "@/lib/api/types";
import { titleCase } from "@/lib/formatters";

type Calibration = Methodology["calibration"];

/**
 * Compact, evidence-honest calibration/evidence panel for the Methodology page.
 * When calibration cannot be evaluated it renders an explicit inconclusive/unavailable state
 * (no fabricated totals, hashes, or success) while keeping the real-pilot limitation visible.
 */
export function CalibrationPanel({ calibration }: { calibration: Calibration }) {
  if (!calibration || calibration.available === false) {
    return (
      <div className="card" data-testid="calibration-unavailable">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip border-line bg-paper-muted text-[11px] text-ink-muted">
            Status: Inconclusive
          </span>
          <span className="chip border-line bg-paper-muted text-[11px] text-ink-muted">
            Evidence Unavailable
          </span>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {calibration?.methodology_note ??
            "Calibration evidence is unavailable in this environment."}
        </p>
        <p className="mt-2 border-l-2 border-accent-red pl-2 text-xs text-ink-muted">
          <span className="font-semibold text-accent-red">Real-pilot limitation:</span>{" "}
          {calibration?.pilot_coverage_limitation ??
            "The real-data pilot is a Bayer Leverkusen-centered StatsBomb slice, not full coverage."}
        </p>
      </div>
    );
  }

  return (
    <div className="card" data-testid="calibration-available">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip border-pitch bg-[#e9f0ea] text-pitch-dark">
          Suite {calibration.suite_id} {calibration.suite_version}
        </span>
        <span className="chip border-line bg-paper-muted text-[11px] text-ink-muted">
          Status: {titleCase(calibration.status)}
        </span>
        <span className="chip border-line bg-paper-muted text-[11px] text-ink-muted">
          Benchmarks {calibration.benchmarks.passed}/{calibration.benchmarks.total} Pass
        </span>
        <span className="chip border-line bg-paper-muted text-[11px] text-ink-muted">
          Guardrails {calibration.scenarios.passed}/{calibration.scenarios.total} Pass
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{calibration.methodology_note}</p>
      <p className="mt-2 text-xs text-ink-soft">
        Rating {calibration.rating_version} · calibration {calibration.calibration_version} ·
        contract hash <span className="font-mono">{calibration.config_hash}</span>
      </p>
      <p className="mt-2 border-l-2 border-accent-red pl-2 text-xs text-ink-muted">
        <span className="font-semibold text-accent-red">Real-pilot limitation:</span>{" "}
        {calibration.pilot_coverage_limitation}
      </p>
    </div>
  );
}
