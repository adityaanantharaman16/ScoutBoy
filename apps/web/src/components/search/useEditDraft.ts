"use client";

import { useState } from "react";

/**
 * A raw text draft held over a URL-backed canonical value, while a field is edited.
 *
 * Every Discovery control derives from the URL, which is what makes hard loads,
 * reload and back/forward work. For a text field that is normalized on the way out —
 * a trimmed club name, a decimal parsed into absolute EUR — deriving on *every
 * keystroke* is destructive: the canonical value round-trips back into the input and
 * rewrites what the user is still typing.
 *
 * Two concrete regressions this exists to prevent:
 *
 * * **Trailing space eaten.** `club="Paris "` normalizes to `"Paris"`, which React
 *   writes straight back, so the space between "Paris" and "Saint-Germain" could
 *   never be typed and multi-word club names were unreachable by keyboard.
 * * **Decimal point eaten.** `12.` on the way to `12.5` was re-derived as `12`, so
 *   sequential typing of an asking-price bound never got past the point. (`fill()`
 *   hid this by setting the whole value at once; a `pressSequentially` test does not.)
 *
 * The rule for choosing between draft and canonical: **the draft survives any canonical
 * value this control itself produced, and only that.** Anything else is an outside
 * change — Clear All, removing the criterion, back/forward, a hard load, the companion
 * of a coherent min/max pair — and drops the draft so the field converges on the URL.
 * Callers also `release()` on blur, so a half-typed or withheld value can never persist
 * as a visible state the URL does not share.
 *
 * Tracking a SET of produced values rather than just the latest one is what makes this
 * work in a real browser. The URL is reached through the router, so it lags the
 * keystroke by a render or two: between typing `12.` and `useSearchParams` catching up,
 * the incoming canonical is still the *previous* value. Comparing against one expected
 * value dropped the draft on exactly that intermediate render, and the visible `12.`
 * collapsed back to `12` — the original defect, reintroduced one layer down. Fast
 * typing makes it worse, because several keystrokes can land before any of their URL
 * writes do.
 *
 * This is the same adjust-state-during-render pattern the age slider uses for its own
 * echo; it is React's documented way to reset state from props without an extra render
 * pass.
 */
export function useEditDraft<T>(canonical: T) {
  //: `produced` is every canonical value this control has caused during the current
  //: edit, plus the one it started from. It lives in the same state as the text
  //: because the two are only ever meaningful together — and because reading it
  //: during render is exactly what decides whether the text survives.
  const [draft, setDraft] = useState<{ raw: string; produced: T[] } | null>(null);

  if (draft && !draft.produced.some((value) => Object.is(value, canonical))) setDraft(null);

  return {
    /** The text being edited, or `null` when the field should derive from the URL. */
    raw: draft ? draft.raw : null,
    /**
     * Hold `raw` on screen, and record the canonical value this edit produces so the
     * URL catching up is not mistaken for an outside change. Pass the value the URL is
     * ABOUT to hold; for a withheld (malformed) keystroke, pass the current one.
     */
    hold: (raw: string, next: T) =>
      setDraft((previous) => {
        const produced = previous ? previous.produced : [canonical];
        return {
          raw,
          produced: produced.some((value) => Object.is(value, next))
            ? produced
            : [...produced, next],
        };
      }),
    /** Stop drafting and derive from the URL again. */
    release: () => setDraft(null),
  };
}
