"use client";

import { useState } from "react";

import {
  AGE_STOPS,
  AGE_STOP_MAX,
  AGE_STOP_MIN,
  AGE_STOP_STEP,
  ageSummaryText,
  ageThresholdText,
  type AgeDirection,
  type AgeSelection,
} from "@/lib/filters";

/**
 * The Discovery age filter: one threshold on a five-stop scale plus an explicit
 * direction, replacing the old five-option Age Band select.
 *
 * It is a real `<input type="range">`, not a pointer-only widget: arrow keys,
 * Home/End, the focus ring and the value announcement are the platform's. The
 * discrete stops come from `min=19 max=31 step=3`, so the control cannot land
 * between career stages, and `aria-valuetext` announces the full semantics ("25
 * Years And Younger") rather than a bare number.
 *
 * The rail underneath is painted by us (the native track is transparent) so the
 * selected side is filled and every stop reads as a hard-edged tick. Direction is
 * three plain toggle buttons carrying `aria-pressed` and unambiguous accessible
 * names — never a lone arrow glyph — and "All Ages" is one of the three, so
 * returning to no age filter is always one press away.
 */
export function AgeThresholdFilter({
  selection,
  onChange,
  className = "",
}: {
  selection: AgeSelection;
  onChange: (next: AgeSelection) => void;
  /**
   * Grid placement supplied by the rail. The control is one grid item, so the
   * span has to live on this root element — the alternative, a wrapper div, would
   * put a non-grid box between the panel and the control and stop the slider from
   * reaching the panel's full internal width.
   */
  className?: string;
}) {
  const { direction } = selection;

  /**
   * The URL is the source of truth, but it is reached asynchronously through the
   * router, so the slider echoes its own value locally for the frames in between.
   *
   * Without this, a held arrow key or a drag re-renders each step from a URL that
   * has not caught up yet: the thumb snaps back and consecutive presses compose
   * from a stale value. The echo is re-synchronised during render whenever the
   * incoming threshold changes (the same adjust-state-during-render pattern the
   * compare tray uses), so the URL still wins — it just wins a frame later.
   */
  const [echo, setEcho] = useState({ from: selection.threshold, value: selection.threshold });
  if (echo.from !== selection.threshold) {
    setEcho({ from: selection.threshold, value: selection.threshold });
  }
  const threshold = echo.from === selection.threshold ? echo.value : selection.threshold;

  // Fraction of the way along the scale, used to place the fill and the ticks at
  // the thumb's own travel positions rather than the raw box width.
  const fraction = (threshold - AGE_STOP_MIN) / (AGE_STOP_MAX - AGE_STOP_MIN);

  const commit = (next: AgeSelection) => {
    setEcho({ from: selection.threshold, value: next.threshold });
    onChange(next);
  };

  // Direction changes never move the threshold, so switching sides is a pure
  // reinterpretation of the same stop.
  const setDirection = (next: AgeDirection | null) => commit({ direction: next, threshold });

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`} data-testid="age-threshold-filter">
      <div className="flex items-baseline justify-between gap-2">
        <label className="label" htmlFor="filter-age-threshold">
          Age threshold
        </label>
        <span
          className="text-base font-bold leading-none tracking-tight text-ink"
          data-testid="age-threshold-value"
        >
          {ageThresholdText(threshold)}
        </span>
      </div>

      {/* The slider and its painted rail share one positioning context so the
          fill, the ticks and the native thumb all use the same travel geometry. */}
      <div
        className="age-slider-shell"
        style={{ "--age-fraction": String(fraction) } as React.CSSProperties}
      >
        <div className="age-slider-rail" aria-hidden="true">
          {direction && (
            <div
              className={`age-slider-fill age-slider-fill-${direction}`}
              data-testid="age-slider-fill"
            />
          )}
          {AGE_STOPS.map((stop, i) => (
            <span
              key={stop}
              className="age-slider-stop"
              data-testid="age-slider-stop"
              data-age-stop={stop}
              data-age-stop-active={stop === threshold ? "true" : "false"}
              style={{ "--age-stop-fraction": String(i / (AGE_STOPS.length - 1)) } as React.CSSProperties}
            />
          ))}
        </div>
        <input
          id="filter-age-threshold"
          type="range"
          className="age-slider-input"
          data-testid="age-threshold-slider"
          min={AGE_STOP_MIN}
          max={AGE_STOP_MAX}
          step={AGE_STOP_STEP}
          value={threshold}
          aria-valuetext={ageSummaryText({
            direction: direction ?? "younger",
            threshold,
          })}
          aria-describedby="filter-age-threshold-help"
          // Moving the slider is itself a filter action: with no direction yet
          // active it applies the default "and younger" reading rather than
          // silently doing nothing.
          onChange={(e) =>
            commit({ direction: direction ?? "younger", threshold: Number(e.target.value) })
          }
        />
      </div>

      <div className="flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
        <span>Youth</span>
        <span>Seasoned</span>
      </div>

      {/* Three equal segments in one hairline box: the two directions plus the
          explicit reset. Exactly one is pressed at any time. */}
      <div
        className="age-direction-box"
        role="group"
        aria-label="Age filter direction"
        data-testid="age-direction-group"
      >
        <button
          type="button"
          className="age-direction-action"
          aria-pressed={direction === "younger"}
          aria-label={ageSummaryText({ direction: "younger", threshold })}
          data-testid="age-direction-younger"
          onClick={() => setDirection("younger")}
        >
          Younger
        </button>
        <button
          type="button"
          className="age-direction-action"
          aria-pressed={direction === "older"}
          aria-label={ageSummaryText({ direction: "older", threshold })}
          data-testid="age-direction-older"
          onClick={() => setDirection("older")}
        >
          Older
        </button>
        <button
          type="button"
          className="age-direction-action"
          aria-pressed={direction === null}
          aria-label="All Ages, no age filter"
          data-testid="age-direction-all"
          onClick={() => setDirection(null)}
        >
          All Ages
        </button>
      </div>

      <p id="filter-age-threshold-help" className="text-[11px] leading-snug text-ink-soft">
        {ageSummaryText(selection)}
      </p>
    </div>
  );
}
