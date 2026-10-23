import { defineConfig } from "vitest/config";

// DB integration tests read DATABASE_URL from the repo-root .env locally; CI sets it directly.
try {
  process.loadEnvFile(".env");
} catch {}

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
  },
});
