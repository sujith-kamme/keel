import { type Db, and, eq, inArray, lt, sessions, sql, storeOrders } from "@keel/db";
import { MAX_OTP_ATTEMPTS } from "@keel/engine";
import type { SessionStore } from "./sessions";
import type { StoreOrderSummary } from "./store";

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
