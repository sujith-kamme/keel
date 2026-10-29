import { type Db, activePolicy, agentControls, and, appendLedger, eq, inArray, refundTotals, sessions, sql, storeOrders } from "@keel/db";
import type { PayPalClient } from "@keel/paypal";
import { newId } from "../id";
import type { RiskService } from "../risk";
import type { GatewayDeps } from "./handle";

// Namespaces for per-order and per-session advisory locks, distinct from the ledger's lock key.
const ORDER_LOCK_NAMESPACE = 4_242_002;
const SESSION_LOCK_NAMESPACE = 4_242_003;

export function createGatewayDeps(db: Db, paypal: PayPalClient, risk: RiskService, notifyHeld: GatewayDeps["notifyHeld"]): GatewayDeps {
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
    handoff: (sessionId, to) =>
      db.transaction(async (tx) => {
        const controls = await tx.select({ frozen: agentControls.frozen }).from(agentControls).where(inArray(agentControls.agentId, [to, "*"]));
        if (controls.some((c) => c.frozen)) return "FROZEN" as const;
        // Only the policy agent hands off, so a stale policy token can't switch the session back.
        const moved = await tx.update(sessions).set({ agentId: to }).where(and(eq(sessions.id, sessionId), eq(sessions.agentId, "agt_policy"))).returning({ id: sessions.id });
        return moved.length === 0 ? ("NOT_POLICY_AGENT" as const) : ("OK" as const);
      }),
    // Serializes money decisions per session and per order across API instances,
    // so two concurrent refunds can't both see the same refunded-to-date or budget
    // totals. Always session then order, so two lockers can't deadlock.
    withOrderLock: (sessionId, orderId, fn) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${SESSION_LOCK_NAMESPACE}, hashtext(${sessionId}))`);
        await tx.execute(sql`select pg_advisory_xact_lock(${ORDER_LOCK_NAMESPACE}, hashtext(${orderId}))`);
        return fn();
      }),
    control: (sessionId) => risk.control(sessionId),
    assess: (sessionId) => risk.assess(sessionId),
    notifyHeld,
    now: () => new Date(),
    newId,
  };
}
