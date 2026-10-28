import { type Db, agentControls, appendLedger, eq } from "@keel/db";
import type { AgentControl, AgentStore } from "./agents";

const toControl = (r: typeof agentControls.$inferSelect): AgentControl => ({
  agent_id: r.agentId,
  frozen: r.frozen,
  updated_at: r.updatedAt.toISOString(),
  updated_by: r.updatedBy,
});

export function createAgentStore(db: Db): AgentStore {
  return {
    get: async (agentId) => {
      const [row] = await db.select().from(agentControls).where(eq(agentControls.agentId, agentId));
      return row ? toControl(row) : null;
    },
    set: (agentId, frozen, operator, content) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(agentControls)
          .values({ agentId, frozen, updatedBy: operator })
          .onConflictDoUpdate({ target: agentControls.agentId, set: { frozen, updatedAt: new Date(), updatedBy: operator } })
          .returning();
        await appendLedger(tx, content);
        return toControl(row as typeof agentControls.$inferSelect);
      }),
  };
}
