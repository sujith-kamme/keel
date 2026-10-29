import { randomUUID } from "node:crypto";
import { type Db, agentControls, createDb, eq, sessions } from "@keel/db";
import type { PayPalClient } from "@keel/paypal";
import { describe, expect, it } from "vitest";
import type { RiskService } from "../risk";
import { createGatewayDeps } from "./deps";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.DATABASE_URL)("withOrderLock (Postgres)", () => {
  const deps = createGatewayDeps(createDb(), {} as PayPalClient, {} as RiskService, async () => {});

  async function overlap(a: [string, string], b: [string, string]) {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = deps.withOrderLock(a[0], a[1], async () => {
      events.push("a:start");
      await gate;
      events.push("a:end");
    });
    await wait(150);
    const second = deps.withOrderLock(b[0], b[1], async () => void events.push("b"));
    await wait(300);
    release();
    await Promise.all([first, second]);
    return events;
  }

  it("serializes refunds on different orders of the same session", async () => {
    const s = `ses_${randomUUID()}`;
    expect(await overlap([s, `O-${randomUUID()}`], [s, `O-${randomUUID()}`])).toEqual(["a:start", "a:end", "b"]);
  });

  it("lets different sessions and orders run concurrently", async () => {
    expect(await overlap([`ses_${randomUUID()}`, `O-${randomUUID()}`], [`ses_${randomUUID()}`, `O-${randomUUID()}`])).toEqual([
      "a:start",
      "b",
      "a:end",
    ]);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("handoff (Postgres)", () => {
  const db = createDb();

  it("switches the session to the refund agent unless it or * is frozen", async () => {
    // Inside a transaction that is rolled back, so no other test or dev server
    // sharing this database ever sees an agent frozen.
    const rollback = new Error("rollback");
    await expect(
      db.transaction(async (tx) => {
        const deps = createGatewayDeps(tx as unknown as Db, {} as PayPalClient, {} as RiskService, async () => {});
        const id = `ses_${randomUUID()}`;
        const later = new Date(Date.now() + 600_000);
        await tx.insert(sessions).values({ id, agentId: "agt_policy", claimedEmail: "a@b.test", orderIds: [], otpHash: "x", otpExpiresAt: later, expiresAt: later });
        const agentOf = async () => (await tx.select({ a: sessions.agentId }).from(sessions).where(eq(sessions.id, id)))[0]!.a;

        for (const frozen of ["agt_refund", "*"]) {
          await tx.insert(agentControls).values({ agentId: frozen, frozen: true, updatedBy: "test" }).onConflictDoUpdate({ target: agentControls.agentId, set: { frozen: true } });
          expect(await deps.handoff(id, "agt_refund")).toBe("FROZEN");
          expect(await agentOf()).toBe("agt_policy");
          await tx.update(agentControls).set({ frozen: false }).where(eq(agentControls.agentId, frozen));
        }
        expect(await deps.handoff(id, "agt_refund")).toBe("OK");
        expect(await agentOf()).toBe("agt_refund");
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
