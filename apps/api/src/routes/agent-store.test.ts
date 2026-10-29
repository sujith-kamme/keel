import { randomUUID } from "node:crypto";
import { agentControls, createDb, eq, ledgerEntries, sessions } from "@keel/db";
import type { LedgerContent } from "@keel/engine";
import { riskConfig } from "@keel/risk";
import { describe, expect, it } from "vitest";
import { createRisk } from "../risk";
import { createAgentStore } from "./agent-store";

const rid = () => randomUUID().replaceAll("-", "");

describe.skipIf(!process.env.DATABASE_URL)("agent store (Postgres)", () => {
  const db = createDb();
  const store = createAgentStore(db);
  const content = (agent: string, freeze: boolean): LedgerContent => ({
    decision_id: `dec_${rid()}`,
    session_id: null,
    order_id: null,
    capture_id: null,
    dispute_id: null,
    mode: "LIVE",
    verdict: freeze ? "HOLD" : "ALLOW",
    reason_codes: [freeze ? "AGENT_FROZEN" : "OK"],
    payload: { tool: "kill_switch", action: freeze ? "freeze" : "unfreeze", agent_id: agent, operator: "test" },
  });

  it("upserts the control row, writes the ledger row, and the risk service sees the freeze", async () => {
    const agent = `agt_test_${rid()}`;
    const sid = `ses_test_${rid()}`;
    await db.insert(sessions).values({
      id: sid,
      agentId: agent,
      claimedEmail: "maya@demo.keel.test",
      orderIds: ["O-1"],
      otpHash: "hash",
      otpExpiresAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const risk = createRisk(db, { cfg: async () => riskConfig({}), enqueue: async () => {}, consoleUrl: "https://console.test", now: () => new Date(), newId: (p) => `${p}_${rid()}` });
    try {
      expect(await store.get(agent)).toBeNull();
      expect((await risk.control(sid)).agent_frozen).toBe(false);

      const frozen = content(agent, true);
      expect(await store.set(agent, true, "test", frozen)).toMatchObject({ agent_id: agent, frozen: true, updated_by: "test" });
      expect((await store.get(agent))?.frozen).toBe(true);
      expect((await risk.control(sid)).agent_frozen).toBe(true);
      const [led] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.decisionId, frozen.decision_id));
      expect(led).toMatchObject({ verdict: "HOLD", reasonCodes: ["AGENT_FROZEN"], sessionId: null });

      const open = content(agent, false);
      expect((await store.set(agent, false, "test", open)).frozen).toBe(false);
      expect((await risk.control(sid)).agent_frozen).toBe(false);
      expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.decisionId, open.decision_id))).toHaveLength(1);
    } finally {
      await db.delete(agentControls).where(eq(agentControls.agentId, agent));
    }
  });
});
