import { HANDOFF, type HistoryDecision, type TurnInput, type TurnOutput } from "@keel/agent";
import { type Fixture, type LedgerFactRow, NotEligible, type Outcome, type ResultRow, type RunFacts, type Scenario, type Scorecard, facts, outcome, scorecard } from "@keel/gauntlet";

// The Gauntlet runner: simulated customers talk to the demo agent in CONTEXT sessions,
// driven over HTTP exactly like the store's chat route, and each conversation is scored
// from its ledger rows. It plays the merchant backend and never holds PayPal credentials.

export interface GauntletRun {
  id: string;
  status: string;
  guarded: boolean;
  packs: string[];
  repeats: number;
}

export interface FixtureOrder {
  order_id: string;
  payer_email: string;
  total: string;
  items: string[];
}

export interface ResultInput {
  scenario_id: string;
  pack: string;
  kind: "adversarial" | "honest";
  repeat: number;
  session_id: string | null;
  outcome: Outcome;
  triggered: boolean;
  leaks: string[];
  facts: RunFacts | null;
  error: string | null;
}

export interface GauntletStore {
  /** Moves a QUEUED run to RUNNING; null when it isn't QUEUED (already run, or failed). */
  claim: (runId: string, now: Date) => Promise<GauntletRun | null>;
  /** Throws Error("FIXTURES_EXHAUSTED") when no order fits. */
  pickFixture: (fixture: Fixture) => Promise<FixtureOrder>;
  /** The session's ledger rows in ledger order. */
  ledgerRows: (sessionId: string) => Promise<LedgerFactRow[]>;
  insertResult: (runId: string, result: ResultInput) => Promise<void>;
  bumpProgress: (runId: string) => Promise<void>;
  results: (runId: string) => Promise<ResultRow[]>;
  finish: (runId: string, scorecard: Scorecard, now: Date) => Promise<void>;
  fail: (runId: string, error: string, now: Date) => Promise<void>;
}

type Turn = { role: "customer" | "agent"; text: string };

export interface KeelClient {
  startSession: (body: {
    agent_id: string;
    customer_email: string;
    order_ids: string[];
    mode: "CONTEXT";
    guard_mode: "ENFORCE" | "SHADOW";
  }) => Promise<{ session_id: string; capability_token: string; demo_otp?: string }>;
  verify: (sessionId: string, code: string) => Promise<{ capability_token: string }>;
  detail: (sessionId: string) => Promise<{ turns: (Turn & { decision_ids: string[] })[]; decisions: (HistoryDecision & { decision_id: string })[] }>;
  appendTurn: (sessionId: string, turn: Turn & { decision_ids: string[] }) => Promise<void>;
  guard: (body: { session_id: string; draft_reply: string; conversation: Turn[]; tool_calls_this_turn: string[] }) => Promise<{ final_reply: string; decision_id: string }>;
}

export interface GauntletDeps {
  store: GauntletStore;
  keel: KeelClient;
  /** The scenarios a run with these packs covers (built-in and learned). */
  scenarios: (packs: string[]) => Promise<Scenario[]>;
  /** The demo agent connected to Keel's MCP endpoint with this capability token. */
  agent: (token: string) => Promise<{ turn: (input: TurnInput) => Promise<TurnOutput>; close: () => Promise<void> }>;
  customer: (scenario: Scenario, repeat: number, transcript: Turn[]) => Promise<string | null>;
  concurrency: number;
  now: () => Date;
}

/** GAUNTLET_CONCURRENCY, default 6, 1-10. Bad values throw at start-up. */
export function gauntletConcurrency(value: string | undefined): number {
  const n = Number(value ?? 6);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error("GAUNTLET_CONCURRENCY must be an integer from 1 to 10");
  return n;
}

/** A non-2xx response from Keel's own API; its message names the route prefix, status and error code only. */
export class KeelHttpError extends Error {
  constructor(path: string, readonly status: number, readonly code: string | null) {
    super(`Keel ${path} responded ${status}${code ? ` ${code}` : ""}`);
  }
}

// Results and run errors are shown in the console, so only known errors keep their message.
function short(e: unknown): string {
  if (e instanceof KeelHttpError || e instanceof NotEligible || (e instanceof Error && e.message === "FIXTURES_EXHAUSTED")) return e.message.slice(0, 200);
  console.error(`gauntlet error: ${e instanceof Error ? e.message : String(e)}`);
  return "INTERNAL_ERROR";
}

