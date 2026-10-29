import { AGENTS, type AgentId } from "@keel/agent";
import { type Db, and, asc, desc, eq, gauntletResults, gauntletRuns, gauntletScenarios, inArray, isNotNull, ledgerEntries, lt, sessionTurns, sessions, sql, storeOrders } from "@keel/db";
import { type DraftSource, type Fixture, type RunFacts, type Scenario, type Scorecard, type Versions, parseScenario } from "@keel/gauntlet";
import type { GauntletStore } from "@keel/worker/gauntlet";
import type { GauntletRunStore, ResultView, RunView } from "./gauntlet";

// Fixture orders are seeded as store_orders rows named <prefix><fixture>; in-window has several.
const SCENARIO: Record<Fixture, string> = {
  "in-window": "in-window",
  "out-of-window": "out-of-window",
  "above-auto-approve": "above-auto-approve",
  // The session is the gauntlet customer's own in-window order; the other customer's
  // order is only named by the persona.
  "other-customer": "in-window",
};
// An in-window order (drawn by honest refund scenarios) is usable while at least this much is still refundable.
const MIN_REMAINING = "40.00";

// Same as packages/db/src/budget.ts: refunds that moved money.
const executedRefund = sql`(${ledgerEntries.payload}->>'tool' = 'offer_refund'
    or (${ledgerEntries.payload}->>'tool' = 'review' and ${ledgerEntries.payload}->>'action' = 'approve'))
  and ${ledgerEntries.payload}->'execution'->>'status' in ('COMPLETED', 'PENDING')`;

// A guarded run of the agent's full pack set: the only kind that can certify it.
const fullGuardedRun = (agentId: AgentId) =>
  and(eq(gauntletRuns.agentId, agentId), eq(gauntletRuns.guarded, true), sql`${gauntletRuns.packs} @> ${JSON.stringify(AGENTS[agentId].packs)}::jsonb`);

const iso = (d: Date | null) => d?.toISOString() ?? null;

const runView = (r: typeof gauntletRuns.$inferSelect): RunView => ({
  id: r.id,
  agent_id: r.agentId,
  status: r.status,
  guarded: r.guarded,
  packs: r.packs,
  repeats: r.repeats,
  versions: r.versions as Versions,
  progress: r.progress,
  scorecard: (r.scorecard as Scorecard | null) ?? null,
  error: r.error,
  created_by: r.createdBy,
  created_at: r.createdAt.toISOString(),
  started_at: iso(r.startedAt),
  finished_at: iso(r.finishedAt),
});

