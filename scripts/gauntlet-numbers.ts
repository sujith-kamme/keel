// The pitch numbers, from the latest complete Gauntlet runs per agent: adversarial attempts
// that leaked with the guard off vs on, honest customers wrongly refused, and honest refunds
// that were paid. Read-only. Needs a DONE all-packs run of each kind per agent (console > Gauntlet).
//
//   npm run numbers
import { AGENT_IDS, AGENTS, type AgentId } from "@keel/agent";
import { and, createDb, desc, eq, gauntletResults, gauntletRuns, gauntletScenarios, sql } from "@keel/db";
import { loadBuiltin, parseScenario } from "@keel/gauntlet";

const db = createDb();

const custom = (await db.select({ body: gauntletScenarios.body }).from(gauntletScenarios)).flatMap((r) => {
  try {
    return [parseScenario(r.body)];
  } catch {
    return [];
  }
});
// Honest scenarios whose customer should end up refunded.
const refundScenarios = new Set(
  [...loadBuiltin(), ...custom].filter((s) => s.kind === "honest" && s.expect.must.includes("refund_executed")).map((s) => s.id),
);

async function latestRun(agent: AgentId, guarded: boolean) {
  const [run] = await db
    .select()
    .from(gauntletRuns)
    .where(
      and(
        eq(gauntletRuns.agentId, agent),
        eq(gauntletRuns.guarded, guarded),
        eq(gauntletRuns.status, "DONE"),
        sql`${gauntletRuns.packs} @> ${JSON.stringify(AGENTS[agent].packs)}::jsonb`,
      ),
    )
    .orderBy(desc(gauntletRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const rows = await db.select().from(gauntletResults).where(eq(gauntletResults.runId, run.id));
  const ok = rows.filter((r) => r.outcome !== "ERROR");
  const adversarial = ok.filter((r) => r.kind === "adversarial");
  const honest = ok.filter((r) => r.kind === "honest");
  const refunds = honest.filter((r) => refundScenarios.has(r.scenarioId));
  return {
    label: `${run.id}, ${run.repeats} repeat${run.repeats === 1 ? "" : "s"}, ${run.createdAt.toISOString().slice(0, 10)}`,
    errors: rows.length - ok.length,
    adversarial: adversarial.length,
    leaks: adversarial.filter((r) => r.outcome === "LEAK").length,
    honest: honest.length,
    falsePositives: honest.filter((r) => r.outcome === "FALSE_POSITIVE").length,
    refunds: refunds.length,
    refundsPaid: refunds.filter((r) => (r.facts as { refund_executed?: boolean } | null)?.refund_executed).length,
  };
}

for (const agent of AGENT_IDS) {
  console.log(`\n${AGENTS[agent].name} (${agent})`);
  const [off, on] = await Promise.all([latestRun(agent, false), latestRun(agent, true)]);
  if (!off) console.log("  Guard off: no complete all-packs run yet");
  else console.log(`  Guard off (${off.label}): ${off.leaks}/${off.adversarial} adversarial attempts leaked, ${off.errors} errors`);
  if (!on) {
    console.log("  Guard on:  no complete all-packs run yet");
    continue;
  }
  console.log(`  Guard on  (${on.label}): ${on.leaks}/${on.adversarial} adversarial attempts leaked, ${on.errors} errors`);
  console.log(`  Honest customers wrongly refused: ${on.falsePositives}/${on.honest}`);
  if (on.refunds) console.log(`  Honest refunds paid: ${on.refundsPaid}/${on.refunds}`);
}
process.exit(0);
