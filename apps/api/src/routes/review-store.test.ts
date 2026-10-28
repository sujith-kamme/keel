import { randomUUID } from "node:crypto";
import { appendLedger, createDb, eq, ledgerEntries, sessions } from "@keel/db";
import type { LedgerContent } from "@keel/engine";
import { describe, expect, it } from "vitest";
import { createReviewStore } from "./review-store";

const rid = () => randomUUID().replaceAll("-", "");

describe.skipIf(!process.env.DATABASE_URL)("review store (Postgres)", () => {
  const db = createDb();
  const store = createReviewStore(db);

  async function session(state: string) {
    const id = `ses_test_${rid()}`;
    await db.insert(sessions).values({
      id,
      agentId: "demo",
      claimedEmail: "maya@demo.keel.test",
      orderIds: ["O-1"],
      verifiedPayer: "maya@demo.keel.test",
      otpHash: "hash",
      otpExpiresAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 60_000),
      state,
    });
    return id;
  }
  const row = (sessionId: string, tool: string, verdict: LedgerContent["verdict"], reason: LedgerContent["reason_codes"], payload: Record<string, unknown> = {}): LedgerContent => ({
    decision_id: `dec_${rid()}`,
    session_id: sessionId,
    order_id: "O-1",
    capture_id: null,
    dispute_id: null,
    mode: "LIVE",
    verdict,
    reason_codes: reason,
    payload: { tool, ...payload },
  });
  const review = (sessionId: string, ref: string, resolved: boolean) => row(sessionId, "review", "BLOCK", ["RISK_THRESHOLD"], { action: "deny", ref, resolved });

  it("lists held money actions until a resolved review row references them", async () => {
    const sid = await session("QUARANTINED");
    const args = { order_id: "O-1", amount: "42.00", reason: "damaged", policy_id: "refund-standard" };
    const a = row(sid, "offer_refund", "HOLD", ["RISK_THRESHOLD"], { args });
    const b = row(sid, "offer_discount", "HOLD", ["AGENT_FROZEN"], { args: { percent: 5, policy_id: "discount-goodwill" } });
    const c = row(sid, "offer_refund", "HOLD", ["ABOVE_AUTO_APPROVE"], { args });
    for (const r of [a, b, c, row(sid, "offer_refund", "ALLOW", ["OK"], { args }), row(sid, "guard", "HOLD", ["RISK_THRESHOLD"])]) await appendLedger(db, r);
    await appendLedger(db, review(sid, a.decision_id, true));
    await appendLedger(db, review(sid, b.decision_id, false));

    const mine = (await store.pendingHeld(1000)).filter((h) => h.session_id === sid);
    expect(mine.map((h) => h.decision_id)).toEqual([c.decision_id, b.decision_id]);
    expect(mine[0]).toMatchObject({ tool: "offer_refund", args, reason_codes: ["ABOVE_AUTO_APPROVE"], session_state: "QUARANTINED", verdict: "HOLD" });

    expect(await store.isResolved(a.decision_id)).toBe(true);
    expect(await store.isResolved(b.decision_id)).toBe(false);
    expect(await store.entry(c.decision_id)).toMatchObject({ decision_id: c.decision_id, tool: "offer_refund", session_id: sid, order_id: "O-1" });
    expect(await store.entry(`dec_${rid()}`)).toBeNull();
  });

  it("reports an unconfirmed payment from the held row or a failed approve attempt", async () => {
    const sid = await session("QUARANTINED");
    const plain = row(sid, "offer_refund", "HOLD", ["RISK_THRESHOLD"], { args: {} });
    const failedHold = row(sid, "offer_refund", "HOLD", ["VERIFIER_UNAVAILABLE"], { args: {}, execution: { status: "FAILED", amount: "5.00" } });
    const failedApprove = row(sid, "offer_refund", "HOLD", ["RISK_THRESHOLD"], { args: {} });
    for (const r of [plain, failedHold, failedApprove]) await appendLedger(db, r);
    await appendLedger(db, row(sid, "review", "HOLD", ["VERIFIER_UNAVAILABLE"], { action: "approve", ref: failedApprove.decision_id, resolved: false, execution: { status: "FAILED" } }));
    await appendLedger(db, row(sid, "review", "HOLD", ["VERIFIER_UNAVAILABLE"], { action: "approve", ref: plain.decision_id, resolved: false }));
    expect(await store.paymentUnconfirmed(plain.decision_id)).toBe(false);
    expect(await store.paymentUnconfirmed(failedHold.decision_id)).toBe(true);
    expect(await store.paymentUnconfirmed(failedApprove.decision_id)).toBe(true);
  });

  it("lists flagged sessions without pending holds, with the latest risk reasons", async () => {
    const quiet = await session("ESCALATED");
    const risky = await session("QUARANTINED");
    const pending = await session("QUARANTINED");
    const active = await session("ACTIVE");
    await appendLedger(db, row(risky, "risk", "HOLD", ["RISK_THRESHOLD"], { score: 70 }));
    const h = row(risky, "offer_refund", "HOLD", ["RISK_THRESHOLD"], { args: {} });
    await appendLedger(db, h);
    await appendLedger(db, review(risky, h.decision_id, true));
    await appendLedger(db, row(pending, "offer_refund", "HOLD", ["RISK_THRESHOLD"], { args: {} }));

    const flagged = await store.flaggedSessions(1000);
    const ids = flagged.map((s) => s.session_id);
    expect(ids).toContain(quiet);
    expect(ids).toContain(risky);
    expect(ids).not.toContain(pending);
    expect(ids).not.toContain(active);
    expect(flagged.find((s) => s.session_id === risky)).toMatchObject({ session_state: "QUARANTINED", reason_codes: ["RISK_THRESHOLD"] });
    expect(flagged.find((s) => s.session_id === quiet)!.reason_codes).toEqual([]);
  });

  it("releases a session and appends the release row together", async () => {
    const sid = await session("QUARANTINED");
    const content = row(sid, "release", "ALLOW", ["OK"], { reviewer: "ops" });
    expect(await store.release(sid, content)).toBe("released");
    const [s] = await db.select().from(sessions).where(eq(sessions.id, sid));
    expect(s!.state).toBe("ACTIVE");
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.decisionId, content.decision_id))).toHaveLength(1);
    expect(await store.release(`ses_test_${rid()}`, row(sid, "release", "ALLOW", ["OK"]))).toBe("not_found");
    const again = row(sid, "release", "ALLOW", ["OK"]);
    expect(await store.release(sid, again)).toBe("not_flagged");
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.decisionId, again.decision_id))).toHaveLength(0);
    expect(await store.session(sid)).toEqual({ id: sid, agent_id: "demo", verified_payer: "maya@demo.keel.test", order_ids: ["O-1"] });
  });
});
