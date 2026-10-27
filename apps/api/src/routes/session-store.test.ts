import { randomUUID } from "node:crypto";
import { appendLedger, createDb, sessions } from "@keel/db";
import type { LedgerContent } from "@keel/engine";
import { describe, expect, it } from "vitest";
import { createTurnStore } from "./session-store";

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
    expect((await store.decisions(id)).map((d) => d.tool)).toEqual(["get_order", "offer_refund"]);
    expect(await store.customerTurnCount(id)).toBe(1);
  });
});
