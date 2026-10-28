import { randomUUID } from "node:crypto";
import type { LedgerContent } from "@keel/engine";
import { toCents } from "@keel/engine";
import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { appendLedger, type DbOrTx } from "./ledger";
import { decisionsByDay, disputeOutcomes, dollarsProtected, liveSessions, violations } from "./overview";
import { disputes, sessions } from "./schema";

const row = (over: Partial<LedgerContent>): LedgerContent => ({
  decision_id: `dec_ovw_${randomUUID()}`,
  session_id: null,
  order_id: null,
  capture_id: null,
  dispute_id: null,
  mode: "LIVE",
  verdict: "ALLOW",
  reason_codes: ["OK"],
  payload: { tool: "get_order" },
  ...over,
});

const refund = (verdict: LedgerContent["verdict"], amount: string, over: Partial<LedgerContent> = {}) =>
  row({ verdict, reason_codes: ["OUTSIDE_WINDOW"], payload: { tool: "offer_refund", args: { amount } }, ...over });

// Every write happens in a transaction that is rolled back: the shared dev DB keeps no test rows.
const ROLLBACK = new Error("rollback");
async function scoped(fn: (tx: DbOrTx) => Promise<void>) {
  const db = createDb();
  await expect(
    db.transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    }),
  ).rejects.toBe(ROLLBACK);
}

const minus = (a: string, b: string) => toCents(a) - toCents(b);
const since = () => new Date(Date.now() - 60 * 60_000);

