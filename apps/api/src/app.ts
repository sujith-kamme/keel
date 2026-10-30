import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { type McpOptions, mountMcp } from "./mcp/server";
import { type AgentOptions, mountAgents } from "./routes/agents";
import { type ConsoleOptions, mountConsole } from "./routes/console";
import { type SettingsOptions, mountSettings } from "./routes/settings";
import { type DisputesOptions, mountDisputes } from "./routes/disputes";
import { type GauntletOptions, mountGauntlet } from "./routes/gauntlet";
import { type GridQueryOptions, mountGridQuery } from "./routes/grid-query";
import { type GuardOptions, mountGuard } from "./routes/guard";
import { type LedgerOptions, mountLedger } from "./routes/ledger";
import { type OverviewOptions, mountOverview } from "./routes/overview";
import { type PoliciesOptions, mountPolicies } from "./routes/policies";
import { type ReviewOptions, mountReview } from "./routes/review";
import { type SessionOptions, mountSessions } from "./routes/sessions";
import { type StoreOptions, mountStore } from "./routes/store";
import { type TurnOptions, mountTurns } from "./routes/turns";

export type HealthCheck = () => Promise<void>;

// Hand-written spec (apps/api/openapi.yaml); src/openapi.test.ts keeps it in step with the routes.
const OPENAPI = readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8");

// Swagger UI over the spec, like FastAPI's /docs.
const SWAGGER = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";
const DOCS = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keel API</title>
<link rel="stylesheet" href="${SWAGGER}/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${SWAGGER}/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: "/openapi.yaml", dom_id: "#swagger-ui" });</script>
</body>
</html>`;

export function createApp(deps: {
  agents?: AgentOptions;
  settings?: SettingsOptions;
  checks: Record<string, HealthCheck>;
  console?: ConsoleOptions;
  disputes?: DisputesOptions;
  gauntlet?: GauntletOptions;
  gridQuery?: GridQueryOptions;
  guard?: GuardOptions;
  ledger?: LedgerOptions;
  mcp?: McpOptions;
  overview?: OverviewOptions;
  policies?: PoliciesOptions;
  review?: ReviewOptions;
  sessions?: SessionOptions;
  store?: StoreOptions;
  turns?: TurnOptions;
}) {
  const app = new Hono();

  app.use(secureHeaders());
  // Every request Keel accepts is small JSON; refuse anything bigger before parsing.
  // grid-query carries a grid schema of up to 64 KB and sets its own limit.
  const limit = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) });
  app.use("/v1/*", (c, next) => (c.req.path === "/v1/grid-query" ? next() : limit(c, next)));

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

  app.get("/openapi.yaml", (c) => c.body(OPENAPI, 200, { "content-type": "application/yaml" }));
  app.get("/docs", (c) => c.html(DOCS));

  if (deps.sessions) mountSessions(app, deps.sessions);
  if (deps.store) mountStore(app, deps.store);
  if (deps.turns) mountTurns(app, deps.turns);
  if (deps.guard) mountGuard(app, deps.guard);
  if (deps.mcp) mountMcp(app, deps.mcp);
  if (deps.review) mountReview(app, deps.review);
  if (deps.agents) mountAgents(app, deps.agents);
  if (deps.settings) mountSettings(app, deps.settings);
  if (deps.console) mountConsole(app, deps.console);
  if (deps.gauntlet) mountGauntlet(app, deps.gauntlet);
  if (deps.disputes) mountDisputes(app, deps.disputes);
  if (deps.ledger) mountLedger(app, deps.ledger);
  if (deps.overview) mountOverview(app, deps.overview);
  if (deps.gridQuery) mountGridQuery(app, deps.gridQuery);
  if (deps.policies) mountPolicies(app, deps.policies);

  return app;
}
