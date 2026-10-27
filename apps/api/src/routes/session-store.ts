import { type Db, and, asc, desc, eq, inArray, ledgerEntries, lt, sessionTurns, sessions, sql, storeOrders } from "@keel/db";
import { MAX_OTP_ATTEMPTS } from "@keel/engine";
import type { SessionStore } from "./sessions";
import type { StoreOrderSummary } from "./store";
import type { SessionSummary, TurnStore } from "./turns";

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
    create: async (row) => {
      await db.insert(sessions).values(row);
    },
    get: async (id) => {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
      return row ?? null;
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
  state: r.state,
  created_at: r.createdAt.toISOString(),
  expires_at: r.expiresAt.toISOString(),
});

export function createTurnStore(db: Db): TurnStore {
  return {
    listSessions: async (limit) => {
      const rows = await db.select().from(sessions).orderBy(desc(sessions.createdAt)).limit(limit);
      return rows.map(summary);
    },
    session: async (id) => {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
      return row ? summary(row) : null;
    },
    turns: async (sessionId) => {
      const rows = await db.select().from(sessionTurns).where(eq(sessionTurns.sessionId, sessionId)).orderBy(asc(sessionTurns.id));
      return rows.map((r) => ({ role: r.role as "customer" | "agent", text: r.text, decision_ids: r.decisionIds, created_at: r.createdAt.toISOString() }));
    },
    decisions: async (sessionId) => {
      const rows = await db
        .select({
          decisionId: ledgerEntries.decisionId,
          tool: sql<string>`${ledgerEntries.payload}->>'tool'`,
          orderId: ledgerEntries.orderId,
          verdict: ledgerEntries.verdict,
          reasonCodes: ledgerEntries.reasonCodes,
          createdAt: ledgerEntries.createdAt,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.sessionId, sessionId))
        .orderBy(asc(ledgerEntries.seq));
      return rows.map((r) => ({
        decision_id: r.decisionId,
        tool: r.tool,
        order_id: r.orderId,
        verdict: r.verdict,
        reason_codes: r.reasonCodes,
        created_at: r.createdAt.toISOString(),
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