describe.skipIf(!process.env.DATABASE_URL)("overview metrics (Postgres)", () => {
  it("counts violations by reason code, without dispute, review, kill-switch or CONTEXT rows", async () => {
    await scoped(async (tx) => {
      const code = `TEST_${randomUUID()}` as never;
      const before = await violations(tx, since());
      await appendLedger(tx, row({ verdict: "BLOCK", reason_codes: [code], payload: { tool: "offer_refund" } }));
      await appendLedger(tx, row({ verdict: "HOLD", reason_codes: [code], payload: { tool: "risk" } }));
      await appendLedger(tx, row({ verdict: "REWRITE", reason_codes: [code, "POLICY_NOT_FOUND"], payload: { tool: "guard" } }));
      await appendLedger(tx, row({ verdict: "ALLOW", reason_codes: [code] }));
      for (const tool of ["dispute", "dispute_action", "review", "kill_switch"]) {
        await appendLedger(tx, row({ verdict: "BLOCK", reason_codes: [code], payload: { tool } }));
      }
      await appendLedger(tx, row({ verdict: "BLOCK", reason_codes: [code], mode: "CONTEXT" }));
      const after = await violations(tx, since());
      expect(after.total - before.total).toBe(3);
      expect(after.byReason.find((r) => r.code === code)?.count).toBe(3);
      // A future `since` leaves everything out.
      expect((await violations(tx, new Date(Date.now() + 60 * 60_000))).total).toBe(0);
    });
  });

  it("sums dollars protected: blocked refunds, denied holds and won disputes", async () => {
    await scoped(async (tx) => {
      const before = await dollarsProtected(tx, since());
      await appendLedger(tx, refund("BLOCK", "100.10"));
      await appendLedger(tx, refund("BLOCK", "0.20"));
      await appendLedger(tx, refund("BLOCK", "50.00", { mode: "CONTEXT" }));
      await appendLedger(tx, refund("BLOCK", "not money"));
      await appendLedger(tx, refund("ALLOW", "30.00"));
      const denied = refund("HOLD", "45.05");
      const approved = refund("HOLD", "20.00");
      const pending = refund("HOLD", "7.00");
      for (const r of [denied, approved, pending]) await appendLedger(tx, r);
      await appendLedger(tx, row({ verdict: "BLOCK", payload: { tool: "review", ref: denied.decision_id, action: "deny", resolved: true } }));
      await appendLedger(tx, row({ verdict: "ALLOW", payload: { tool: "review", ref: approved.decision_id, action: "approve", resolved: true } }));
      const id = `DISP-OVW-${randomUUID()}`;
      const dispute = { reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status: "RESOLVED", currency: "USD", paypal: {} };
      await tx.insert(disputes).values([
        { ...dispute, id: `${id}-1`, amount: "155.00", outcome: "WON" },
        { ...dispute, id: `${id}-2`, amount: "9.99", outcome: "LOST" },
      ]);
      const after = await dollarsProtected(tx, since());
      expect(minus(after.blocked_refunds, before.blocked_refunds)).toBe(10030);
      expect(minus(after.denied_holds, before.denied_holds)).toBe(4505);
      expect(minus(after.disputes_won, before.disputes_won)).toBe(15500);
      expect(minus(after.total, before.total)).toBe(10030 + 4505 + 15500);
      expect(after.total).toMatch(/^\d+\.\d{2}$/);
    });
  });

  it("counts decisions per UTC day, zero-filled", async () => {
    await scoped(async (tx) => {
      const before = await decisionsByDay(tx, 3);
      expect(before).toHaveLength(3);
      expect(before.at(-1)!.day).toBe(new Date().toISOString().slice(0, 10));
      await appendLedger(tx, row({ verdict: "ALLOW" }));
      await appendLedger(tx, row({ verdict: "REWRITE" }));
      await appendLedger(tx, row({ verdict: "HOLD", mode: "CONTEXT" }));
      const after = await decisionsByDay(tx, 3);
      const [b, a] = [before.at(-1)!, after.at(-1)!];
      expect([a.ALLOW - b.ALLOW, a.REWRITE - b.REWRITE, a.BLOCK - b.BLOCK, a.HOLD - b.HOLD]).toEqual([1, 1, 0, 0]);
    });
  });

  it("counts dispute outcomes with the amounts won and conceded", async () => {
    await scoped(async (tx) => {
      const before = await disputeOutcomes(tx);
      const id = `DISP-OVW-${randomUUID()}`;
      const dispute = { reason: "UNAUTHORISED", status: "OPEN", currency: "USD", paypal: {} };
      await tx.insert(disputes).values([
        { ...dispute, id: `${id}-1`, amount: "10.00", outcome: "WON" },
        { ...dispute, id: `${id}-2`, amount: "2.50", outcome: "CONCEDED" },
        { ...dispute, id: `${id}-3`, amount: "1.25", outcome: "CONCEDED" },
        { ...dispute, id: `${id}-4`, amount: "4.00" },
      ]);
      const after = await disputeOutcomes(tx);
      expect([after.WON - before.WON, after.CONCEDED - before.CONCEDED, after.OPEN - before.OPEN, after.LOST - before.LOST]).toEqual([1, 2, 1, 0]);
      expect(minus(after.amount_won, before.amount_won)).toBe(1000);
      expect(minus(after.amount_conceded, before.amount_conceded)).toBe(375);
    });
  });

  it("counts live sessions that are active and quarantined", async () => {
    await scoped(async (tx) => {
      const before = await liveSessions(tx);
      const session = (state: string, over: Partial<typeof sessions.$inferInsert> = {}) => ({
        id: `ses_ovw_${randomUUID()}`,
        agentId: "agent_test",
        claimedEmail: "t@example.test",
        orderIds: [],
        otpHash: "x",
        otpExpiresAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        state,
        ...over,
      });
      await tx.insert(sessions).values([
        session("ACTIVE"),
        session("ESCALATED"),
        session("QUARANTINED"),
        session("ACTIVE", { mode: "CONTEXT" }),
        session("QUARANTINED", { expiresAt: new Date(Date.now() - 1000) }),
      ]);
      const after = await liveSessions(tx);
      expect(after.active - before.active).toBe(2);
      expect(after.quarantined - before.quarantined).toBe(1);
    });
  });
});
