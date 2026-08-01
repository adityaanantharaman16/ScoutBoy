"use client";

import { useMemo, useState } from "react";

import { ConfidenceMeter } from "@/components/player/ConfidenceMeter";
import type { AuditGroupView } from "@/lib/api/types";
import { isGroupUnknown, orderGroupsByWeight } from "@/lib/audit/roleAudit";
import { scoreBarClass, scoreColor, titleCase } from "@/lib/formatters";
import {
  groupShortLabel,
  TERRITORIES,
  territoryForGroup,
  territoryMeta,
  type TerritoryId,
} from "@/lib/territory/roleTerritoryMap";

// The exact, permanent illustrative-data disclosure. Rendered as visible text
// (never a tooltip) directly beside the pitch.
export const TERRITORY_DISCLOSURE =
  "Illustrative role territory derived from RoleFit evidence groups. Not tracking or event-location data.";

// Illustrative pitch geometry (abstract; not coordinates). Portrait, attacking
// upward. Drawn in a 300×430 viewBox; markers are overlaid in % so their labels
// stay crisp and legible at any size.
const VB_W = 300;
const VB_H = 430;

interface Zone {
  key: string;
  label: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  score: number | null;
  unknown: boolean;
}

// Vertical band (percent of pitch height) each territory highlight occupies.
// These are broad thirds/box regions — illustrative, not measured positions.
const TERRITORY_BAND: Record<TerritoryId, [number, number]> = {
  att_box: [3, 20],
  att_third: [21.5, 44],
  mid_third: [45.5, 70],
  def_third: [71.5, 96],
};

// Translucent highlight opacity from the stored group score (a subtle magnitude
// "heat"). Kept low enough that the white pitch markings read through every zone.
function zoneOpacity(score: number | null): number {
  if (score == null) return 0;
  const s = Math.max(0, Math.min(100, score));
  return 0.18 + 0.4 * (s / 100);
}

// Full-width band strip per territory, subdivided into one translucent column
// per group (arranged side by side — never stacked opaque boxes).
function layoutZones(groups: AuditGroupView[]): Zone[] {
  const zones: Zone[] = [];
  const L = 8;
  const R = 92;
  for (const t of TERRITORIES) {
    const inBand = groups.filter((g) => territoryForGroup(g.key) === t.id);
    const n = inBand.length;
    if (n === 0) continue;
    const [b0, b1] = TERRITORY_BAND[t.id];
    const gap = n > 1 ? 2 : 0;
    const colW = (R - L - gap * (n - 1)) / n;
    inBand.forEach((g, i) => {
      zones.push({
        key: g.key,
        label: groupShortLabel(g.key),
        leftPct: L + i * (colW + gap),
        topPct: b0,
        widthPct: colW,
        heightPct: b1 - b0,
        score: g.group_score,
        unknown: isGroupUnknown(g),
      });
    });
  }
  return zones;
}

function territoryLabel(id: TerritoryId | null): string {
  return id ? territoryMeta(id).label : "Not shown on pitch · non-spatial evidence";
}

/** SVG pitch markings drawn in white against the green field. */
function PitchField() {
  const line = "var(--pitch-line)";
  const stroke = 1.4;
  // horizontal mowing stripes
  const stripes = [10, 78.3, 146.6, 214.9, 283.2, 351.5];
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role="presentation"
      aria-hidden="true"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
    >
      <rect x="0" y="0" width={VB_W} height={VB_H} fill="var(--pitch-field)" />
      {stripes.map((y, i) => (
        <rect
          key={y}
          x="0"
          y={y}
          width={VB_W}
          height={68.3}
          fill={i % 2 === 0 ? "var(--pitch-field)" : "var(--pitch-field-alt)"}
        />
      ))}
      <g fill="none" stroke={line} strokeWidth={stroke}>
        {/* outer boundary */}
        <rect x="10" y="10" width="280" height="410" />
        {/* halfway line + centre circle + spot */}
        <line x1="10" y1="215" x2="290" y2="215" />
        <circle cx="150" cy="215" r="34" />
        {/* top penalty area, six-yard box, arc */}
        <rect x="75" y="10" width="150" height="68" />
        <rect x="115" y="10" width="70" height="24" />
        <path d="M108 78 A 46 46 0 0 0 192 78" />
        {/* bottom penalty area, six-yard box, arc */}
        <rect x="75" y="352" width="150" height="68" />
        <rect x="115" y="396" width="70" height="24" />
        <path d="M108 352 A 46 46 0 0 1 192 352" />
        {/* goals */}
        <rect x="130" y="4" width="40" height="6" />
        <rect x="130" y="420" width="40" height="6" />
      </g>
      <g fill={line}>
        <circle cx="150" cy="215" r="1.8" />
        <circle cx="150" cy="56" r="1.8" />
        <circle cx="150" cy="374" r="1.8" />
      </g>
    </svg>
  );
}