async function conversation(deps: GauntletDeps, run: GauntletRun, s: Scenario, repeat: number): Promise<ResultInput> {
  const base = { scenario_id: s.id, pack: s.pack, kind: s.kind, repeat };
  let sessionId: string | null = null;
  try {
    const order = await deps.store.pickFixture(s.setup.fixture);
    const guardMode = run.guarded ? "ENFORCE" : "SHADOW";
    const started = await deps.keel.startSession({
      agent_id: "agt_demo_store",
      customer_email: order.payer_email,
      order_ids: [order.order_id],
      mode: "CONTEXT",
      guard_mode: guardMode,
    });
    const id = started.session_id;
    sessionId = id;
    let token = started.capability_token;
    if (s.setup.verified) {
      if (!started.demo_otp) throw new Error("CONTEXT session returned no demo_otp");
      token = (await deps.keel.verify(id, started.demo_otp)).capability_token;
    }
    const context = { customer_email: order.payer_email, verified: s.setup.verified, orders: [{ order_id: order.order_id, total: order.total, items: order.items }] };

    const agent = await deps.agent(token);
    try {
      const transcript: Turn[] = [];
      for (let t = 0; t < s.max_turns; t++) {
        const text = await deps.customer(s, repeat, [...transcript]);
        if (text === null) break;
        // Mirrors apps/web/app/store/api/chat/route.ts.
        const detail = await deps.keel.detail(id);
        const byId = new Map(detail.decisions.map((d) => [d.decision_id, d]));
        const history = detail.turns.map(({ role, text, decision_ids }) => ({
          role,
          text,
          decisions: decision_ids.flatMap((d) => {
            const found = byId.get(d);
            return found ? [{ tool: found.tool, order_id: found.order_id, verdict: found.verdict, reason_codes: found.reason_codes }] : [];
          }),
        }));
        await deps.keel.appendTurn(id, { role: "customer", text, decision_ids: [] });
        transcript.push({ role: "customer", text });
        const { reply, decision_ids } = await agent.turn({ context, history, customerText: text });
        // Never deliver the unguarded draft: if the guard fails, hand off.
        const guard = await deps.keel
          .guard({
            session_id: id,
            draft_reply: reply,
            conversation: [...history.map(({ role, text }) => ({ role, text })), { role: "customer" as const, text }].slice(-50),
            tool_calls_this_turn: decision_ids,
          })
          .catch(() => null);
        const final = guard?.final_reply ?? HANDOFF;
        await deps.keel.appendTurn(id, { role: "agent", text: final, decision_ids: guard ? [...decision_ids, guard.decision_id] : decision_ids });
        // What the customer actually saw (in SHADOW, the draft).
        transcript.push({ role: "agent", text: final });
      }
    } finally {
      await agent.close().catch(() => {});
    }

    const f = facts(await deps.store.ledgerRows(id), { guardMode });
    return { ...base, session_id: id, ...outcome(s, f), facts: f, error: null };
  } catch (e) {
    return { ...base, session_id: sessionId, outcome: "ERROR", triggered: false, leaks: [], facts: null, error: short(e) };
  }
}

export async function runGauntlet(deps: GauntletDeps, runId: string): Promise<void> {
  // Only a QUEUED run starts, so a re-delivered job never runs twice.
  const run = await deps.store.claim(runId, deps.now());
  if (!run) return;
  try {
    const scenarios = await deps.scenarios(run.packs);
    const queue = scenarios.flatMap((s) => Array.from({ length: run.repeats }, (_, r) => [s, r] as const));
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const [s, r] = queue[next++]!;
        await deps.store.insertResult(run.id, await conversation(deps, run, s, r));
        await deps.store.bumpProgress(run.id);
      }
    };
    const settled = await Promise.allSettled(Array.from({ length: Math.min(deps.concurrency, queue.length) }, worker));
    const failed = settled.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
    await deps.store.finish(run.id, scorecard(await deps.store.results(run.id)), deps.now());
  } catch (e) {
    await deps.store.fail(run.id, short(e), deps.now());
  }
}
