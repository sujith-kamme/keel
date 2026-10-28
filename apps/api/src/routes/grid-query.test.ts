import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { type GridQueryOptions, cleanSchema, mountGridQuery } from "./grid-query";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const NOW = new Date("2026-10-28T12:00:00Z");
const schema = { type: "object", properties: { filter: { type: ["object", "null"] } }, required: ["filter"], additionalProperties: false };
const state = { filter: { filterModel: { verdict: { filterType: "set", values: ["HOLD"] } } }, sort: null };
const reply = (text: string, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text }] });

function setup(over: Partial<GridQueryOptions> = {}) {
  const complete = vi.fn<GridQueryOptions["complete"]>(async () => reply(JSON.stringify(state)));
  const app = new Hono();
  mountGridQuery(app, { operatorKey, merchantKey, complete, model: "claude-haiku-5-5", timeoutMs: 50, now: () => NOW, ...over });
  return { app, complete };
}

const post = (app: Hono, body: unknown, key = operatorKey) =>
  app.request("/v1/grid-query", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("cleanSchema", () => {
  it("keeps only keywords Claude structured output accepts", () => {
    expect(
      cleanSchema({
        type: "object",
        properties: {
          n: { type: "number", minimum: 0, maximum: 9 },
          s: { type: "string", pattern: "^a", format: "date" },
          a: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
          one: { type: "array", minItems: 1 },
          zero: { type: "array", minItems: 0 },
        },
        required: ["n"],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: {
        n: { type: "number" },
        s: { type: "string" },
        a: { type: "array", items: { type: "string" } },
        one: { type: "array", minItems: 1 },
        zero: { type: "array", minItems: 0 },
      },
      required: ["n"],
      additionalProperties: false,
    });
  });

  it("keeps $ref, $defs and anyOf, and never drops property names that look like keywords", () => {
    expect(
      cleanSchema({
        $defs: { pattern: { type: "string", maxLength: 3 } },
        anyOf: [{ $ref: "#/$defs/pattern" }, { const: "x", minimum: 1 }],
        properties: { pattern: { enum: ["a", "b"] }, minimum: { type: "number", minimum: 2 } },
      }),
    ).toEqual({
      $defs: { pattern: { type: "string" } },
      anyOf: [{ $ref: "#/$defs/pattern" }, { const: "x" }],
      properties: { pattern: { enum: ["a", "b"] }, minimum: { type: "number" } },
    });
  });
});

describe("grid-query route", () => {
  it("needs the operator key", async () => {
    const { app } = setup();
    expect((await app.request("/v1/grid-query", { method: "POST" })).status).toBe(401);
    expect((await post(app, { query: "x", schema }, merchantKey)).status).toBe(403);
  });

  it("rejects an empty or long query, and a missing, non-object or oversized schema", async () => {
    const { app, complete } = setup();
    for (const body of [
      { query: "  ", schema },
      { query: "x".repeat(501), schema },
      { query: "held refunds" },
      { query: "held refunds", schema: [schema] },
      { query: "held refunds", schema: "{}" },
      { query: "held refunds", schema: { description: "x".repeat(64 * 1024) } },
    ]) {
      const res = await post(app, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it("asks the model with the cleaned schema and returns the grid state", async () => {
    const { app, complete } = setup();
    const res = await post(app, { query: " held refunds ", schema: { ...schema, properties: { filter: { type: ["object", "null"], minItems: 3 } } } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state });
    const [params, options] = complete.mock.calls[0]!;
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.messages).toEqual([{ role: "user", content: "held refunds" }]);
    expect(params.system).toContain("Today is 2026-10-28.");
    expect(params.output_config?.format).toEqual({ type: "json_schema", schema: cleanSchema(schema) });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("says not_understood on a refusal, max_tokens, non-JSON or non-object output", async () => {
    for (const r of [reply("{}", "refusal"), reply("{", "max_tokens"), reply("not json"), reply("[1]"), reply("null"), { stop_reason: "end_turn", content: [] }]) {
      const { app } = setup({ complete: async () => r });
      const res = await post(app, { query: "held refunds", schema });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "not_understood" });
    }
  });

  it("times out with 504 and maps other model errors to 502", async () => {
    const hang: GridQueryOptions["complete"] = (_p, { signal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const slow = await post(setup({ complete: hang }).app, { query: "held refunds", schema });
    expect(slow.status).toBe(504);
    expect(await slow.json()).toEqual({ error: "timeout" });

    const down = await post(setup({ complete: async () => Promise.reject(new Error("overloaded")) }).app, { query: "held refunds", schema });
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ error: "model_unavailable" });
  });

  it("is not cut off by the app's 64 KB body limit", async () => {
    const complete = vi.fn<GridQueryOptions["complete"]>(async () => reply("{}"));
    const app = createApp({
      checks: {},
      gridQuery: { operatorKey, merchantKey, complete, model: "claude-haiku-5-5", timeoutMs: 50, now: () => NOW },
    });
    // Exactly 64 KB of schema, so the whole body is over 64 KB.
    const big = { ...schema, description: "" };
    big.description = "x".repeat(64 * 1024 - JSON.stringify(big).length);
    expect(JSON.stringify(big).length).toBe(64 * 1024);
    const res = await post(app, { query: "held refunds", schema: big });
    expect(res.status).toBe(200);
  });
});