// Shared highlight state so the pitch and the evidence list stay in sync even
// when the desk places them in separate columns.
export interface TerritoryHighlight {
  activeKey: string | null;
  pinnedKey: string | null;
  onHover: (key: string | null) => void;
  onPin: (key: string) => void;
}

export function useTerritoryHighlight(): TerritoryHighlight {
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  return {
    activeKey: hover ?? pinned,
    pinnedKey: pinned,
    onHover: setHover,
    onPin: (key: string) => setPinned((p) => (p === key ? null : key)),
  };
}

/** The illustrative pitch card (the single elevated surface). */
export function RoleTerritoryPitch({
  roleDisplayName,
  groups,
  roleConfidence,
  confidenceScore,
  highlight,
  className = "",
}: {
  roleDisplayName: string;
  groups: AuditGroupView[];
  roleConfidence: string | null | undefined;
  confidenceScore?: number | null;
  highlight: TerritoryHighlight;
  className?: string;
}) {
  const ordered = useMemo(() => orderGroupsByWeight(groups), [groups]);
  const zones = useMemo(() => layoutZones(ordered), [ordered]);
  const lowReliability = roleConfidence === "low" || roleConfidence == null;
  const active = highlight.activeKey;

  return (
      <div className={`territory-surface flex flex-col p-4 ${className}`} data-testid="role-territory">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="label">Role Territory · {roleDisplayName}</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            Reliability
            <ConfidenceMeter level={roleConfidence} score={confidenceScore} />
          </span>
        </div>
        <p className="mb-3 text-[11px] text-ink-soft">Attacking Direction ↑</p>

        {/* Decorative pitch illustration + translucent territory highlights. The
            SVG markings read through each overlay; every value is also text in the
            evidence list, so the visual layer stays aria-hidden. */}
        <div className="relative mx-auto w-full max-w-[320px]" style={{ aspectRatio: "300 / 430" }}>
          <PitchField />
          <div className="absolute inset-0" aria-hidden="true">
            {zones.map((z) => {
              const isActive = active === z.key;
              return (
                <div
                  key={z.key}
                  className="absolute flex flex-col items-center justify-center text-center"
                  style={{
                    left: `${z.leftPct}%`,
                    top: `${z.topPct}%`,
                    width: `${z.widthPct}%`,
                    height: `${z.heightPct}%`,
                    padding: "2px 4px",
                    background: z.unknown
                      ? "repeating-linear-gradient(45deg, rgba(244,242,234,0.34) 0 2px, transparent 2px 6px)"
                      : `rgba(46, 160, 110, ${zoneOpacity(z.score) + (isActive ? 0.14 : 0)})`,
                    border: z.unknown
                      ? "1px dashed rgba(244,242,234,0.6)"
                      : isActive
                      ? "2px solid rgba(244,242,234,0.95)"
                      : "1px solid rgba(244,242,234,0.4)",
                  }}
                >
                  <span
                    className="text-[8.5px] font-bold uppercase leading-[1.05] tracking-wide text-paper"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}
                  >
                    {z.label}
                  </span>
                  <span
                    className="font-sans text-lg font-bold leading-none text-paper"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.55)" }}
                  >
                    {z.unknown ? "?" : Math.round(z.score as number)}
                  </span>
                  {z.unknown && (
                    <span className="text-[7.5px] uppercase tracking-wide text-paper/80" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                      unknown
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <p className="mt-3 text-xs text-ink-soft" data-testid="territory-disclosure">
          {TERRITORY_DISCLOSURE}
        </p>
        {lowReliability && (
          <p className="mt-1 text-xs text-accent-rust">
            Lower selected-role confidence — read the territory as directional, not definitive.
          </p>
        )}

        {/* legend */}
        <div
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2 text-[11px] text-ink-muted"
          data-testid="territory-legend"
        >
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-flex overflow-hidden border border-[rgba(244,242,234,0.4)]">
              <span className="inline-block h-3 w-3" style={{ background: "rgba(46,160,110,0.22)" }} />
              <span className="inline-block h-3 w-3" style={{ background: "rgba(46,160,110,0.55)" }} />
            </span>
            Brighter zone = higher group score
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 border border-dashed border-line-strong"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, var(--line-strong) 0 1.5px, transparent 1.5px 4px)",
              }}
            />
            Unknown (no measured evidence)
          </span>
          <span className="text-ink-soft">Confidence &amp; role weight shown separately.</span>
        </div>
      </div>
  );
}

/** The interactive, keyboard-operable evidence list (the accessible source of truth). */
export function RoleEvidenceList({
  groups,
  highlight,
  className = "",
}: {
  groups: AuditGroupView[];
  highlight: TerritoryHighlight;
  className?: string;
}) {
  const ordered = useMemo(() => orderGroupsByWeight(groups), [groups]);
  const { activeKey, pinnedKey, onHover, onPin } = highlight;
  return (
      <ul className={`space-y-2 ${className}`} data-testid="role-evidence-list">
        {ordered.map((g) => {
          const terr = territoryForGroup(g.key);
          const unknown = isGroupUnknown(g);
          const present = g.metrics.filter((m) => m.present);
          const missing = g.metrics.filter((m) => !m.present);
          const isActive = activeKey === g.key;
          return (
            <li key={g.key}>
              <button
                type="button"
                data-testid={`evidence-group-${g.key}`}
                aria-pressed={pinnedKey === g.key}
                aria-label={`${titleCase(g.key)}: ${
                  unknown ? "unknown, no measured evidence" : `score ${Math.round(g.group_score as number)}`
                }, role weight ${Math.round(g.normalized_weight * 100)} percent, ${territoryLabel(terr)}`}
                className={`w-full scroll-mt-24 border px-3 py-2 text-left transition ${
                  isActive ? "border-line-strong bg-paper-muted" : "border-line bg-paper-panel hover:border-line-strong"
                }`}
                onMouseEnter={() => onHover(g.key)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(g.key)}
                onBlur={() => onHover(null)}
                onClick={() => onPin(g.key)}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-ink">{titleCase(g.key)}</span>
                  <span className={`tracking-tight text-xl font-bold ${scoreColor(g.group_score)}`}>
                    {unknown ? "unknown" : Math.round(g.group_score as number)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
                  <span>{territoryLabel(terr)}</span>
                  <span>· Role weight {Math.round(g.normalized_weight * 100)}%</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden bg-track" aria-hidden="true">
                  {!unknown && (
                    <div
                      className={`h-full ${scoreBarClass(g.group_score)}`}
                      style={{ width: `${Math.max(0, Math.min(100, g.group_score as number))}%` }}
                    />
                  )}
                </div>
                <div className="mt-1.5 text-[11px] text-ink-muted">
                  {unknown ? (
                    <span>No measured evidence for this group — shown as unknown, not zero.</span>
                  ) : (
                    <>
                      {present.length > 0 && <span>Measured: {present.map((m) => m.display).join(", ")}</span>}
                      {missing.length > 0 && (
                        <span className="block text-ink-soft">
                          Missing: {missing.map((m) => m.display).join(", ")} (not measured)
                        </span>
                      )}
                      {present.length === 0 && missing.length === 0 && (
                        <span className="text-ink-soft">No metric detail provided.</span>
                      )}
                    </>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
  );
}

/** Combined pitch + evidence list side by side — used standalone and in tests. */
export function RoleTerritory(props: {
  roleDisplayName: string;
  groups: AuditGroupView[];
  roleConfidence: string | null | undefined;
  confidenceScore?: number | null;
}) {
  const highlight = useTerritoryHighlight();
  return (
    <div className="space-y-4 lg:grid lg:grid-cols-[minmax(220px,300px)_1fr] lg:items-start lg:gap-5 lg:space-y-0">
      <RoleTerritoryPitch {...props} highlight={highlight} />
      <RoleEvidenceList groups={props.groups} highlight={highlight} />
    </div>
  );
}
