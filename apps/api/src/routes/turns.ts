import type { Context, Hono } from "hono";
import { z } from "zod";
import type { SessionMode } from "../mode";
import { merchantAuth } from "./merchant-auth";

const MAX_CUSTOMER_TURNS = 30;

export interface SessionSummary {
  id: string;
  agent_id: string;
  claimed_email: string;
  verified: boolean;
  order_ids: string[];
  state: string;
  mode: SessionMode;
  created_at: string;
  expires_at: string;
}

/** A list row: the summary plus what the console table shows. */
export interface SessionRow extends SessionSummary {
  /** Number of ledger rows for the session (tool calls, guard checks, risk rows). */
  decision_count: number;
  last_turn_at: string | null;
}

export type SessionState = "ACTIVE" | "ESCALATED" | "QUARANTINED";

export interface Turn {
  role: "customer" | "agent";
  text: string;
  decision_ids: string[];
  created_at: string;
}

export interface DecisionSummary {
  seq: number;
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
  /** Newest first (created_at, then id); `before` is a session id: only sessions listed after it. */
  listSessions: (opts: { limit: number; mode: SessionMode | "all"; state?: SessionState; before?: string }) => Promise<SessionRow[]>;
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
  /** Current risk score per session (batched); a missing id or a failed read shows as no score. */
  scores: (sessionIds: string[]) => Promise<Map<string, number>>;
}

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  mode: z.enum(["LIVE", "CONTEXT", "all"]).default("LIVE"),
  state: z.enum(["ACTIVE", "ESCALATED", "QUARANTINED"]).optional(),
  before: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});
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
    const q = ListQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "invalid_request" }, 400);
    const rows = await opts.store.listSessions(q.data);
    const scores = await opts.scores(rows.map((r) => r.id)).catch(() => new Map<string, number>());
    // A full page may have more after it; the cursor is the last session's id.
    const next = rows.length === q.data.limit ? rows.at(-1)!.id : null;
    return c.json({ sessions: rows.map((r) => ({ ...r, risk_score: scores.get(r.id) ?? null })), next_before: next });
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
