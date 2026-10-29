import { defineConfig } from "vitest/config";

// DB integration tests read DATABASE_URL from the repo-root .env locally; CI sets it directly.
try {
  process.loadEnvFile(".env");
} catch {}

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "apps/web/lib/**/*.test.ts", "apps/store/lib/**/*.test.ts"],
    // DB tests may run against a remote Postgres (Neon), where serialized ledger appends are slow.
    testTimeout: 30_000,
  },
});
