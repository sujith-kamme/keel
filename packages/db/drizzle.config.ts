import { defineConfig } from "drizzle-kit";

// Locally, load the repo-root .env; on Render the variables are already set.
try {
  process.loadEnvFile("../../.env");
} catch {}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
