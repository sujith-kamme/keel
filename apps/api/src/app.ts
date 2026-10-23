import { Hono } from "hono";

export type HealthCheck = () => Promise<void>;

export function createApp(deps: { checks: Record<string, HealthCheck> }) {
  const app = new Hono();

  app.get("/health", async (c) => {
    const results = await Promise.all(
      Object.entries(deps.checks).map(async ([name, check]) => {
        try {
          await check();
          return [name, "ok"] as const;
        } catch {
          return [name, "down"] as const;
        }
      }),
    );
    const healthy = results.every(([, state]) => state === "ok");
    return c.json({ status: healthy ? "ok" : "degraded", checks: Object.fromEntries(results) }, healthy ? 200 : 503);
  });

  return app;
}
