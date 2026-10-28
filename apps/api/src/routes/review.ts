import type { ReasonCode } from "@keel/core";
import { type Capability, type LedgerContent, TOOLS, checkScope } from "@keel/engine";
import type { Context, Hono } from "hono";
import { MONEY_TOOLS } from "@keel/risk";
import { z } from "zod";
import { type GatewayDeps, type Outcome, type ToolCall, offerDiscount, offerRefund } from "../gateway/handle";
import { operatorAuth } from "./operator-auth";
import { MAX_REFUND_TOTAL } from "./sessions";

const LIMIT = 200;

export interface HeldEntry {
  decision_id: string;
  session_id: string | null;
  order_id: string | null;
  capture_id: string | null;
  verdict: string;
  reason_codes: string[];
  tool: string;
  args: Record<string, unknown>;
  created_at: string;
}

export interface ReviewStore {
  /** HOLD money rows with no resolved review row, newest first, with their session's state. */
  pendingHeld: (limit: number) => Promise<(HeldEntry & { session_id: string; session_state: string })[]>;
  /** QUARANTINED/ESCALATED sessions with no pending held action, newest first; reason codes of the latest risk row. */
  flaggedSessions: (limit: number) => Promise<{ session_id: string; session_state: string; reason_codes: string[]; created_at: string }[]>;
  /** Any ledger row by decision id. */
  entry: (decisionId: string) => Promise<HeldEntry | null>;
  /** A review row with ref = decisionId and resolved = true exists. */
  isResolved: (decisionId: string) => Promise<boolean>;
  /**
   * A PayPal refund for this held decision failed without confirmation (on the held
   * row or an approve attempt), so money may have moved. Only an idempotent re-approve
   * can settle it.
   */
  paymentUnconfirmed: (decisionId: string) => Promise<boolean>;
  session: (id: string) => Promise<{ id: string; agent_id: string; verified_payer: string | null; order_ids: string[]; mode: string } | null>;
  /** Sets a QUARANTINED or ESCALATED session ACTIVE and appends `content` atomically. */
  release: (sessionId: string, content: LedgerContent) => Promise<"released" | "not_found" | "not_flagged">;
}

export interface ReviewOptions {
  operatorKey: string;
  merchantKey: string;
  store: ReviewStore;
  /** Executes approved actions through the same code path as the agent gateway. */
  gateway: GatewayDeps;
  detail: (sessionId: string) => Promise<{ score: number }>;
}

export interface ReviewItem {
  kind: "held_action" | "session";
  decision_id?: string;
  session_id: string;
  tool?: string;
  args?: Record<string, unknown>;
  reason_codes: string[];
  score: number | null;
  session_state: string;
  created_at: string;
}

const Review = z.strictObject({ reviewer: z.string().min(1).max(64) });
const DECISION_ID = /^dec_[A-Za-z0-9]{1,64}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** 200 executed; 422 refused (hard rule, scope, budget); 502 PayPal failed; 503 facts unavailable. */
function status(o: Outcome): 200 | 422 | 502 | 503 {
  if (o.verdict === "ALLOW") return 200;
  if ((o.record?.execution as { status?: string } | undefined)?.status === "FAILED") return 502;
  return o.reason === "VERIFIER_UNAVAILABLE" ? 503 : 422;
}

