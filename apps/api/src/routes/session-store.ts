import { type Db, eq, inArray, sessions, sql, storeOrders } from "@keel/db";
import type { SessionStore } from "./sessions";

export function createSessionStore(db: Db): SessionStore {
  return {
    existingOrders: async (orderIds) => {
      if (orderIds.length === 0) return [];
      const rows = await db
        .select({ orderId: storeOrders.orderId })
        .from(storeOrders)
        .where(inArray(storeOrders.orderId, orderIds));
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
    recordFailedAttempt: async (id) => {
      await db
        .update(sessions)
        .set({ otpAttempts: sql`${sessions.otpAttempts} + 1` })
        .where(eq(sessions.id, id));
    },
    markVerified: async (id, email) => {
      await db.update(sessions).set({ verifiedPayer: email }).where(eq(sessions.id, id));
    },
  };
}
