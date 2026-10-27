import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { type McpOptions, mountMcp } from "./mcp/server";
import { type GuardOptions, mountGuard } from "./routes/guard";
import { type SessionOptions, mountSessions } from "./routes/sessions";
import { type StoreOptions, mountStore } from "./routes/store";
import { type TurnOptions, mountTurns } from "./routes/turns";

export type HealthCheck = () => Promise<void>;

export function createApp(deps: {
  checks: Record<string, HealthCheck>;
  guard?: GuardOptions;
  mcp?: McpOptions;
  sessions?: SessionOptions;
  store?: StoreOptions;
  turns?: TurnOptions;
}) {
  const app = new Hono();

  app.use(secureHeaders());
  // Every request Keel accepts is small JSON; refuse anything bigger before parsing.
  app.use("/v1/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));

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

  if (deps.sessions) mountSessions(app, deps.sessions);
  if (deps.store) mountStore(app, deps.store);
  if (deps.turns) mountTurns(app, deps.turns);
  if (deps.guard) mountGuard(app, deps.guard);
  if (deps.mcp) mountMcp(app, deps.mcp);

  return app;
}
