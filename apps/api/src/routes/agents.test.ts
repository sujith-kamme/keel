import type { LedgerContent } from "@keel/engine";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type AgentControl, type AgentStore, mountAgents } from "./agents";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const bearer = (k: string) => ({ authorization: `Bearer ${k}`, "content-type": "application/json" });
const op = bearer(operatorKey);

function setup() {
  const rows = new Map<string, AgentControl>();
  const ledger: LedgerContent[] = [];
  const store: AgentStore = {
    get: async (id) => rows.get(id) ?? null,
    set: async (id, frozen, operator, content) => {
      ledger.push(content);
      const row = { agent_id: id, frozen, updated_at: "2026-10-27T12:00:00.000Z", updated_by: operator };
      rows.set(id, row);
      return row;
    },
  };
  let n = 0;
  const app = new Hono();
  mountAgents(app, { operatorKey, merchantKey, store, newId: (p) => `${p}_${++n}` });
  return { app, ledger };
}
const post = (app: Hono, id: string, action: string, body: unknown, headers: Record<string, string> = op) =>
  app.request(`/v1/agents/${id}/${action}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("agents API", () => {
  it("401 without or with a wrong key, 403 for the merchant key", async () => {
    const { app } = setup();
    for (const headers of [{}, bearer("x".repeat(32))] as Record<string, string>[]) {
      expect((await app.request("/v1/agents/agt_a", { headers })).status).toBe(401);
      expect((await post(app, "agt_a", "freeze", { operator: "ops" }, headers)).status).toBe(401);
    }
    expect((await app.request("/v1/agents/agt_a", { headers: bearer(merchantKey) })).status).toBe(403);
    expect((await post(app, "agt_a", "unfreeze", { operator: "ops" }, bearer(merchantKey))).status).toBe(403);
  });

  it.each(["demo", "agt_", "agt_a-b", `agt_${"a".repeat(65)}`, "**"])("400 for agent id %s", async (id) => {
    const { app } = setup();
    expect((await app.request(`/v1/agents/${id}`, { headers: op })).status).toBe(400);
    expect((await post(app, id, "freeze", { operator: "ops" })).status).toBe(400);
  });

  it("reports unfrozen with no row, freezes and unfreezes with a ledger row", async () => {
    const { app, ledger } = setup();
    const get = async () => (await app.request("/v1/agents/agt_demo", { headers: op })).json();
    expect(await get()).toEqual({ agent_id: "agt_demo", frozen: false, updated_at: null, updated_by: null });

    const res = await post(app, "agt_demo", "freeze", { operator: "sam" });
    expect(res.status).toBe(200);
    expect(await get()).toEqual({ agent_id: "agt_demo", frozen: true, updated_at: "2026-10-27T12:00:00.000Z", updated_by: "sam" });
    expect(ledger[0]).toEqual({
      decision_id: "dec_1",
      session_id: null,
      order_id: null,
      capture_id: null,
      dispute_id: null,
      mode: "LIVE",
      verdict: "HOLD",
      reason_codes: ["AGENT_FROZEN"],
      payload: { tool: "kill_switch", action: "freeze", agent_id: "agt_demo", operator: "sam" },
    });

    await post(app, "agt_demo", "unfreeze", { operator: "sam" });
    expect(((await get()) as AgentControl).frozen).toBe(false);
    expect(ledger[1]).toMatchObject({ verdict: "ALLOW", reason_codes: ["OK"], payload: { action: "unfreeze" } });
  });

  it("accepts * literally and URL-encoded", async () => {
    const { app } = setup();
    expect((await post(app, "*", "freeze", { operator: "ops" })).status).toBe(200);
    const res = await app.request("/v1/agents/%2A", { headers: op });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ agent_id: "*", frozen: true });
  });

  it.each([null, {}, { operator: "" }, { operator: "a".repeat(65) }, { operator: "ops", extra: 1 }, { operator: 5 }])("400 for body %j", async (body) => {
    const { app, ledger } = setup();
    expect((await post(app, "agt_demo", "freeze", body)).status).toBe(400);
    expect(ledger).toHaveLength(0);
  });
});
