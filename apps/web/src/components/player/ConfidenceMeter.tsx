import { confidenceLabel } from "@/lib/formatters";

// A small, reusable confidence primitive for the Recruitment Desk slice.
//
// Confidence is deliberately kept in a SEPARATE visual channel from score
// magnitude: it uses a monochrome (ink) segmented glyph + a text word, never
// the green/amber/rust magnitude palette. That way a low-confidence high score
// still reads as "high" in magnitude while reading as "uncertain" in
// reliability. There are only four categorical levels (high/medium/low/unknown)
// so the glyph uses three segments — not a 5-dot scale that would imply a
// continuous measured probability. When the backend provides a stored evidence
// score, it can be shown as an explicit secondary value.

type Level = "high" | "medium" | "low" | "unknown";

function normalize(level: string | null | undefined): Level {
  if (level === "high" || level === "medium" || level === "low") return level;
  return "unknown";
}

const FILLED: Record<Level, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
const WORD: Record<Level, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Unknown",
};

export function ConfidenceMeter({
  level,
  score,
  showWord = true,
  className = "",
}: {
  level: string | null | undefined;
  /** Optional stored evidence score (0..1) from the audit's confidence_breakdown. */
  score?: number | null;
  showWord?: boolean;
  className?: string;
}) {
  const lvl = normalize(level);
  const filled = FILLED[lvl];
  const isUnknown = lvl === "unknown";
  const accessibleName = `Confidence: ${WORD[lvl].toLowerCase()}${
    score != null ? ` (evidence score ${score.toFixed(2)})` : ""
  }`;

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      role="img"
      aria-label={accessibleName}
      title={confidenceLabel(lvl)}
      data-testid="confidence-meter"
      data-confidence={lvl}
    >
      {isUnknown ? (
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 border border-dashed border-ink-soft"
          style={{
            borderRadius: 2,
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--line-strong) 0 1.5px, transparent 1.5px 4px)",
          }}
        />
      ) : (
        <span aria-hidden="true" className="inline-flex items-end gap-0.5" style={{ height: 12 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={i < filled ? "bg-ink" : "bg-line-strong"}
              style={{ width: 3, height: 5 + i * 3, borderRadius: 1 }}
            />
          ))}
        </span>
      )}
      {showWord && (
        <span className="text-xs font-semibold text-ink-muted">
          {WORD[lvl]}
          {score != null && (
            <span className="ml-1 font-mono text-[10px] font-normal text-ink-soft">
              {score.toFixed(2)}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
