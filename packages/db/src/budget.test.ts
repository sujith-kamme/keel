import { randomUUID } from "node:crypto";
import { toCents } from "@keel/engine";
import { describe, expect, it } from "vitest";
import { refundTotals } from "./budget";
import { createDb } from "./client";
import { appendLedger } from "./ledger";

const refund = (sessionId: string, amount: string, status: string) => ({
  decision_id: `dec_${randomUUID()}`,
  session_id: sessionId,
  order_id: "O-TEST",
  capture_id: null,
  dispute_id: null,
  mode: "CONTEXT" as const,
  verdict: "ALLOW" as const,
  reason_codes: ["OK" as const],
  payload: { tool: "offer_refund", execution: { status, amount } },
});

describe.skipIf(!process.env.DATABASE_URL)("refundTotals (Postgres)", () => {
  const db = createDb();

  it("sums executed refunds per session and over the last 24 hours", async () => {
    const sessionId = `ses_${randomUUID()}`;
    const before = await refundTotals(db, sessionId, new Date());
    await appendLedger(db, refund(sessionId, "10.50", "COMPLETED"));
    await appendLedger(db, refund(sessionId, "4.25", "PENDING"));
    await appendLedger(db, refund(sessionId, "99.00", "FAILED"));
    await appendLedger(db, { ...refund(sessionId, "7.00", "COMPLETED"), payload: { tool: "get_order" } });
    await appendLedger(db, refund(`ses_${randomUUID()}`, "1.00", "COMPLETED"));

    const after = await refundTotals(db, sessionId, new Date());
    expect(before.session_refunded).toBe("0.00");
    expect(after.session_refunded).toBe("14.75");
    expect(toCents(after.daily_refunded) - toCents(before.daily_refunded)).toBe(1575);
  });

  it("excludes refunds older than 24 hours from the daily total", async () => {
    const sessionId = `ses_${randomUUID()}`;
    await appendLedger(db, refund(sessionId, "5.00", "COMPLETED"));
    const later = await refundTotals(db, sessionId, new Date(Date.now() + 2 * 86_400_000));
    expect(later.session_refunded).toBe("5.00");
    expect(later.daily_refunded).toBe("0.00");
  });
});
