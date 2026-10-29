import type { NextConfig } from "next";

// Local dev reads the repo-root .env (Next only loads apps/web/.env). Render sets
// the variables directly, and values already in the environment win.
try {
  process.loadEnvFile("../../.env");
} catch {}

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@keel/agent", "@keel/extractor", "@keel/gauntlet"],
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
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
