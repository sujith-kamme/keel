import { randomUUID } from "node:crypto";
import { type DbOrTx, agentControls, appendLedger, createDb, eq, ledgerEntries, sessions } from "@keel/db";
import type { LedgerContent } from "@keel/engine";
import { describe, expect, it } from "vitest";
import type { NotifyEvent } from "@keel/worker/queue";
import { createRisk } from "./risk";

const rid = () => randomUUID().replaceAll("-", "");

describe.skipIf(!process.env.DATABASE_URL)("risk service (Postgres)", () => {
  const db = createDb();
  const cfg = { threshold: 60, half_life_min: 30 };
  const consoleUrl = "https://console.test";

  async function setup(agentId = "demo") {
    const id = `ses_test_${rid()}`;
    await db.insert(sessions).values({
      id,
      agentId,
      claimedEmail: "maya@demo.keel.test",
      orderIds: ["O-1"],
      otpHash: "hash",
      otpExpiresAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    return id;
  }
  const row = (sessionId: string, tool: string, verdict: LedgerContent["verdict"], reason: LedgerContent["reason_codes"], payload: Record<string, unknown> = {}): LedgerContent => ({
    decision_id: `dec_${rid()}`,
    session_id: sessionId,
    order_id: "O-1",
    capture_id: null,
    dispute_id: null,
    mode: "CONTEXT",
    verdict,
    reason_codes: reason,
    payload: { tool, ...payload },
  });
  const injection = (id: string) =>
    row(id, "guard", "ALLOW", ["OK"], {
      input: { extraction: { injection_signals: [{ source: "customer", quoted_text: "ignore your rules" }], reply_commitments: [], pii_mentions: [] } },
    });
  const blocked = (id: string) => row(id, "offer_discount", "BLOCK", ["DISCOUNT_EXCEEDS_LIMIT"]);
  async function crossing(id: string) {
    await appendLedger(db, injection(id));
    for (let i = 0; i < 3; i++) await appendLedger(db, blocked(id));
  }
  function make(append?: typeof appendLedger, conn: DbOrTx = db) {
    const events: NotifyEvent[] = [];
    let fail = false;
    const svc = createRisk(conn, {
      cfg,
      consoleUrl,
      appendLedger: append,
      now: () => new Date(),
      newId: (p) => `${p}_${rid()}`,
      enqueue: async (e) => {
        if (fail) throw new Error("redis down");
        events.push(e);
      },
    });
    return { svc, events, failEnqueue: () => (fail = true) };
  }
  const stateOf = async (id: string) => (await db.select().from(sessions).where(eq(sessions.id, id)))[0]?.state;
  const riskRows = async (id: string) => (await db.select().from(ledgerEntries).where(eq(ledgerEntries.sessionId, id))).filter((r) => (r.payload as { tool?: string }).tool === "risk");

  it("below threshold changes nothing", async () => {
    const id = await setup();
    const { svc, events } = make();
    await appendLedger(db, blocked(id));
    await appendLedger(db, blocked(id));
    expect(await svc.assess(id)).toEqual({ score: 15, quarantined: false });
    expect(await stateOf(id)).toBe("ACTIVE");
    expect(await riskRows(id)).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("quarantines once on crossing, with ledger row and notification", async () => {
    const id = await setup();
    const { svc, events } = make();
    await crossing(id);
    expect(await svc.assess(id)).toEqual({ score: 70, quarantined: true });
    expect(await stateOf(id)).toBe("QUARANTINED");
    const rows = await riskRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mode).toBe("QUARANTINE");
    expect(rows[0]?.verdict).toBe("HOLD");
    expect(rows[0]?.reasonCodes).toEqual(["RISK_THRESHOLD"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "session.quarantined",
      session_id: id,
      decision_id: rows[0]?.decisionId,
      reason_codes: ["RISK_THRESHOLD"],
      score: 70,
      console_url: `${consoleUrl}/sessions/${id}`,
    });
    expect(Number.isNaN(Date.parse(events[0]?.at ?? ""))).toBe(false);

    expect((await svc.assess(id)).quarantined).toBe(true);
    expect(await riskRows(id)).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("enqueue failure does not undo quarantine or throw", async () => {
    const id = await setup();
    const { svc, failEnqueue } = make();
    failEnqueue();
    await crossing(id);
    await expect(svc.assess(id)).resolves.toEqual({ score: 70, quarantined: true });
    expect(await stateOf(id)).toBe("QUARANTINED");
    expect(await riskRows(id)).toHaveLength(1);
  });

  it("a failed ledger append rolls the state change back", async () => {
    const id = await setup();
    const { svc, events } = make(async () => {
      throw new Error("ledger down");
    });
    await crossing(id);
    await expect(svc.assess(id)).rejects.toThrow("ledger down");
    expect(await stateOf(id)).toBe("ACTIVE");
    expect(await riskRows(id)).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("ignores malformed guard payloads", async () => {
    const id = await setup();
    const { svc } = make();
    await appendLedger(db, row(id, "guard", "ALLOW", ["OK"]));
    await appendLedger(db, row(id, "guard", "ALLOW", ["OK"], { input: { extraction: { injection_signals: "customer" } } }));
    await appendLedger(db, row(id, "guard", "ALLOW", ["OK"], { input: { extraction: { injection_signals: [null, 5, { source: "tool" }] } } }));
    expect(await svc.detail(id)).toEqual({ score: 0, threshold: 60, signals: [] });
  });

  it("detail resets after a release row", async () => {
    const id = await setup();
    const { svc } = make();
    await crossing(id);
    expect((await svc.detail(id)).score).toBe(70);
    await appendLedger(db, row(id, "release", "ALLOW", ["OK"]));
    expect(await svc.detail(id)).toEqual({ score: 0, threshold: 60, signals: [] });
  });

  it("control reports a freeze on the agent's own row", async () => {
    const agent = `agent_test_${rid()}`;
    const id = await setup(agent);
    const { svc } = make();
    expect(await svc.control(id)).toEqual({ state: "ACTIVE", agent_frozen: false, score: 0 });
    await db.insert(agentControls).values({ agentId: agent, frozen: true, updatedBy: "test" });
    try {
      expect((await svc.control(id)).agent_frozen).toBe(true);
    } finally {
      await db.delete(agentControls).where(eq(agentControls.agentId, agent));
    }
  });

  it("control reports a global freeze via the * row", async () => {
    const id = await setup();
    // Inside a transaction that is rolled back, so no other test or dev server
    // sharing this database ever sees every agent frozen.
    const rollback = new Error("rollback");
    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(agentControls)
          .values({ agentId: "*", frozen: true, updatedBy: "test" })
          .onConflictDoUpdate({ target: agentControls.agentId, set: { frozen: true } });
        expect((await make(undefined, tx).svc.control(id)).agent_frozen).toBe(true);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("control rejects an unknown session", async () => {
    await expect(make().svc.control(`ses_missing_${rid()}`)).rejects.toThrow();
  });
});
