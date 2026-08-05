/**
 * Purpose-built pilot components for the dark-mode approval artifact.
 *
 * These are deliberately SEPARATE from the production components they portray.
 * The production ledger row, filter rail, Recruitment Desk, Role Territory and
 * comparison surfaces are not imported, not parameterised, and not modified —
 * that is the whole point of an isolated pilot. These copies exist only to show
 * what those surfaces would look like under the proposed dark tokens, and they
 * reproduce the production geometry (fixed RoleFit track, three status lines,
 * equal action halves, 44px targets, word-boundary role wrapping) so the
 * evaluation is honest.
 *
 * Everything is a server component: no state, no effects, no media queries on
 * colour scheme, nothing read from or written to storage.
 */

import {
  band,
  COMPARE,
  DESK,
  eurRange,
  LEDGER_ROWS,
  SWATCH_GROUPS,
  type AuditGroup,
  type Confidence,
  type LedgerPlayer,
  type MarketLabel,
} from "./_data";

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

export function Specimen({
  index,
  title,
  note,
  children,
}: {
  index: string;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="specimen" id={`specimen-${index}`}>
      <div className="specimen-head">
        <p className="specimen-index">Specimen {index}</p>
        <h2>{title}</h2>
        <p className="specimen-note">{note}</p>
      </div>
      {children}
    </section>
  );
}

/** Confidence in its own monochrome channel — never the score palette. */
function ConfidenceGlyph({ level }: { level: Confidence }) {
  // Unknown is a hatch, not an empty meter: "we have no reading" must not look
  // like "the reading is zero".
  if (level === "unknown") {
    return <span className="pilot-confidence-unknown" aria-hidden="true" />;
  }
  const filled = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className="pilot-confidence" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < filled ? "on" : "off"} style={{ height: 5 + i * 3 }} />
      ))}
    </span>
  );
}

const CONFIDENCE_WORD: Record<Confidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Unknown",
};

const MARKET_WORD: Record<MarketLabel, string> = {
  inflated: "Inflated",
  "high-risk": "High-Risk",
  fair: "Fair",
  unknown: "Unknown",
};

/** Coverage and confidence: grouped for scanning, never collapsed into one fact. */
function CoverageConfidence({ coverage, confidence }: { coverage: string; confidence: Confidence }) {
  return (
    <span
      className="pilot-status"
      role="group"
      aria-label={`Evidence coverage: ${coverage.toLowerCase()}. RoleFit confidence: ${CONFIDENCE_WORD[
        confidence
      ].toLowerCase()}.`}
    >
      <span aria-hidden="true">{coverage}</span>
      <span aria-hidden="true" className="pilot-status-confidence">
        <ConfidenceGlyph level={confidence} />
        <span>{CONFIDENCE_WORD[confidence]} Confidence</span>
      </span>
    </span>
  );
}

/** One sharp unit: risk word and range at equal weight. Never €0 for a missing end. */
function MarketStatus({
  label,
  low,
  high,
}: {
  label: MarketLabel;
  low: number | null;
  high: number | null;
}) {
  return (
    <span className={`pilot-status pilot-market-${label}`} data-market-label={label}>
      <span>{MARKET_WORD[label]}</span>
      <span aria-hidden="true">·</span>
      <span className="pilot-mono">{eurRange(low, high)}</span>
    </span>
  );
}

/** A role name may only break between words, so hyphenated names stay intact. */
function WordBoundary({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        <span key={`${i}-${word}`}>
          {i > 0 ? " " : null}
          <span className="pilot-word">{word}</span>
        </span>
      ))}
    </>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M8 13.5S1.75 9.9 1.75 5.85A3.35 3.35 0 0 1 8 4.2a3.35 3.35 0 0 1 6.25 1.65C14.25 9.9 8 13.5 8 13.5Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Specimen 01 — navigation and saved-player counter
// ---------------------------------------------------------------------------

const NAV_LINKS = ["Discover", "Leaderboards", "Compare", "My Favorites", "Methodology"];

