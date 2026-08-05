import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SWATCH_GROUPS, band, eur, eurRange } from "@/app/design-pilots/dark-mode/_data";

// Guards for the isolated dark-mode design pilot (an approval artifact, not a
// theme). These assert the two things that would silently rot: the published
// token table drifting away from the stylesheet that actually renders, and the
// pilot's scope contract leaking into production styling.

// vitest runs with `apps/web` as the working directory.
const PILOT_CSS = readFileSync(
  resolve(process.cwd(), "src/app/design-pilots/dark-mode/pilot.css"),
  "utf8",
);

/** Declarations only. The file's comments deliberately NAME the production
 *  tokens each pilot token maps onto, so they must not be searched. */
const PILOT_RULES = PILOT_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** `--pilot-x: #rrggbb;` declarations found in the stylesheet. */
function declaredTokens(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/(--pilot-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out.set(m[1], m[2].toLowerCase());
  }
  return out;
}

describe("dark-mode pilot — token table matches the stylesheet", () => {
  const declared = declaredTokens(PILOT_CSS);
  const swatches = SWATCH_GROUPS.flatMap((g) => g.swatches);

  it("finds the pilot's colour tokens in pilot.css", () => {
    expect(declared.size).toBeGreaterThan(20);
  });

  it.each(swatches.map((s) => [s.name, s.hex] as const))(
    "%s swatch equals its declared value",
    (name, hex) => {
      expect(declared.get(name), `${name} is not declared in pilot.css`).toBeDefined();
      expect(declared.get(name)).toBe(hex.toLowerCase());
    },
  );

  it("publishes every colour token the stylesheet declares", () => {
    const published = new Set(swatches.map((s) => s.name));
    const missing = [...declared.keys()].filter((k) => !published.has(k));
    expect(missing, `undocumented pilot tokens: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("dark-mode pilot — scope contract", () => {
  it("scopes every rule beneath the .dark-pilot root", () => {
    const selectors = [...PILOT_RULES.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/gm)]
      .map((m) => m[2].trim())
      .filter(Boolean)
      // `@media` blocks contribute their own inner selectors, matched above.
      .flatMap((s) => s.split(",").map((p) => p.trim()))
      .filter((s) => s && !s.startsWith("@") && !s.startsWith("from") && !s.startsWith("to"));

    expect(selectors.length).toBeGreaterThan(30);
    const unscoped = selectors.filter((s) => !s.startsWith(".dark-pilot"));
    expect(unscoped, `unscoped selectors would leak into production: ${unscoped.join(" | ")}`).toEqual(
      [],
    );
  });

  it("never redefines a production token or reacts to the OS colour scheme", () => {
    expect(PILOT_RULES).not.toMatch(/prefers-color-scheme/);
    expect(PILOT_RULES).not.toMatch(/:root/);
    // Redefining any of these would change production surfaces.
    for (const token of ["--paper", "--ink", "--pitch:", "--line:", "--track:", "--elite:"]) {
      expect(PILOT_RULES.includes(token), `pilot must not declare ${token}`).toBe(false);
    }
  });

  it("declares no drop shadow — dark elevation is luminance, not shadow", () => {
    // The only box-shadows are inset selection markers.
    for (const m of PILOT_RULES.matchAll(/box-shadow:\s*([^;]+);/g)) {
      expect(m[1]).toMatch(/inset/);
    }
  });

  it("uses no gradient other than the flat hatch that marks unknown", () => {
    const gradients = [...PILOT_RULES.matchAll(/[a-z-]*gradient\(/g)].map((m) => m[0]);
    expect(gradients.length).toBeGreaterThan(0);
    expect(gradients.every((g) => g === "repeating-linear-gradient(")).toBe(true);
  });
});

describe("dark-mode pilot — honest formatting helpers mirror production", () => {
  it("maps scores onto the production bands", () => {
    expect(band(null)).toBe("unknown");
    expect(band(39.9)).toBe("red");
    expect(band(40)).toBe("rust");
    expect(band(54.9)).toBe("rust");
    expect(band(55)).toBe("amber");
    expect(band(69.9)).toBe("amber");
    expect(band(70)).toBe("green");
    expect(band(79.9)).toBe("green");
    expect(band(80)).toBe("emerald");
    expect(band(89.9)).toBe("emerald");
    expect(band(90)).toBe("elite");
  });

  it("renders missing money as a sentinel and never as zero", () => {
    expect(eur(null)).toBe("-");
    expect(eurRange(null, null)).toBe("Unknown");
    expect(eurRange(20_000_000, null)).toBe("From €20.0M");
    expect(eurRange(null, 20_000_000)).toBe("Up to €20.0M");
    expect(eurRange(58_520_110, 87_780_165)).toBe("€58.5M – €87.8M");
  });
});
