import { randomUUID } from "node:crypto";
import { type Db, activePolicy, appendLedger, eq, refundTotals, sessions, sql, storeOrders } from "@keel/db";
import type { PayPalClient } from "@keel/paypal";
import type { GatewayDeps } from "./handle";

// Namespace for per-order advisory locks, distinct from the ledger's lock key.
const ORDER_LOCK_NAMESPACE = 4_242_002;

export function createGatewayDeps(db: Db, paypal: PayPalClient): GatewayDeps {
  return {
    getOrderDetails: (orderId) => paypal.getOrderDetails(orderId),
    refundCapture: (captureId, amount, requestId) => paypal.refundCapture(captureId, amount, requestId),
    store: async (orderId) => {
      const [row] = await db.select().from(storeOrders).where(eq(storeOrders.orderId, orderId));
      return row ?? null;
    },
    refundTotals: (sessionId, now) => refundTotals(db, sessionId, now),
    policy: (policyId) => activePolicy(db, policyId),
    appendLedger: (content) => appendLedger(db, content),
    escalate: async (sessionId) => {
      await db.update(sessions).set({ state: "ESCALATED" }).where(eq(sessions.id, sessionId));
    },
    // Serializes money decisions per order across API instances, so two
    // concurrent refunds can't both see the same refunded-to-date total.
    withOrderLock: (orderId, fn) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ORDER_LOCK_NAMESPACE}, hashtext(${orderId}))`);
        return fn();
      }),
    now: () => new Date(),
    newId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
  };
}
