import { randomUUID } from "node:crypto";
import { appendLedger, createDb, sessions } from "@keel/db";
import type { LedgerContent } from "@keel/engine";
import { describe, expect, it } from "vitest";
import { createTurnDecisions, createTurnStore } from "./session-store";

const SUMMARY_KEYS = ["agent_id", "claimed_email", "created_at", "expires_at", "id", "state", "verified"];

describe.skipIf(!process.env.DATABASE_URL)("turn store (Postgres)", () => {
  const db = createDb();
  const store = createTurnStore(db);

  it("reads sessions, turns and decisions for one session", async () => {
    const id = `ses_test_${randomUUID().replaceAll("-", "")}`;
    await db.insert(sessions).values({
      id,
      agentId: "demo",
      claimedEmail: "maya@demo.keel.test",
      orderIds: [],
      otpHash: "hash",
      otpExpiresAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await store.appendTurn({ sessionId: id, role: "customer", text: "refund please", decisionIds: [] });
    await store.appendTurn({ sessionId: id, role: "agent", text: "on it", decisionIds: ["dec_a"] });

    const ledger = (tool: string): LedgerContent => ({
      decision_id: `dec_${randomUUID().replaceAll("-", "")}`,
      session_id: id,
      order_id: "O-TEST",
      capture_id: null,
      dispute_id: null,
      mode: "CONTEXT",
      verdict: "ALLOW",
      reason_codes: ["OK"],
      payload: { tool },
    });
    await appendLedger(db, ledger("get_order"));
    await appendLedger(db, ledger("offer_refund"));
    await appendLedger(db, {
      ...ledger("guard"),
      payload: {
        tool: "guard",
        input: { draft: "I refunded you", extraction: { reply_commitments: [{ type: "refund", quoted_text: "I refunded you", extra: 1 }] } },
        result: { verdict: "BLOCK", reason_codes: ["X"], final_reply: "Sorry" },
        extractor: { model: "m", prompt_version: "v", latency_ms: 42 },
      },
    });
    await appendLedger(db, { ...ledger("guard"), payload: { tool: "guard", input: { draft: "hi", extraction: null }, result: { final_reply: "hi" } } });

    const session = await store.session(id);
    expect(Object.keys(session!).sort()).toEqual(SUMMARY_KEYS);
    expect(session!.verified).toBe(false);
    const listed = (await store.listSessions(100)).find((s) => s.id === id);
    expect(Object.keys(listed!).sort()).toEqual(SUMMARY_KEYS);

    const turns = await store.turns(id);
    expect(turns.map((t) => [t.role, t.decision_ids])).toEqual([
      ["customer", []],
      ["agent", ["dec_a"]],
    ]);
    const decisions = await store.decisions(id);
    expect(decisions.map((d) => d.tool)).toEqual(["get_order", "offer_refund", "guard", "guard"]);
    expect("guard" in decisions[0]!).toBe(false);
    expect("guard" in decisions[1]!).toBe(false);
    expect(decisions[2]!.guard).toEqual({
      draft: "I refunded you",
      final_reply: "Sorry",
      commitments: [{ type: "refund", quoted_text: "I refunded you" }],
      latency_ms: 42,
    });
    expect(decisions[3]!.guard).toEqual({ draft: "hi", final_reply: "hi", commitments: [], latency_ms: null });
    expect(await store.customerTurnCount(id)).toBe(1);
  });

  it("turnDecisions returns only rows from the asked session", async () => {
    const mk = async (sid: string, tool: string, verdict: "ALLOW" | "BLOCK", args: unknown, message?: string) => {
      const decision_id = `dec_${randomUUID().replaceAll("-", "")}`;
      await appendLedger(db, { decision_id, session_id: sid, order_id: null, capture_id: null, dispute_id: null, mode: "LIVE", verdict, reason_codes: ["OK"], payload: { tool, args, message } });
      return decision_id;
    };
    const a = `ses_test_${randomUUID().replaceAll("-", "")}`;
    const b = `ses_test_${randomUUID().replaceAll("-", "")}`;
    const ids = [
      await mk(a, "offer_refund", "ALLOW", { amount: "5.00" }),
      await mk(a, "offer_discount", "BLOCK", undefined, "I can't offer a discount that large."),
      await mk(b, "offer_refund", "ALLOW", {}),
    ];
    const rows = await createTurnDecisions(db)(a, ids);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      { tool: "offer_refund", verdict: "ALLOW", args: { amount: "5.00" } },
      { tool: "offer_discount", verdict: "BLOCK", args: {}, message: "I can't offer a discount that large." },
    ]));
    expect(await createTurnDecisions(db)(a, [])).toEqual([]);
  });
});
