import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: "#f4f2ea", panel: "#fcfbf6", muted: "#efede2" },
        // `soft` and `line.strong` were darkened in the Milestone 7 accessibility
        // closeout to clear WCAG 2.2 SC 1.4.3 (text) and SC 1.4.11 (control
        // boundaries) respectively. Keep these in sync with the CSS custom
        // properties in globals.css, which document the measured ratios.
        ink: { DEFAULT: "#182219", muted: "#49564c", soft: "#5f6b61" },
        line: { DEFAULT: "#d8d3c2", strong: "#8d866f" },
        pitch: { DEFAULT: "#1c5a3c", dark: "#13402b", sage: "#5e7166", mid: "#0f7a5f" },
        accent: { DEFAULT: "#1c5a3c", soft: "#13402b", amber: "#9a5a0b", rust: "#8d3f24", red: "#9c2e22" },
        // Elite (90+) score accent. `DEFAULT` is the canonical blue used for
        // bars/markers; `ink` is a darker companion for small normal-weight text
        // to meet contrast on warm paper.
        elite: { DEFAULT: "#2e74e6", ink: "#1f57b0" },
        track: "#e4dfce",
      },
      fontFamily: {
        // One proportional family (self-hosted Inter Variable) plus the existing
        // mono stack for deliberately tabular/numeric presentation.
        sans: ["InterVariable", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "Cascadia Mono", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
