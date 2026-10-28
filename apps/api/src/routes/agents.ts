import type { LedgerContent } from "@keel/engine";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { operatorAuth } from "./operator-auth";

export interface AgentControl {
  agent_id: string;
  frozen: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

export interface AgentStore {
  get: (agentId: string) => Promise<AgentControl | null>;
  /** Upserts the control row and appends `content` in one transaction. */
  set: (agentId: string, frozen: boolean, operator: string, content: LedgerContent) => Promise<AgentControl>;
}

export interface AgentOptions {
  operatorKey: string;
  merchantKey: string;
  store: AgentStore;
  newId: (prefix: string) => string;
}

const AGENT_ID = /^(agt_[A-Za-z0-9_]{1,64}|\*)$/;
const Freeze = z.strictObject({ operator: z.string().min(1).max(64) });

/** Per-agent (or global "*") kill switch (operator key only). */
export function mountAgents(app: Hono, opts: AgentOptions): void {
  const auth = operatorAuth(opts.operatorKey, opts.merchantKey);
  const { store } = opts;

  /** Auth and id checks; returns the agent id or an error response. */
  const guarded = (c: Context): string | Response => {
    const a = auth(c);
    if (a !== "ok") return c.json({ error: a === 401 ? "unauthorized" : "forbidden" }, a);
    const id = c.req.param("id") ?? "";
    return AGENT_ID.test(id) ? id : c.json({ error: "invalid_request" }, 400);
  };

  app.get("/v1/agents/:id", async (c) => {
    const id = guarded(c);
    if (id instanceof Response) return id;
    return c.json((await store.get(id)) ?? { agent_id: id, frozen: false, updated_at: null, updated_by: null });
  });

  for (const action of ["freeze", "unfreeze"] as const) {
    app.post(`/v1/agents/:id/${action}`, async (c) => {
      const id = guarded(c);
      if (id instanceof Response) return id;
      const req = Freeze.safeParse(await c.req.json().catch(() => null));
      if (!req.success) return c.json({ error: "invalid_request" }, 400);
      const freeze = action === "freeze";
      return c.json(
        await store.set(id, freeze, req.data.operator, {
          decision_id: opts.newId("dec"),
          session_id: null,
          order_id: null,
          capture_id: null,
          dispute_id: null,
          mode: "LIVE",
          verdict: freeze ? "HOLD" : "ALLOW",
          reason_codes: [freeze ? "AGENT_FROZEN" : "OK"],
          payload: { tool: "kill_switch", action, agent_id: id, operator: req.data.operator },
        }),
      );
    });
  }
}
