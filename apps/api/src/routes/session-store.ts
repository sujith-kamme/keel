import { type Db, and, asc, catalogItems, desc, eq, inArray, ledgerEntries, lt, sessionTurns, sessions, sql, storeOrders } from "@keel/db";
import { MAX_OTP_ATTEMPTS, QUARANTINE_TEMPLATE, SAFE_FALLBACK, type TurnDecision } from "@keel/engine";
import type { GuardMode, SessionMode } from "../mode";
import type { SessionStore } from "./sessions";
import { type CatalogItem, category, type NewStoreOrder, type StoreOrderSummary } from "./store";
import type { DecisionSummary, SessionRow, SessionSummary, TurnStore } from "./turns";

export function createOrdersFor(db: Db): (email: string) => Promise<StoreOrderSummary[]> {
  return async (email) => {
    const rows = await db.select().from(storeOrders).where(eq(storeOrders.payerEmail, email));
    return rows.map((r) => ({
      order_id: r.orderId,
      scenario: r.scenario,
      total: { value: r.total, currency: r.currency },
      items: r.items,
      delivered_at: r.deliveredAt?.toISOString() ?? null,
    }));
  };
}

export function createCatalog(db: Db): () => Promise<CatalogItem[]> {
  return async () => {
    const rows = await db.select().from(catalogItems).orderBy(asc(catalogItems.title));
    return rows.map((r) => ({ sku: r.sku, title: r.title, image_url: r.imageUrl, price: r.listPrice, currency: r.currency, category: category(r.title) }));
  };
}

export function createRecordOrder(db: Db): (order: NewStoreOrder) => Promise<void> {
  return async (o) => {
    await db.insert(storeOrders).values({ ...o, scenario: null, deliveredAt: null }).onConflictDoNothing({ target: storeOrders.orderId });
  };
}