/** Human review queue and session release (operator key only). */
export function mountReview(app: Hono, opts: ReviewOptions): void {
  const auth = operatorAuth(opts.operatorKey, opts.merchantKey);
  const { gateway: g, store } = opts;
  const denied = (c: Context) => {
    const a = auth(c);
    return a === "ok" ? null : c.json({ error: a === 401 ? "unauthorized" : "forbidden" }, a);
  };

  app.get("/v1/review", async (c) => {
    const no = denied(c);
    if (no) return no;
    const [held, flagged] = await Promise.all([store.pendingHeld(LIMIT), store.flaggedSessions(LIMIT)]);
    const ids = [...new Set([...held, ...flagged].map((i) => i.session_id))];
    const scores = new Map(await Promise.all(ids.map(async (id) => [id, await opts.detail(id).then((d) => d.score, () => null)] as const)));
    const items: ReviewItem[] = [
      ...held.map((h) => ({
        kind: "held_action" as const,
        decision_id: h.decision_id,
        session_id: h.session_id,
        tool: h.tool,
        args: h.args,
        reason_codes: h.reason_codes,
        score: scores.get(h.session_id) ?? null,
        session_state: h.session_state,
        created_at: h.created_at,
      })),
      ...flagged.map((s) => ({ kind: "session" as const, ...s, score: scores.get(s.session_id) ?? null })),
    ];
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return c.json({ items: items.slice(0, LIMIT) });
  });

  /** Common checks; returns the pending held entry or an error response. */
  async function pendingHold(c: Context): Promise<{ held: HeldEntry & { session_id: string }; reviewer: string } | Response> {
    const no = denied(c);
    if (no) return no;
    const req = await body(c, Review);
    if (!req) return c.json({ error: "invalid_request" }, 400);
    const id = c.req.param("decision_id") ?? "";
    const held = DECISION_ID.test(id) ? await store.entry(id) : null;
    if (!held || held.verdict !== "HOLD" || !MONEY_TOOLS.includes(held.tool) || held.session_id === null) {
      return c.json({ error: "not_found" }, 404);
    }
    // Simulated (CONTEXT) sessions have no review queue.
    if ((await store.session(held.session_id))?.mode !== "LIVE") return c.json({ error: "not_found" }, 404);
    if (await store.isResolved(id)) return c.json({ error: "already_resolved" }, 409);
    return { held: { ...held, session_id: held.session_id }, reviewer: req.reviewer };
  }

  const reviewRow = (held: HeldEntry & { session_id: string }, verdict: LedgerContent["verdict"], reasons: string[], payload: Record<string, unknown>): LedgerContent => ({
    decision_id: g.newId("dec"),
    session_id: held.session_id,
    order_id: held.order_id,
    capture_id: held.capture_id,
    dispute_id: null,
    mode: "LIVE",
    verdict,
    reason_codes: reasons as ReasonCode[],
    payload: { tool: "review", ref: held.decision_id, ...payload },
  });

  // Serialize with the gateway (same order lock) and with other reviewers.
  const locked = <T>(held: HeldEntry & { session_id: string }, fn: () => Promise<T>) =>
    g.withOrderLock(held.session_id, held.order_id ?? held.decision_id, fn);

  app.post("/v1/review/:decision_id/deny", async (c) => {
    const r = await pendingHold(c);
    if (r instanceof Response) return r;
    const { held, reviewer } = r;
    return locked(held, async () => {
      if (await store.isResolved(held.decision_id)) return c.json({ error: "already_resolved" }, 409);
      // Money may have moved: settle it with an (idempotent) approve instead.
      if (await store.paymentUnconfirmed(held.decision_id)) return c.json({ error: "payment_unconfirmed" }, 409);
      const row = reviewRow(held, "BLOCK", held.reason_codes, { action: "deny", reviewer, resolved: true });
      await g.appendLedger(row);
      return c.json({ decision_id: row.decision_id });
    });
  });

  app.post("/v1/review/:decision_id/approve", async (c) => {
    const r = await pendingHold(c);
    if (r instanceof Response) return r;
    const { held, reviewer } = r;
    const session = await store.session(held.session_id);
    if (!session) return c.json({ error: "not_found" }, 404);
    // The capability the session's token carried; held calls may have skipped the scope check.
    const cap: Capability = {
      session_id: session.id,
      agent_id: session.agent_id,
      verified_payer: session.verified_payer,
      orders: session.order_ids,
      allow: [...TOOLS],
      max_refund_total: MAX_REFUND_TOTAL,
      // Not checked by checkScope; a reviewer may act after the agent's token expired.
      expires_at: g.now().toISOString(),
    };

    return locked(held, async () => {
      if (await store.isResolved(held.decision_id)) return c.json({ error: "already_resolved" }, 409);
      const now = g.now();
      let outcome: Outcome;
      if (held.tool === "offer_refund") {
        const args = held.args as Extract<ToolCall, { tool: "offer_refund" }>["args"];
        // The held decision id is the PayPal request id: approving twice can't refund twice.
        outcome = await offerRefund(g, cap, args, held.decision_id, now, true);
      } else {
        const args = held.args as Extract<ToolCall, { tool: "offer_discount" }>["args"];
        outcome = checkScope(cap, { tool: "offer_discount", order_id: args.order_id }, "0.00")
          ? await offerDiscount(g, cap, args, now)
          : { verdict: "BLOCK", reason: "CAPABILITY_OUT_OF_SCOPE" };
      }
      const code = status(outcome);
      const verdict = code === 200 ? "ALLOW" : outcome.verdict === "BLOCK" ? "BLOCK" : "HOLD";
      // A hard BLOCK is final; a HOLD (budget, facts, PayPal) may clear, so it stays queued.
      const row = reviewRow(held, verdict, [outcome.reason], {
        action: "approve",
        reviewer,
        resolved: code === 200 || verdict === "BLOCK",
        ...outcome.record,
      });
      if (outcome.capture_id) row.capture_id = outcome.capture_id;
      await g.appendLedger(row);
      const execution = outcome.record?.execution;
      if (code === 200) return c.json({ decision_id: row.decision_id, execution });
      if (code === 422) return c.json({ error: "blocked", reason_code: outcome.reason }, 422);
      return c.json({ error: code === 502 ? "paypal_failed" : "verifier_unavailable", decision_id: row.decision_id }, code);
    });
  });

  app.post("/v1/sessions/:id/release", async (c) => {
    const no = denied(c);
    if (no) return no;
    const req = await body(c, Review);
    if (!req) return c.json({ error: "invalid_request" }, 400);
    const id = c.req.param("id");
    const decision_id = g.newId("dec");
    const released = !SESSION_ID.test(id) || (await store.session(id))?.mode !== "LIVE"
      ? "not_found"
      : await store.release(id, {
        decision_id,
        session_id: id,
        order_id: null,
        capture_id: null,
        dispute_id: null,
        mode: "LIVE",
        verdict: "ALLOW",
        reason_codes: ["OK"],
        payload: { tool: "release", reviewer: req.reviewer },
      });
    if (released === "not_found") return c.json({ error: "not_found" }, 404);
    if (released === "not_flagged") return c.json({ error: "not_flagged" }, 409);
    return c.json({ decision_id, state: "ACTIVE" });
  });
}
