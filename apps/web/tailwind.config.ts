import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: "#f4f2ea", panel: "#fcfbf6", muted: "#efede2" },
        ink: { DEFAULT: "#182219", muted: "#49564c", soft: "#6e7a6f" },
        line: { DEFAULT: "#d8d3c2", strong: "#b9b29d" },
        pitch: { DEFAULT: "#1c5a3c", dark: "#13402b", sage: "#5e7166" },
        accent: { DEFAULT: "#1c5a3c", soft: "#13402b", amber: "#9a5a0b", rust: "#8d3f24", red: "#9c2e22" },
        track: "#e4dfce",
      },
      fontFamily: {
        serif: ["Iowan Old Style", "Palatino Linotype", "Palatino", "Georgia", "Times New Roman", "serif"],
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "Cascadia Mono", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