export function createSessionStore(db: Db): SessionStore {
  return {
    customerOrders: async (orderIds, email) => {
      if (orderIds.length === 0) return [];
      const rows = await db
        .select({ orderId: storeOrders.orderId })
        .from(storeOrders)
        .where(and(inArray(storeOrders.orderId, orderIds), eq(storeOrders.payerEmail, email)));
      const known = new Set(rows.map((r) => r.orderId));
      return orderIds.filter((id) => known.has(id));
    },
    fixtureOrders: async (orderIds, email) => {
      if (orderIds.length === 0) return [];
      const rows = await db
        .select({ orderId: storeOrders.orderId })
        .from(storeOrders)
        .where(and(inArray(storeOrders.orderId, orderIds), eq(storeOrders.payerEmail, email), sql`${storeOrders.scenario} LIKE 'ctx-%'`));
      const known = new Set(rows.map((r) => r.orderId));
      return orderIds.filter((id) => known.has(id));
    },
    create: async (row) => {
      await db.insert(sessions).values(row);
    },
    get: async (id) => {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
      return row ? { ...row, mode: row.mode as SessionMode, guardMode: row.guardMode as GuardMode } : null;
    },
    reserveAttempt: async (id) => {
      const rows = await db
        .update(sessions)
        .set({ otpAttempts: sql`${sessions.otpAttempts} + 1` })
        .where(and(eq(sessions.id, id), lt(sessions.otpAttempts, MAX_OTP_ATTEMPTS)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },
    markVerified: async (id, email) => {
      await db.update(sessions).set({ verifiedPayer: email }).where(eq(sessions.id, id));
    },
  };
}

const summary = (r: typeof sessions.$inferSelect): SessionSummary => ({
  id: r.id,
  agent_id: r.agentId,
  claimed_email: r.claimedEmail,
  verified: r.verifiedPayer !== null,
  order_ids: r.orderIds,
  state: r.state,
  mode: r.mode as SessionMode,
  created_at: r.createdAt.toISOString(),
  expires_at: r.expiresAt.toISOString(),
});

interface GuardPayload {
  input?: { draft?: unknown; extraction?: { reply_commitments?: { type?: unknown; quoted_text?: unknown }[] } | null };
  result?: { final_reply?: unknown };
  extractor?: { latency_ms?: unknown };
  draft?: unknown;
  quarantined?: unknown;
  control_error?: unknown;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function guardDetails(payload: unknown): NonNullable<DecisionSummary["guard"]> {
  const p = (payload ?? {}) as GuardPayload;
  const commitments = Array.isArray(p.input?.extraction?.reply_commitments) ? p.input.extraction.reply_commitments : [];
  const latency = p.extractor?.latency_ms;
  // Quarantine and control-error rows are written without extraction, so derive the reply that was sent.
  const derived = p.quarantined === true ? QUARANTINE_TEMPLATE : p.control_error === true ? SAFE_FALLBACK : "";
  return {
    draft: str(p.input?.draft) || str(p.draft),
    final_reply: str(p.result?.final_reply) || derived,
    commitments: commitments.map((c) => ({ type: str(c?.type), quoted_text: str(c?.quoted_text) })),
    latency_ms: typeof latency === "number" ? latency : null,
  };
}

export function createTurnStore(db: Db): TurnStore {
  return {
    // Three queries per page: the sessions, then decision counts and last turns for all of them at once.
    listSessions: async ({ limit, mode, state, before }) => {
      const rows = await db
        .select()
        .from(sessions)
        .where(
          and(
            mode === "all" ? undefined : eq(sessions.mode, mode),
            state ? eq(sessions.state, state) : undefined,
            // An unknown cursor id matches nothing, so the page is empty.
            before ? sql`(${sessions.createdAt}, ${sessions.id}) < (select s.created_at, s.id from sessions s where s.id = ${before})` : undefined,
          ),
        )
        .orderBy(desc(sessions.createdAt), desc(sessions.id))
        .limit(limit);
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const [counts, lastTurns] = await Promise.all([
        db
          .select({ id: ledgerEntries.sessionId, n: sql<number>`count(*)::int` })
          .from(ledgerEntries)
          .where(inArray(ledgerEntries.sessionId, ids))
          .groupBy(ledgerEntries.sessionId),
        db
          .select({ id: sessionTurns.sessionId, at: sql<string>`max(${sessionTurns.createdAt})` })
          .from(sessionTurns)
          .where(inArray(sessionTurns.sessionId, ids))
          .groupBy(sessionTurns.sessionId),
      ]);
      const count = new Map(counts.map((c) => [c.id, c.n]));
      const last = new Map(lastTurns.map((t) => [t.id, new Date(t.at).toISOString()]));
      return rows.map((r): SessionRow => ({ ...summary(r), decision_count: count.get(r.id) ?? 0, last_turn_at: last.get(r.id) ?? null }));
    },
    session: async (id) => {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
      return row ? summary(row) : null;
    },
    turns: async (sessionId) => {
      const rows = await db.select().from(sessionTurns).where(eq(sessionTurns.sessionId, sessionId)).orderBy(asc(sessionTurns.id));
      return rows.map((r) => ({ role: r.role as "customer" | "agent", text: r.text, decision_ids: r.decisionIds, agent_id: r.agentId, created_at: r.createdAt.toISOString() }));
    },
    decisions: async (sessionId) => {
      const rows = await db
        .select({
          seq: ledgerEntries.seq,
          decisionId: ledgerEntries.decisionId,
          tool: sql<string>`${ledgerEntries.payload}->>'tool'`,
          payload: ledgerEntries.payload,
          orderId: ledgerEntries.orderId,
          verdict: ledgerEntries.verdict,
          reasonCodes: ledgerEntries.reasonCodes,
          createdAt: ledgerEntries.createdAt,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.sessionId, sessionId))
        .orderBy(asc(ledgerEntries.seq));
      return rows.map((r) => ({
        seq: r.seq,
        decision_id: r.decisionId,
        tool: r.tool,
        order_id: r.orderId,
        verdict: r.verdict,
        reason_codes: r.reasonCodes,
        created_at: r.createdAt.toISOString(),
        ...(r.tool === "guard" ? { guard: guardDetails(r.payload) } : {}),
      }));
    },
    appendTurn: async (turn) => {
      await db.insert(sessionTurns).values(turn);
    },
    customerTurnCount: async (sessionId) => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(sessionTurns)
        .where(and(eq(sessionTurns.sessionId, sessionId), eq(sessionTurns.role, "customer")));
      return row?.n ?? 0;
    },
  };
}

const isOrderFacts = (v: unknown): v is NonNullable<TurnDecision["order_facts"]> => {
  const f = v as Record<string, unknown> | null;
  return (
    typeof f === "object" && f !== null &&
    typeof f.order_id === "string" && typeof f.total === "string" && typeof f.currency === "string" && typeof f.refunded === "string" &&
    Array.isArray(f.item_prices) && f.item_prices.every((x) => typeof x === "string")
  );
};

/** Ledger rows for the given decision ids that belong to this session; ids from other sessions are dropped. */
export function createTurnDecisions(db: Db): (sessionId: string, ids: string[]) => Promise<TurnDecision[]> {
  return async (sessionId, ids) => {
    if (ids.length === 0) return [];
    const rows = await db
      .select({ payload: ledgerEntries.payload, verdict: ledgerEntries.verdict })
      .from(ledgerEntries)
      .where(and(inArray(ledgerEntries.decisionId, ids), eq(ledgerEntries.sessionId, sessionId)));
    return rows.map((r) => {
      const p = r.payload as { tool: string; args?: Record<string, unknown>; message?: unknown; order_facts?: unknown };
      const decision: TurnDecision = { tool: p.tool, verdict: r.verdict as TurnDecision["verdict"], args: p.args ?? {} };
      if (typeof p.message === "string") decision.message = p.message;
      if (isOrderFacts(p.order_facts)) decision.order_facts = p.order_facts;
      return decision;
    });
  };
}

/**
 * Executed money ALLOWs earlier in this session: refunds COMPLETED or PENDING, discounts ISSUED.
 * Reviewer-approved rows are not included: the review row carries no args (amount, order_id, percent).
 */
export function createSessionDecisions(db: Db): (sessionId: string, excludeIds: string[]) => Promise<TurnDecision[]> {
  return async (sessionId, excludeIds) => {
    const tool = sql`${ledgerEntries.payload}->>'tool'`;
    const status = sql`${ledgerEntries.payload}->'execution'->>'status'`;
    const rows = await db
      .select({ payload: ledgerEntries.payload, verdict: ledgerEntries.verdict })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.sessionId, sessionId),
          eq(ledgerEntries.verdict, "ALLOW"),
          sql`((${tool} = 'offer_refund' AND ${status} IN ('COMPLETED', 'PENDING')) OR (${tool} = 'offer_discount' AND ${status} = 'ISSUED'))`,
          excludeIds.length > 0 ? sql`${ledgerEntries.decisionId} NOT IN (${sql.join(excludeIds.map((i) => sql`${i}`), sql`, `)})` : undefined,
        ),
      )
      .orderBy(asc(ledgerEntries.seq));
    return rows.map((r) => {
      const p = r.payload as { tool: string; args?: Record<string, unknown> };
      return { tool: p.tool, verdict: "ALLOW" as const, args: p.args ?? {} };
    });
  };
}
