import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createApp } from "./app";

const spec = parse(readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, unknown>>;
};
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

// Every optional route group mounted. Mounting only checks the keys, so the rest can be empty.
const deps = { operatorKey: "o".repeat(32), merchantKey: "m".repeat(32), signingKey: "s".repeat(32) } as never;
const app = createApp({
  checks: {},
  agents: deps,
  disputes: deps,
  gauntlet: deps,
  gridQuery: deps,
  guard: deps,
  ledger: deps,
  mcp: deps,
  overview: deps,
  policies: deps,
  review: deps,
  sessions: deps,
  store: deps,
  turns: deps,
});

// Middleware (`app.use`) registers as ALL on wildcard paths; `/v1/mcp` is `app.all`, documented as POST.
const registered = new Set(
  app.routes
    .filter((r) => r.path.startsWith("/v1/") && !r.path.endsWith("*"))
    .map((r) => `${r.method === "ALL" ? "post" : r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, "{$1}")}`),
);
const documented = new Set(
  Object.entries(spec.paths)
    .filter(([path]) => path.startsWith("/v1/"))
    .flatMap(([path, ops]) => Object.keys(ops).filter((m) => METHODS.has(m)).map((m) => `${m} ${path}`)),
);

describe("openapi.yaml", () => {
  it("documents every /v1 route", () => {
    expect(registered.size).toBeGreaterThan(0);
    expect([...registered].filter((r) => !documented.has(r))).toEqual([]);
  });

  it("documents only routes that exist", () => {
    expect([...documented].filter((d) => !registered.has(d))).toEqual([]);
  });

  it("is served without auth", async () => {
    const res = await app.request("/openapi.yaml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/yaml");
    expect(parse(await res.text())).toEqual(spec);
  });
});