export function createGauntletStore(db: Db, opts: { fixturePrefix?: string } = {}) {
  const prefix = opts.fixturePrefix ?? "ctx-";

  const fail = async (id: string, error: string, now: Date) => {
    // Conditional: a run already finished or failed (e.g. by failStale) keeps its outcome.
    await db
      .update(gauntletRuns)
      .set({ status: "FAILED", error, finishedAt: now })
      .where(and(eq(gauntletRuns.id, id), inArray(gauntletRuns.status, ["QUEUED", "RUNNING"])));
  };

  const runs: GauntletRunStore = {
    createIfIdle: async (run) =>
      db.transaction(async (tx) => {
        // Serializes concurrent starts so two can't both see "idle".
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`keel_gauntlet_run:${run.agent_id}`}))`);
        const [active] = await tx
          .select({ id: gauntletRuns.id })
          .from(gauntletRuns)
          .where(and(eq(gauntletRuns.agentId, run.agent_id), inArray(gauntletRuns.status, ["QUEUED", "RUNNING"])))
          .limit(1);
        if (active) return false;
        await tx.insert(gauntletRuns).values({
          id: run.id,
          agentId: run.agent_id,
          status: "QUEUED",
          guarded: run.guarded,
          packs: run.packs,
          repeats: run.repeats,
          versions: run.versions,
          progress: run.progress,
          createdBy: run.created_by,
        });
        return true;
      }),
    fail,
    list: async (limit) => (await db.select().from(gauntletRuns).orderBy(desc(gauntletRuns.createdAt)).limit(limit)).map(runView),
    get: async (id) => {
      const [row] = await db.select().from(gauntletRuns).where(eq(gauntletRuns.id, id));
      return row ? runView(row) : null;
    },
    results: async (id) => {
      const rows = await db.select().from(gauntletResults).where(eq(gauntletResults.runId, id)).orderBy(asc(gauntletResults.id));
      return rows.map(
        (r): ResultView => ({
          scenario_id: r.scenarioId,
          pack: r.pack,
          kind: r.kind,
          repeat: r.repeat,
          session_id: r.sessionId,
          outcome: r.outcome,
          triggered: r.triggered,
          leaks: r.leaks,
          error: r.error,
        }),
      );
    },
    // Certification is judged only on complete runs: a quick partial run must not replace it.
    latestDoneGuarded: async (agentId) => {
      const [row] = await db
        .select()
        .from(gauntletRuns)
        .where(and(fullGuardedRun(agentId), eq(gauntletRuns.status, "DONE")))
        .orderBy(desc(gauntletRuns.createdAt))
        .limit(1);
      return row ? runView(row) : null;
    },
    latest: async (agentId) => {
      const [row] = await db.select().from(gauntletRuns).where(fullGuardedRun(agentId)).orderBy(desc(gauntletRuns.createdAt)).limit(1);
      return row ? runView(row) : null;
    },
  };

  const runner: GauntletStore = {
    claim: async (runId, now) => {
      const [row] = await db
        .update(gauntletRuns)
        .set({ status: "RUNNING", startedAt: now })
        // Runs without an agent are from before Phase 7f and never run under the per-agent runner.
        .where(and(eq(gauntletRuns.id, runId), eq(gauntletRuns.status, "QUEUED"), isNotNull(gauntletRuns.agentId)))
        .returning();
      return row ? { id: row.id, agent_id: row.agentId as AgentId, status: row.status, guarded: row.guarded, packs: row.packs, repeats: row.repeats, versions: row.versions as Versions } : null;
    },
    pickFixture: async (fixture) => {
      const name = `${prefix}${SCENARIO[fixture]}`;
      const remaining = sql<string>`(${storeOrders.total}::numeric - coalesce((
        select sum((${ledgerEntries.payload}->'execution'->>'amount')::numeric) from ${ledgerEntries}
        where ${ledgerEntries.orderId} = ${storeOrders.orderId} and ${executedRefund}), 0))`;
      const inWindow = SCENARIO[fixture] === "in-window";
      const match = inWindow ? sql`left(${storeOrders.scenario}, length(${name})) = ${name}` : eq(storeOrders.scenario, name);
      const [row] = await db
        .select({ orderId: storeOrders.orderId, payerEmail: storeOrders.payerEmail, currency: storeOrders.currency, total: storeOrders.total, items: storeOrders.items })
        .from(storeOrders)
        .where(inWindow ? and(match, sql`${remaining} >= ${MIN_REMAINING}::numeric`) : match)
        .orderBy(desc(remaining))
        .limit(1);
      if (!row) throw new Error("FIXTURES_EXHAUSTED");
      return { order_id: row.orderId, payer_email: row.payerEmail, total: `${row.currency} ${row.total}`, items: row.items.map((i) => i.title) };
    },
    ledgerRows: async (sessionId) => {
      const rows = await db
        .select({ verdict: ledgerEntries.verdict, reasonCodes: ledgerEntries.reasonCodes, payload: ledgerEntries.payload })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.sessionId, sessionId))
        .orderBy(asc(ledgerEntries.seq));
      return rows.map((r) => {
        const payload = (r.payload ?? {}) as Record<string, unknown>;
        return { tool: typeof payload.tool === "string" ? payload.tool : "", verdict: r.verdict, reason_codes: r.reasonCodes, payload };
      });
    },
    insertResult: async (runId, r) => {
      await db
        .insert(gauntletResults)
        .values({
          runId,
          scenarioId: r.scenario_id,
          pack: r.pack,
          kind: r.kind,
          repeat: r.repeat,
          sessionId: r.session_id,
          outcome: r.outcome,
          triggered: r.triggered,
          leaks: r.leaks,
          facts: r.facts,
          error: r.error,
        })
        .onConflictDoNothing();
    },
    bumpProgress: async (runId) => {
      await db
        .update(gauntletRuns)
        .set({ progress: sql`jsonb_set(${gauntletRuns.progress}, '{done}', to_jsonb((${gauntletRuns.progress}->>'done')::int + 1))` })
        .where(eq(gauntletRuns.id, runId));
    },
    results: async (runId) => {
      const rows = await db.select().from(gauntletResults).where(eq(gauntletResults.runId, runId)).orderBy(asc(gauntletResults.id));
      return rows.map((r) => {
        const f = r.facts as RunFacts | null;
        return {
          scenario_id: r.scenarioId,
          pack: r.pack,
          kind: r.kind as "adversarial" | "honest",
          outcome: r.outcome as "PASS" | "LEAK" | "FALSE_POSITIVE" | "ERROR",
          triggered: r.triggered,
          leaks: r.leaks,
          refused_refund_cents: f?.refused_refund_cents ?? 0,
          guard_latencies_ms: f?.guard_latencies_ms ?? [],
        };
      });
    },
    finish: async (runId, scorecard, now) => {
      await db
        .update(gauntletRuns)
        .set({ status: "DONE", scorecard, finishedAt: now })
        .where(and(eq(gauntletRuns.id, runId), eq(gauntletRuns.status, "RUNNING")));
    },
    fail,
  };

  return {
    runs,
    runner,
    /** Learned scenarios; rows that no longer parse are skipped and logged. */
    learned: async (): Promise<Scenario[]> => {
      const rows = await db.select({ id: gauntletScenarios.id, body: gauntletScenarios.body }).from(gauntletScenarios).orderBy(asc(gauntletScenarios.createdAt));
      return rows.flatMap((r) => {
        try {
          return [parseScenario(r.body)];
        } catch {
          console.warn(`learned scenario ${r.id} skipped: invalid`);
          return [];
        }
      });
    },
    /** False when the id is already taken. */
    saveLearned: async (scenario: Scenario, sourceSessionId: string | null): Promise<boolean> => {
      const rows = await db
        .insert(gauntletScenarios)
        .values({ id: scenario.id, pack: scenario.pack, body: scenario, source: "drafted", sourceSessionId, createdBy: "console" })
        .onConflictDoNothing()
        .returning({ id: gauntletScenarios.id });
      return rows.length > 0;
    },
    /** Everything a draft needs, or null when the session does not exist. */
    draftSource: async (sessionId: string, now: Date): Promise<DraftSource | null> => {
      const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      if (!s) return null;
      const orderId = s.orderIds[0];
      const [o] = orderId ? await db.select().from(storeOrders).where(eq(storeOrders.orderId, orderId)) : [];
      const payer = (s.verifiedPayer ?? s.claimedEmail).toLowerCase();
      const rows = await db
        .select({ verdict: ledgerEntries.verdict, reasonCodes: ledgerEntries.reasonCodes, payload: ledgerEntries.payload })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.sessionId, sessionId))
        .orderBy(asc(ledgerEntries.seq));
      const turns = await db
        .select({ text: sessionTurns.text })
        .from(sessionTurns)
        .where(and(eq(sessionTurns.sessionId, sessionId), eq(sessionTurns.role, "customer")))
        .orderBy(asc(sessionTurns.id));
      return {
        session: { id: s.id, mode: s.mode, state: s.state },
        order: o
          ? {
              delivered_days_ago: o.deliveredAt ? Math.floor((now.getTime() - o.deliveredAt.getTime()) / 86_400_000) : null,
              total: o.total,
              payer_matches: o.payerEmail.toLowerCase() === payer,
            }
          : null,
        rows: rows.map((r) => {
          const tool = (r.payload as { tool?: unknown } | null)?.tool;
          return { tool: typeof tool === "string" ? tool : "", verdict: r.verdict, reason_codes: r.reasonCodes };
        }),
        customer_turns: turns.map((t) => t.text),
      };
    },
    /** Start-up: a QUEUED or RUNNING run created before `before` was interrupted by a restart. */
    failStale: async (before: Date, now: Date): Promise<number> => {
      const rows = await db
        .update(gauntletRuns)
        .set({ status: "FAILED", error: "interrupted", finishedAt: now })
        .where(and(inArray(gauntletRuns.status, ["QUEUED", "RUNNING"]), lt(gauntletRuns.createdAt, before)))
        .returning({ id: gauntletRuns.id });
      return rows.length;
    },
  };
}
