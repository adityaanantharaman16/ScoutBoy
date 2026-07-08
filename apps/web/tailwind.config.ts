import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pitch: { 900: "#0b141a", 800: "#12212b", 700: "#1b3340" },
        accent: { DEFAULT: "#38bdf8", soft: "#7dd3fc" },
      },
    },
  },
  plugins: [],
};

export default config;
