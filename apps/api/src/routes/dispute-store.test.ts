import { randomUUID } from "node:crypto";
import { appendLedger, createDb, disputes, eq, ledgerEntries, sessions, settings, sql, storeOrders } from "@keel/db";
import type { Dispute } from "@keel/paypal/disputes";
import type { Classified, LedgerEntry } from "@keel/worker/dispute";
import { afterAll, describe, expect, it } from "vitest";
import { createDisputeStore } from "./dispute-store";

const rid = () => randomUUID().replaceAll("-", "");

describe.skipIf(!process.env.DATABASE_URL)("dispute store (Postgres)", () => {
  const db = createDb();
  const store = createDisputeStore(db);
  const now = new Date();
  const prefix = `PP-T-${rid().slice(0, 8)}`;

  // Test rows would otherwise be polled against PayPal as open disputes.
  afterAll(async () => {
    await db.delete(disputes).where(sql`${disputes.id} like ${`${prefix}%`}`);
  });

  const paypalDispute = (captureId: string): Dispute => ({
    dispute_id: `${prefix}-${rid().slice(0, 16)}`,
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "OPEN",
    dispute_amount: { currency_code: "USD", value: "35.00" },
    disputed_transactions: [{ seller_transaction_id: captureId }],
    messages: [{ posted_by: "BUYER", content: "x".repeat(5000) }],
  });

  async function orderWithHistory() {
    const orderId = `T-${rid()}`;
    const captureId = `CAP-${orderId}`;
    await db.insert(storeOrders).values({
      orderId, captureId, scenario: `test-${rid()}`, payerEmail: "maya@demo.keel.test", currency: "USD", total: "35.00",
      items: [{ sku: "s", title: "Mug", price: "35.00" }], deliveredAt: new Date(now.getTime() - 45 * 86_400_000),
    });
    const sessionId = `ses_${rid()}`;
    await db.insert(sessions).values({
      id: sessionId, agentId: "demo", claimedEmail: "maya@demo.keel.test", orderIds: [orderId], otpHash: "h",
      otpExpiresAt: now, expiresAt: new Date(now.getTime() + 3600_000),
    });
    const refund = `dec_${rid()}`;
    const guard = `dec_${rid()}`;
    await appendLedger(db, { decision_id: refund, session_id: sessionId, order_id: orderId, capture_id: captureId, dispute_id: null, mode: "LIVE", verdict: "BLOCK", reason_codes: ["OUTSIDE_WINDOW"], payload: { tool: "offer_refund", args: { order_id: orderId, amount: "35.00", policy_id: "refund-standard" } } });
    await appendLedger(db, { decision_id: guard, session_id: sessionId, order_id: null, capture_id: null, dispute_id: null, mode: "LIVE", verdict: "ALLOW", reason_codes: ["OK"], payload: { tool: "guard" } });
    return { orderId, captureId, sessionId, refund, guard };
  }

  const classified = (decisionId: string): Classified => ({
    classification: "DEFEND", reason_codes: ["DISPUTE_WITHIN_POLICY"], injection: "none", decision_id: decisionId, order_id: null,
    evidence_type: "OTHER", evidence_notes: "notes", evidence_pdf: new TextEncoder().encode("%PDF-1.4"), evidence_sha256: "abc",
  });
  const entry = (d: Dispute, decisionId: string): LedgerEntry => ({
    decision_id: decisionId, session_id: null, order_id: null, capture_id: d.disputed_transactions[0]!.seller_transaction_id!, dispute_id: d.dispute_id,
    mode: "LIVE", verdict: "BLOCK", reason_codes: ["DISPUTE_WITHIN_POLICY"], payload: { tool: "dispute", matched_rows: [] },
  });

  it("upserts PayPal's view, capping buyer messages", async () => {
    const d = paypalDispute(`CAP-${rid()}`);
    const first = await store.upsert(d, "OPEN", now);
    expect(first).toMatchObject({ id: d.dispute_id, classification: null, action: null, outcome: "OPEN" });
    await store.upsert({ ...d, status: "RESOLVED" }, "WON", now);
    const detail = await store.detail(d.dispute_id);
    expect(detail).toMatchObject({ status: "RESOLVED", outcome: "WON" });
    expect(detail?.buyer_messages[0]).toHaveLength(1000);
  });

  it("finds the order, the live session's ledger rows and its turns", async () => {
    const h = await orderWithHistory();
    const ctx = await store.context(h.captureId);
    expect(ctx.order).toMatchObject({ order_id: h.orderId, total: "35.00" });
    expect(ctx.rows.map((r) => r.decision_id)).toEqual([h.refund, h.guard]);
  });

  it("classifies once and appends the ledger row in the same transaction", async () => {
    const d = paypalDispute(`CAP-${rid()}`);
    await store.upsert(d, "OPEN", now);
    const a = `dec_${rid()}`;
    const b = `dec_${rid()}`;
    expect(await store.classify(d.dispute_id, classified(a), entry(d, a), now)).toBe(true);
    expect(await store.classify(d.dispute_id, classified(b), entry(d, b), now)).toBe(false);
    const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.disputeId, d.dispute_id));
    expect(rows.map((r) => r.decisionId)).toEqual([a]);
    expect(await store.pdf(d.dispute_id)).toEqual(new TextEncoder().encode("%PDF-1.4"));
  });

  it("moves the action only from the expected states", async () => {
    const d = paypalDispute(`CAP-${rid()}`);
    await store.upsert(d, "OPEN", now);
    expect(await store.setAction(d.dispute_id, [null], "SUBMITTING", null, now)).toBe(true);
    expect(await store.setAction(d.dispute_id, [null, "WAITING_ON_PAYPAL"], "SUBMITTING", null, now)).toBe(false);
    expect(await store.setAction(d.dispute_id, ["SUBMITTING"], "FAILED", "400 X", now)).toBe(true);
    expect((await store.detail(d.dispute_id))).toMatchObject({ action: "FAILED", action_error: "400 X" });
    expect(await store.openIds()).toContain(d.dispute_id);
  });

  it("records when a poll last reached PayPal", async () => {
    const before = await store.lastSyncedAt();
    const at = new Date("2026-10-28T09:00:00.000Z");
    try {
      await store.markSynced(at);
      expect(await store.lastSyncedAt()).toBe(at.toISOString());
    } finally {
      // Leave the real "synced" time as it was.
      if (before) await store.markSynced(new Date(before));
      else await db.delete(settings).where(eq(settings.key, "disputes_last_synced_at"));
    }
  });
});
