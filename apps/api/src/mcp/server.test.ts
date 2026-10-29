import { type Capability, issueToken } from "@keel/engine";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../gateway/handle";
import { mountMcp } from "./server";

const key = "k".repeat(32);
const now = new Date("2026-10-27T12:00:00Z");
const claims: Capability = {
  session_id: "ses_1",
  agent_id: "agt_demo",
  verified_payer: null,
  orders: ["ORDER-1"],
  allow: ["get_order", "offer_refund", "offer_discount", "state_policy", "escalate_to_human"],
  max_refund_total: "100.00",
  expires_at: "2026-10-27T12:30:00Z",
};

function setup() {
  const handle = vi.fn(async (_cap: Capability, call: ToolCall) => ({
    decision: "ALLOW" as const,
    reason_code: "OK" as const,
    decision_id: "dec_1",
    message: `handled ${call.tool}`,
  }));
  const app = new Hono();
  mountMcp(app, { signingKey: key, now: () => now, handle });
  return { app, handle };
}

let id = 0;
const rpc = (app: Hono, token: string | null, method: string, params: unknown = {}) =>
  app.request("/v1/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });

describe("/v1/mcp", () => {
  it.each([
    ["no token", null],
    ["a tampered token", `${issueToken(claims, key)}x`],
    ["an expired token", issueToken({ ...claims, expires_at: "2026-10-27T11:59:59Z" }, key)],
    ["a token signed with another key", issueToken(claims, "x".repeat(32))],
  ])("rejects %s with 401", async (_label, token) => {
    const { app, handle } = setup();
    const res = await rpc(app, token, "tools/list");
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("lists exactly the six Keel tools", async () => {
    const { app } = setup();
    const res = await rpc(app, issueToken(claims, key), "tools/list");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual([
      "escalate_to_human",
      "get_order",
      "handoff_to_refund",
      "offer_discount",
      "offer_refund",
      "state_policy",
    ]);
  });

  it("passes a valid call and the verified capability to the gateway", async () => {
    const { app, handle } = setup();
    const res = await rpc(app, issueToken(claims, key), "tools/call", {
      name: "offer_refund",
      arguments: { order_id: "ORDER-1", amount: "42.00", reason: "damaged", policy_id: "refund-standard" },
    });
    const body = (await res.json()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(body.result.content[0]!.text)).toMatchObject({ decision: "ALLOW", message: "handled offer_refund" });
    expect(handle).toHaveBeenCalledWith(claims, {
      tool: "offer_refund",
      args: { order_id: "ORDER-1", amount: "42.00", reason: "damaged", policy_id: "refund-standard" },
    });
  });

  it.each([
    { order_id: "ORDER-1", amount: "lots", reason: "x", policy_id: "refund-standard" },
    { order_id: "../../v1/customer/disputes", amount: "1.00", reason: "x", policy_id: "refund-standard" },
    { order_id: "ORDER-1", amount: "1.00", reason: "x" },
  ])("rejects invalid arguments without reaching the gateway: %j", async (args) => {
    const { app, handle } = setup();
    const res = await rpc(app, issueToken(claims, key), "tools/call", { name: "offer_refund", arguments: args });
    const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(handle).not.toHaveBeenCalled();
  });
});
