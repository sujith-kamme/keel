import { randomInt, randomUUID } from "node:crypto";
import type { LedgerContent } from "@keel/engine";
import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import type { DbOrTx } from "./ledger";
import { decisionsByDay, disputeOutcomes, dollarsProtected, liveSessions, violations } from "./overview";
import { disputes, ledgerEntries, sessions } from "./schema";

const DAY_MS = 86_400_000;
// One far-past UTC day per run: other test files write live rows "now", never here.
const SINCE = new Date(Date.UTC(1999, 0, 1) + randomInt(0, 7 * 365) * DAY_MS);
const UNTIL = new Date(SINCE.getTime() + DAY_MS);
const AT = new Date(SINCE.getTime() + 12 * 3_600_000);
const WINDOW = { since: SINCE, until: UNTIL };

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

/** Inserts straight into the ledger with a back-dated created_at; the chain doesn't matter in a rolled-back transaction. */
const put = (tx: DbOrTx, c: LedgerContent, createdAt = AT) =>
  tx.insert(ledgerEntries).values({
    decisionId: c.decision_id,
    sessionId: c.session_id,
    orderId: c.order_id,
    captureId: c.capture_id,
    disputeId: c.dispute_id,
    mode: c.mode,
    verdict: c.verdict,
    reasonCodes: c.reason_codes,
    payload: c.payload,
    prevHash: null,
    hash: "test",
    createdAt,
  });

const dispute = (outcome: string, amount: string, updatedAt = AT) => ({
  id: `DISP-OVW-${randomUUID()}`,
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  status: "RESOLVED",
  currency: "USD",
  paypal: {},
  amount,
  outcome,
  createdAt: updatedAt,
  updatedAt,
});

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

describe.skipIf(!process.env.DATABASE_URL)("overview metrics (Postgres)", () => {
  it("counts violations by reason code, without dispute, review, kill-switch or CONTEXT rows", async () => {
    await scoped(async (tx) => {
      await put(tx, row({ verdict: "BLOCK", reason_codes: ["OUTSIDE_WINDOW"], payload: { tool: "offer_refund" } }));
      await put(tx, row({ verdict: "HOLD", reason_codes: ["RISK_THRESHOLD"], payload: { tool: "risk" } }));
      await put(tx, row({ verdict: "REWRITE", reason_codes: ["RISK_THRESHOLD", "POLICY_NOT_FOUND"], payload: { tool: "guard" } }));
      await put(tx, row({ verdict: "ALLOW", reason_codes: ["OK"] }));
      for (const tool of ["dispute", "dispute_action", "review", "kill_switch"]) {
        await put(tx, row({ verdict: "BLOCK", reason_codes: ["OK"], payload: { tool } }));
      }
      await put(tx, row({ verdict: "BLOCK", reason_codes: ["OK"], mode: "CONTEXT" }));
      await put(tx, row({ verdict: "BLOCK", reason_codes: ["OK"] }), UNTIL);
      expect(await violations(tx, WINDOW)).toEqual({
        total: 3,
        byReason: [
          { code: "RISK_THRESHOLD", count: 2 },
          { code: "OUTSIDE_WINDOW", count: 1 },
          { code: "POLICY_NOT_FOUND", count: 1 },
        ],
      });
    });
  });

  it("sums dollars protected: blocked refunds, denied holds and won disputes", async () => {
    await scoped(async (tx) => {
      await put(tx, refund("BLOCK", "100.10"));
      await put(tx, refund("BLOCK", "0.20"));
      await put(tx, refund("BLOCK", "50.00", { mode: "CONTEXT" }));
      await put(tx, refund("BLOCK", "not money"));
      await put(tx, refund("ALLOW", "30.00"));
      await put(tx, refund("BLOCK", "70.00"), UNTIL);
      const denied = refund("HOLD", "45.05");
      const approved = refund("HOLD", "20.00");
      const pending = refund("HOLD", "7.00");
      for (const r of [denied, approved, pending]) await put(tx, r);
      await put(tx, row({ verdict: "BLOCK", payload: { tool: "review", ref: denied.decision_id, action: "deny", resolved: true } }));
      await put(tx, row({ verdict: "ALLOW", payload: { tool: "review", ref: approved.decision_id, action: "approve", resolved: true } }));
      await tx.insert(disputes).values([dispute("WON", "155.00"), dispute("LOST", "9.99"), dispute("WON", "1.00", UNTIL)]);
      expect(await dollarsProtected(tx, WINDOW)).toEqual({
        blocked_refunds: "100.30",
        denied_holds: "45.05",
        disputes_won: "155.00",
        total: "300.35",
      });
    });
  });

  it("counts decisions per UTC day, zero-filled", async () => {
    await scoped(async (tx) => {
      await put(tx, row({ verdict: "ALLOW" }));
      await put(tx, row({ verdict: "REWRITE" }));
      await put(tx, row({ verdict: "BLOCK" }), new Date(AT.getTime() - 2 * DAY_MS));
      await put(tx, row({ verdict: "HOLD", mode: "CONTEXT" }));
      const day = (d: number) => new Date(SINCE.getTime() + d * DAY_MS).toISOString().slice(0, 10);
      expect(await decisionsByDay(tx, 3, AT)).toEqual([
        { day: day(-2), ALLOW: 0, REWRITE: 0, BLOCK: 1, HOLD: 0 },
        { day: day(-1), ALLOW: 0, REWRITE: 0, BLOCK: 0, HOLD: 0 },
        { day: day(0), ALLOW: 1, REWRITE: 1, BLOCK: 0, HOLD: 0 },
      ]);
    });
  });

  it("counts dispute outcomes with the amounts won and conceded", async () => {
    await scoped(async (tx) => {
      await tx.insert(disputes).values([
        dispute("WON", "10.00"),
        dispute("CONCEDED", "2.50"),
        dispute("CONCEDED", "1.25"),
        dispute("OPEN", "4.00"),
        dispute("LOST", "3.00", UNTIL),
      ]);
      expect(await disputeOutcomes(tx, WINDOW)).toEqual({ OPEN: 1, WON: 1, LOST: 0, CONCEDED: 2, amount_won: "10.00", amount_conceded: "3.75" });
    });
  });

  it("counts live sessions that are active and quarantined", async () => {
    await scoped(async (tx) => {
      // Checked at a far-future instant no other test's session lives to.
      const now = new Date(Date.UTC(2990, 0, 1));
      const session = (state: string, over: Partial<typeof sessions.$inferInsert> = {}) => ({
        id: `ses_ovw_${randomUUID()}`,
        agentId: "agent_test",
        claimedEmail: "t@example.test",
        orderIds: [],
        otpHash: "x",
        otpExpiresAt: now,
        expiresAt: new Date(Date.UTC(2991, 0, 1)),
        state,
        ...over,
      });
      await tx.insert(sessions).values([
        session("ACTIVE"),
        session("ESCALATED"),
        session("QUARANTINED"),
        session("ACTIVE", { mode: "CONTEXT" }),
        session("QUARANTINED", { expiresAt: new Date(Date.UTC(2989, 0, 1)) }),
      ]);
      expect(await liveSessions(tx, now)).toEqual({ active: 2, quarantined: 1 });
    });
  });
});
