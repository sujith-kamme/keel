import type { NextConfig } from "next";

// Local dev reads the repo-root .env (Next only loads apps/web/.env). Render sets
// the variables directly, and values already in the environment win.
try {
  process.loadEnvFile("../../.env");
} catch {}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
