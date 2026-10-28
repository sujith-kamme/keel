import type { Context, Hono } from "hono";
import { z } from "zod";
import { merchantAuth } from "./merchant-auth";

const MAX_CUSTOMER_TURNS = 30;

export interface SessionSummary {
  id: string;
  agent_id: string;
  claimed_email: string;
  verified: boolean;
  state: string;
  created_at: string;
  expires_at: string;
}

export interface Turn {
  role: "customer" | "agent";
  text: string;
  decision_ids: string[];
  created_at: string;
}

export interface DecisionSummary {
  decision_id: string;
  tool: string;
  order_id: string | null;
  verdict: string;
  reason_codes: string[];
  created_at: string;
  guard?: {
    draft: string;
    final_reply: string;
    commitments: { type: string; quoted_text: string }[];
    latency_ms: number | null;
  };
}

export interface SessionRisk {
  score: number;
  threshold: number;
  signals: { kind: string; weight: number; at: string }[];
}

export interface TurnStore {
  /** Newest first. */
  listSessions: (limit: number) => Promise<SessionSummary[]>;
  session: (id: string) => Promise<SessionSummary | null>;
  /** Oldest first. */
  turns: (sessionId: string) => Promise<Turn[]>;
  /** Ledger rows for the session, in ledger order. */
  decisions: (sessionId: string) => Promise<DecisionSummary[]>;
  appendTurn: (turn: { sessionId: string; role: "customer" | "agent"; text: string; decisionIds: string[] }) => Promise<void>;
  customerTurnCount: (sessionId: string) => Promise<number>;
}

export interface TurnOptions {
  merchantKey: string;
  store: TurnStore;
  now: () => Date;
  riskDetail: (sessionId: string) => Promise<SessionRisk>;
}

const Limit = z.coerce.number().int().min(1).max(100);
const AppendTurn = z.object({
  role: z.enum(["customer", "agent"]),
  text: z.string().min(1).max(4000),
  decision_ids: z.array(z.string().regex(/^dec_[A-Za-z0-9]{1,64}$/)).max(10),
});

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** Conversation turns and the session read API behind the console (docs/FSD.md §13). */
export function mountTurns(app: Hono, opts: TurnOptions): void {
  const authorized = merchantAuth(opts.merchantKey);

  app.get("/v1/sessions", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const limit = Limit.safeParse(c.req.query("limit") ?? 20);
    if (!limit.success) return c.json({ error: "invalid_request" }, 400);
    return c.json({ sessions: await opts.store.listSessions(limit.data) });
  });

  // Expired sessions stay readable: the console shows past conversations.
  app.get("/v1/sessions/:id", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.param("id");
    const session = await opts.store.session(id);
    if (!session) return c.json({ error: "not_found" }, 404);
    const [turns, decisions, risk] = await Promise.all([
      opts.store.turns(id),
      opts.store.decisions(id),
      opts.riskDetail(id).catch(() => null),
    ]);
    return c.json({ session, turns, decisions, risk });
  });

  app.post("/v1/sessions/:id/turns", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const req = await body(c, AppendTurn);
    if (!req) return c.json({ error: "invalid_request" }, 400);
    const id = c.req.param("id");
    const session = await opts.store.session(id);
    if (!session || new Date(session.expires_at) <= opts.now()) return c.json({ error: "not_found" }, 404);
    if (req.role === "customer" && (await opts.store.customerTurnCount(id)) >= MAX_CUSTOMER_TURNS) {
      return c.json({ error: "turn_limit" }, 429);
    }
    await opts.store.appendTurn({ sessionId: id, role: req.role, text: req.text, decisionIds: req.decision_ids });
    return c.json({}, 201);
  });
}
