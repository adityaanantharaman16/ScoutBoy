import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const standalone = process.env.SCOUTBOY_NEXT_STANDALONE === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(appDir, "../.."),
  ...(standalone ? { output: "standalone" } : {}),
};

export default nextConfig;