export function NavSpecimen() {
  return (
    <div className="pilot-nav">
      <div className="pilot-nav-inner">
        <span className="pilot-wordmark">
          ScoutBoy
          <span className="pilot-wordmark-eyebrow">Recruitment</span>
        </span>
        <div className="pilot-nav-links">
          {NAV_LINKS.map((label) => (
            <span
              key={label}
              className={`pilot-nav-link ${label === "Discover" ? "pilot-nav-link-active" : ""}`}
              aria-current={label === "Discover" ? "page" : undefined}
            >
              {label}
            </span>
          ))}
        </div>
        <span className="pilot-counter">
          My Favorites <span className="pilot-counter-value">3</span> · saved on this device
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Specimen 02 — discovery filter rail
// ---------------------------------------------------------------------------

const SCOPES = [
  { key: "analyzed", label: "Analyzed", desc: "Players with at least one RoleFit rating." },
  { key: "all", label: "All records", desc: "Every player with a usable season profile." },
  { key: "u23", label: "High-coverage U23", desc: "U23 attackers and midfielders meeting coverage thresholds." },
];

export function FilterRailSpecimen() {
  return (
    <div className="pilot-card" data-testid="pilot-filter-rail">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
        <span className="pilot-label">Narrow results</span>
        <span className="pilot-soft" style={{ fontSize: "0.6875rem" }}>
          URL-backed
        </span>
      </div>

      <div className="pilot-filter-group">
        <span className="pilot-label" style={{ display: "block", marginBottom: "0.25rem" }}>
          Search
        </span>
        <input className="pilot-input" placeholder="Name, club, league…" readOnly aria-label="Search" />
      </div>

      <div className="pilot-filter-group">
        <span className="pilot-label">Analysis scope</span>
        <div className="pilot-scope">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              type="button"
              className="pilot-scope-option"
              aria-pressed={s.key === "analyzed"}
            >
              <span className="pilot-scope-name">{s.label}</span>
              <span className="pilot-scope-desc">{s.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pilot-filter-group">
        <span className="pilot-label">Age band</span>
        <div className="pilot-age-band">
          {["All ages", "U23", "24-26"].map((b) => (
            <button key={b} type="button" className="pilot-pill" aria-pressed={b === "All ages"}>
              {b}
            </button>
          ))}
        </div>
      </div>

      <div className="pilot-filter-group">
        <label className="pilot-field">
          <span className="pilot-label">Min RoleFit</span>
          <input className="pilot-input" defaultValue="55" readOnly />
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Specimen 03 — player ledger rows
// ---------------------------------------------------------------------------

function LedgerRowSpecimen({ p }: { p: LedgerPlayer }) {
  return (
    <article className="pilot-row" data-testid="pilot-ledger-row">
      <div className="pilot-row-header">
        <div className="pilot-identity">
          <span className="pilot-player-name">{p.name}</span>
          <p className="pilot-context">
            {p.age} yrs · {p.position} · {p.club}
          </p>
          <p className="pilot-context pilot-soft">
            {p.league} · {p.season} · {p.minutes} min
          </p>
        </div>

        <div className="pilot-hero" data-testid="pilot-row-hero">
          <p className="pilot-label" style={{ marginBottom: "0.25rem" }}>
            RoleFit
          </p>
          <div className={`pilot-score band-${band(p.score)}`}>{p.score.toFixed(1)}</div>
          <p className="pilot-score-caption">
            <WordBoundary text={p.role} />
          </p>
        </div>
      </div>

      {/* Three deliberate status lines: coverage+confidence, market, playstyles.
          Each is its own block, so market can never ride up onto the coverage
          line when horizontal room happens to allow it. */}
      <div className="pilot-statuses">
        <div data-testid="pilot-status-coverage">
          <CoverageConfidence coverage={p.coverage} confidence={p.confidence} />
        </div>
        <div data-testid="pilot-status-market">
          <MarketStatus label={p.market} low={p.askLow} high={p.askHigh} />
        </div>
        <div
          data-testid="pilot-status-playstyles"
          style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}
        >
          {p.playstyles.map((s) => (
            <span key={s} className="pilot-playstyle">
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="pilot-rail" data-testid="pilot-action-rail">
        <div className="pilot-rail-box">
          <button
            type="button"
            className="pilot-rail-action"
            aria-pressed={p.favorited}
            aria-label={
              p.favorited ? `Remove ${p.name} from My Favorites` : `Add ${p.name} to My Favorites`
            }
          >
            <HeartIcon filled={p.favorited} />
          </button>
          <button
            type="button"
            className="pilot-rail-action"
            aria-pressed={p.queuedForCompare}
            aria-label={`Compare ${p.name}`}
          >
            Compare
          </button>
        </div>
      </div>
    </article>
  );
}

export function LedgerSpecimen() {
  return (
    <>
      <div className="pilot-ledger-meta">
        <span>24 players · Analyzed · All ages · 2023/24 · page 1 of 2</span>
        <span>Ranked ledger</span>
      </div>
      <div className="pilot-ledger">
        {LEDGER_ROWS.map((p) => (
          <LedgerRowSpecimen key={p.id} p={p} />
        ))}
      </div>
    </>
  );
}

export function DiscoverySpecimen() {
  return (
    <div className="pilot-discovery">
      <FilterRailSpecimen />
      <div>
        <LedgerSpecimen />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Specimen 04 — Recruitment Desk excerpt
// ---------------------------------------------------------------------------

/** Vertical band each abstract territory occupies, as a % of pitch height. */
const TERRITORY_BAND: Record<string, [number, number]> = {
  att_box: [3, 20],
  att_third: [21.5, 44],
  mid_third: [45.5, 70],
  def_third: [71.5, 96],
};

/**
 * Zone fill brightness, QUANTISED to ScoutBoy's six score bands rather than
 * ramped continuously. A linear ramp put roughly 2.5 L* between an 81 and a 94
 * — less separation than the decorative mowing stripes carried — so the
 * decoration was louder than the data. Discrete steps sit ~5 L* apart against
 * ~1 L* for the stripes.
 */
const BAND_OPACITY: Record<string, number> = {
  red: 0.1,
  rust: 0.22,
  amber: 0.34,
  green: 0.46,
  emerald: 0.58,
  elite: 0.7,
  unknown: 0,
};

function zoneOpacity(score: number | null): number {
  return BAND_OPACITY[band(score)];
}

function PitchField() {
  const line = "var(--pilot-pitch-line)";
  const stripes = [10, 78.3, 146.6, 214.9, 283.2, 351.5];
  return (
    <svg viewBox="0 0 300 430" role="presentation" aria-hidden="true" preserveAspectRatio="none">
      <rect x="0" y="0" width="300" height="430" fill="var(--pilot-pitch-field)" />
      {stripes.map((y, i) => (
        <rect
          key={y}
          x="0"
          y={y}
          width="300"
          height="68.3"
          fill={i % 2 === 0 ? "var(--pilot-pitch-field)" : "var(--pilot-pitch-field-alt)"}
        />
      ))}
      <g fill="none" stroke={line} strokeWidth={1.4} opacity="0.78">
        <rect x="10" y="10" width="280" height="410" />
        <line x1="10" y1="215" x2="290" y2="215" />
        <circle cx="150" cy="215" r="34" />
        <rect x="75" y="10" width="150" height="68" />
        <rect x="115" y="10" width="70" height="24" />
        <path d="M108 78 A 46 46 0 0 0 192 78" />
        <rect x="75" y="352" width="150" height="68" />
        <rect x="115" y="396" width="70" height="24" />
        <path d="M108 352 A 46 46 0 0 1 192 352" />
        <rect x="130" y="4" width="40" height="6" />
        <rect x="130" y="420" width="40" height="6" />
      </g>
      <g fill={line} opacity="0.78">
        <circle cx="150" cy="215" r="1.8" />
        <circle cx="150" cy="56" r="1.8" />
        <circle cx="150" cy="374" r="1.8" />
      </g>
    </svg>
  );
}

function layoutZones(groups: AuditGroup[]) {
  const L = 8;
  const R = 92;
  const out: {
    key: string;
    label: string;
    left: number;
    top: number;
    width: number;
    height: number;
    score: number | null;
  }[] = [];
  for (const t of ["att_box", "att_third", "mid_third", "def_third"]) {
    const inBand = groups.filter((g) => g.territory === t);
    if (inBand.length === 0) continue;
    const [b0, b1] = TERRITORY_BAND[t];
    const gap = inBand.length > 1 ? 2 : 0;
    const colW = (R - L - gap * (inBand.length - 1)) / inBand.length;
    inBand.forEach((g, i) => {
      out.push({
        key: g.key,
        label: g.shortLabel,
        left: L + i * (colW + gap),
        top: b0,
        width: colW,
        height: b1 - b0,
        score: g.score,
      });
    });
  }
  return out;
}

function TerritorySpecimen() {
  const zones = layoutZones(DESK.groups);
  return (
    <div className="pilot-territory" data-testid="pilot-role-territory">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          justifyContent: "space-between",
          marginBottom: "0.25rem",
        }}
      >
        <span className="pilot-label">Role Territory · {DESK.role}</span>
        <span
          className="pilot-soft"
          style={{ alignItems: "center", display: "inline-flex", fontSize: "0.75rem", gap: "0.375rem" }}
        >
          Reliability
          <ConfidenceGlyph level={DESK.confidence} />
          <span>{CONFIDENCE_WORD[DESK.confidence]}</span>
        </span>
      </div>
      <p className="pilot-soft" style={{ fontSize: "0.6875rem", marginBottom: "0.75rem" }}>
        Attacking Direction ↑
      </p>

      <div className="pilot-pitch">
        <PitchField />
        <div style={{ inset: 0, position: "absolute" }} aria-hidden="true">
          {zones.map((z) => (
            <div
              key={z.key}
              className="pilot-zone"
              style={{
                left: `${z.left}%`,
                top: `${z.top}%`,
                width: `${z.width}%`,
                height: `${z.height}%`,
                background:
                  z.score == null
                    ? // Unknown reads as a hatch, never as a zero-height fill.
                      "repeating-linear-gradient(45deg, rgba(226,234,224,0.30) 0 2px, transparent 2px 6px)"
                    : `rgba(126, 226, 175, ${zoneOpacity(z.score)})`,
                borderStyle: z.score == null ? "dashed" : "solid",
              }}
            >
              <span className="pilot-zone-tab">
                <span className="pilot-zone-label">{z.label}</span>
                <span className="pilot-zone-score">
                  {z.score == null ? "?" : Math.round(z.score)}
                </span>
                {z.score == null && <span className="pilot-zone-unknown">unknown</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="pilot-soft" style={{ fontSize: "0.75rem", marginTop: "0.75rem" }}>
        Illustrative role territory derived from RoleFit evidence groups. Not tracking or
        event-location data.
      </p>

      {/* The encoding is stated, not left to be inferred from colour. */}
      <div
        style={{
          borderTop: "1px solid var(--pilot-line)",
          color: "var(--pilot-text-muted)",
          display: "flex",
          flexWrap: "wrap",
          fontSize: "0.6875rem",
          gap: "0.375rem 1rem",
          marginTop: "0.75rem",
          paddingTop: "0.5rem",
        }}
      >
        <span style={{ alignItems: "center", display: "inline-flex", gap: "0.375rem" }}>
          <span aria-hidden="true" style={{ display: "inline-flex" }}>
            {[0.1, 0.34, 0.58, 0.7].map((o) => (
              <span
                key={o}
                style={{
                  background: `rgba(126, 226, 175, ${o})`,
                  border: "1px solid rgba(226,234,224,0.4)",
                  display: "inline-block",
                  height: 12,
                  width: 12,
                }}
              />
            ))}
          </span>
          Brighter zone = higher group score
        </span>
        <span className="pilot-soft">Confidence and role weight are shown separately.</span>
      </div>
    </div>
  );
}

export function DeskSpecimen() {
  return (
    <>
      <div className="pilot-role-tabs" role="tablist" aria-label="Select a role">
        {DESK.roles.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            className="pilot-role-tab"
            aria-selected={r === DESK.role}
            tabIndex={r === DESK.role ? 0 : -1}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="pilot-desk">
        {/* Left rail: identity + selected-role summary */}
        <div className="pilot-card">
          <p className="pilot-label">Selected role</p>
          <p style={{ fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.01em", marginTop: "0.25rem" }}>
            {DESK.role}
          </p>
          <p className="pilot-context" style={{ marginTop: "0.125rem" }}>
            {DESK.player} · {DESK.age} yrs · {DESK.position} · {DESK.club}
          </p>
          <p className="pilot-context pilot-soft">
            {DESK.league} · {DESK.season} · {DESK.minutes} min
          </p>

          <div style={{ alignItems: "flex-end", display: "flex", gap: "1rem", marginTop: "1rem" }}>
            <div>
              <p className="pilot-label">RoleFit</p>
              <div
                className={`pilot-score band-${band(DESK.score)}`}
                style={{ fontSize: "2.25rem", marginTop: "0.25rem" }}
              >
                {DESK.score.toFixed(1)}
              </div>
            </div>
            <div style={{ paddingBottom: "0.25rem" }}>
              <p className="pilot-label">RoleFit confidence</p>
              <span
                style={{
                  alignItems: "center",
                  display: "inline-flex",
                  gap: "0.375rem",
                  marginTop: "0.375rem",
                }}
              >
                <ConfidenceGlyph level={DESK.confidence} />
                <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
                  {CONFIDENCE_WORD[DESK.confidence]}
                </span>
                <span className="pilot-mono pilot-soft" style={{ fontSize: "0.6875rem" }}>
                  {DESK.confidenceScore.toFixed(2)}
                </span>
              </span>
            </div>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <CoverageConfidence coverage={DESK.coverage} confidence={DESK.confidence} />
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <MarketStatus
              label={DESK.market.label}
              low={DESK.market.askLow}
              high={DESK.market.askHigh}
            />
          </div>

          {/* The uncertainty state. Deliberately MONOCHROME, not an amber
              caution: confidence has its own channel in ScoutBoy and must never
              borrow the score palette. Amber here would also have put a third
              amber object within 200px of the amber 68.2 and the amber market
              chip, collapsing three separate channels into one alarm. */}
          <div
            className="pilot-notice pilot-notice-neutral"
            style={{ marginTop: "1rem" }}
            data-testid="pilot-uncertainty-notice"
          >
            <p className="pilot-notice-title">Medium confidence · read with caution</p>
            <p className="pilot-notice-body">
              1,300 minutes in Ligue 2 gives a thinner evidence base than this cohort&rsquo;s
              top-division records. Rank {DESK.rank} in peer group.
            </p>
          </div>
        </div>

        <TerritorySpecimen />

        {/* Evidence rows */}
        <div>
          <p className="pilot-label" style={{ marginBottom: "0.5rem" }}>
            Supporting evidence
          </p>
          <div className="pilot-evidence-list">
            {DESK.groups.map((g) => (
              <div key={g.key} className="pilot-evidence-row" data-testid="pilot-evidence-row">
                <div className="pilot-evidence-head">
                  <span className="pilot-evidence-name">{g.label}</span>
                  <span className={`pilot-evidence-score band-${band(g.score)}`}>
                    {g.score == null ? "unknown" : Math.round(g.score)}
                  </span>
                </div>
                <div className="pilot-evidence-meta">
                  <span>
                    {g.territory
                      ? g.territory === "att_box"
                        ? "Attacking penalty box"
                        : g.territory === "att_third"
                        ? "Attacking third"
                        : g.territory === "mid_third"
                        ? "Middle third"
                        : "Defensive third"
                      : "Not shown on pitch · non-spatial evidence"}
                  </span>
                  <span>· Role weight {Math.round(g.weight * 100)}%</span>
                </div>
                <div className="pilot-bar-track" style={{ marginTop: "0.375rem" }} aria-hidden="true">
                  {g.score != null && (
                    <div
                      className={`pilot-bar-fill bar-${band(g.score)}`}
                      style={{ width: `${Math.max(0, Math.min(100, g.score))}%` }}
                    />
                  )}
                </div>
                <p className="pilot-evidence-detail">
                  {g.score == null
                    ? "No measured evidence for this group - shown as unknown, not zero."
                    : `Measured: ${g.metrics.join(", ")}`}
                </p>
              </div>
            ))}
          </div>

          <div className="pilot-notice pilot-notice-neutral" style={{ marginTop: "0.75rem" }}>
            <p className="pilot-notice-title">Why This Score</p>
            <p className="pilot-notice-body">{DESK.explanation}</p>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Specimen 05 — comparison excerpt
// ---------------------------------------------------------------------------

function CompareSide({ side }: { side: typeof COMPARE.a }) {
  return (
    <div className="pilot-compare-side">
      <p className="pilot-compare-name">{side.name}</p>
      <p className="pilot-context">
        {side.age} yrs · {side.position} · {side.club} · {side.league}
      </p>

      <div style={{ marginTop: "0.875rem" }}>
        <p className="pilot-label">Best rated role</p>
        <div style={{ alignItems: "baseline", display: "flex", gap: "0.625rem", marginTop: "0.25rem" }}>
          <span className={`pilot-score band-${band(side.bestScore)}`} style={{ fontSize: "1.5rem" }}>
            {side.bestScore.toFixed(1)}
          </span>
          <span className="pilot-muted" style={{ fontSize: "0.8125rem" }}>
            {side.bestRole}
          </span>
        </div>
        <span
          style={{ alignItems: "center", display: "inline-flex", gap: "0.375rem", marginTop: "0.5rem" }}
        >
          <span className="pilot-soft" style={{ fontSize: "0.6875rem" }}>
            RoleFit confidence:
          </span>
          <ConfidenceGlyph level={side.confidence} />
          <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>
            {CONFIDENCE_WORD[side.confidence]}
          </span>
        </span>
      </div>

      <div style={{ marginTop: "0.875rem" }}>
        <p className="pilot-label" style={{ marginBottom: "0.375rem" }}>
          Expected asking
        </p>
        <MarketStatus label={side.market} low={side.askLow} high={side.askHigh} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginTop: "0.75rem" }}>
        {side.playstyles.map((s) => (
          <span key={s} className="pilot-playstyle">
            {s}
          </span>
        ))}
      </div>

      <div style={{ marginTop: "0.875rem" }}>
        <p className="pilot-label" style={{ marginBottom: "0.25rem" }}>
          Evidence context
        </p>
        {side.context.map(([k, v]) => (
          <p key={k} className="pilot-context" style={{ marginTop: "0.125rem" }}>
            <span className="pilot-soft">{k}: </span>
            {v}
          </p>
        ))}
      </div>
    </div>
  );
}

export function CompareSpecimen() {
  return (
    <div className="pilot-card" style={{ padding: 0 }}>
      <div className="pilot-compare-spine">
        <p className="pilot-label">Role spine</p>
        <h3 style={{ marginTop: "0.375rem" }}>No Shared Rated Role</h3>
        <p className="pilot-muted" style={{ fontSize: "0.8125rem", margin: "0.5rem auto 0", maxWidth: "34rem" }}>
          {COMPARE.explanation}
        </p>
        {/* An explicit role can still be picked — the surface stays usable
            rather than dead-ending on the missing overlap. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            justifyContent: "center",
            marginTop: "0.875rem",
          }}
        >
          <button type="button" className="pilot-btn pilot-btn-primary">
            Select a role
          </button>
          <button type="button" className="pilot-btn">
            Swap players
          </button>
        </div>
      </div>

      <div className="pilot-compare">
        <CompareSide side={COMPARE.a} />
        <CompareSide side={COMPARE.b} />
      </div>

      <div style={{ borderTop: "1px solid var(--pilot-line)", padding: "1rem" }}>
        <p className="pilot-label">Normalized metrics</p>
        <div style={{ marginTop: "0.5rem" }}>
          <div className="pilot-metric-row" style={{ borderTop: 0 }}>
            <span className="pilot-metric-label pilot-soft">Metric</span>
            <span className="pilot-metric-value pilot-soft" style={{ fontWeight: 600 }}>
              {COMPARE.a.name.split(" ")[0]}
            </span>
            <span className="pilot-metric-value pilot-soft" style={{ fontWeight: 600 }}>
              {COMPARE.b.name.split(" ")[0]}
            </span>
          </div>
          {COMPARE.stats.map((s) => (
            <div key={s.label} className="pilot-metric-row">
              <span className="pilot-metric-label">{s.label}</span>
              <span className={`pilot-metric-value pilot-mono band-${band(s.a)}`}>{s.a.toFixed(1)}</span>
              <span className={`pilot-metric-value pilot-mono band-${band(s.b)}`}>{s.b.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Specimen 06 — token swatches
// ---------------------------------------------------------------------------

/**
 * The honesty states rendered, not just asserted. A dark canvas is where
 * "unknown" is most at risk of being mistaken for "disabled chrome" or for
 * zero, so the pilot has to show them rather than name them in a token table.
 */
export function HonestyStatesSpecimen() {
  return (
    <div className="pilot-honesty" data-testid="pilot-honesty-states">
      <div className="pilot-honesty-item">
        <p className="pilot-label" style={{ marginBottom: "0.375rem" }}>
          RoleFit
        </p>
        <div className="pilot-score band-unknown" data-testid="pilot-unknown-score">
          -
        </div>
        <p className="pilot-honesty-caption">
          No stored rating. The sentinel is a dash, never 0.0.
        </p>
      </div>

      <div className="pilot-honesty-item">
        <p className="pilot-label" style={{ marginBottom: "0.375rem" }}>
          Confidence
        </p>
        <span style={{ alignItems: "center", display: "inline-flex", gap: "0.375rem" }}>
          <ConfidenceGlyph level="unknown" />
          <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Unknown</span>
        </span>
        <p className="pilot-honesty-caption">
          A hatch plus the word - not an empty meter, which would read as low.
        </p>
      </div>

      <div className="pilot-honesty-item">
        <p className="pilot-label" style={{ marginBottom: "0.375rem" }}>
          Market
        </p>
        <MarketStatus label="unknown" low={null} high={null} />
        <div style={{ marginTop: "0.375rem" }}>
          <MarketStatus label="fair" low={20_000_000} high={null} />
        </div>
        <p className="pilot-honesty-caption">
          A missing endpoint keeps the one it has (“From €20M”), never €0.
        </p>
      </div>

      <div className="pilot-honesty-item">
        <p className="pilot-label" style={{ marginBottom: "0.375rem" }}>
          Profile only
        </p>
        <span className="pilot-status">Profile Only</span>
        <p className="pilot-honesty-caption">
          No rating was produced, so no score or confidence is invented for it.
        </p>
      </div>
    </div>
  );
}

export function SwatchesSpecimen() {
  return (
    <div style={{ display: "grid", gap: "1.75rem" }}>
      {SWATCH_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="pilot-label" style={{ marginBottom: "0.625rem" }}>
            {group.title}
          </p>
          <div className="pilot-swatches">
            {group.swatches.map((s) => (
              <div key={s.name} className="pilot-swatch">
                <div
                  className="pilot-swatch-chip"
                  style={
                    s.kind === "text"
                      ? {
                          alignItems: "center",
                          background: "var(--pilot-panel)",
                          color: s.hex,
                          display: "flex",
                          fontSize: "1.25rem",
                          fontWeight: 700,
                          justifyContent: "center",
                        }
                      : { background: s.hex }
                  }
                >
                  {s.kind === "text" ? "Aa 84.6" : null}
                </div>
                <div className="pilot-swatch-body">
                  <p className="pilot-swatch-name pilot-mono">{s.name}</p>
                  <p className="pilot-swatch-hex">{s.hex}</p>
                  <p className="pilot-swatch-role">{s.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
