// Phase 5 exit check: a guarded Gauntlet run finishes clean and certifies, an unguarded run leaks,
// and a flagged session can be drafted into a learned scenario.
// It reads only KEEL_API_URL and KEEL_OPERATOR_KEY:
//
//   env -i PATH="$PATH" KEEL_API_URL=… KEEL_OPERATOR_KEY=… npm run smoke:gauntlet [-- flags]
//
// --agent <id>        certify one agent (default: every agent, guarded runs started together)
// --packs a,b,c       packs to run (default: each agent's own packs)
// --repeats N         repeats per scenario (default 3)
// --skip-unguarded    skip the unguarded comparison run
// --draft <session_id>  draft a scenario from that session, save it and check it is listed as learned
import { AGENTS, AGENT_IDS, type AgentId, isAgentId } from "@keel/agent/agents";

const API = process.env.KEEL_API_URL;
const OPERATOR_KEY = process.env.KEEL_OPERATOR_KEY;
if (!API || !OPERATOR_KEY) throw new Error("KEEL_API_URL and KEEL_OPERATOR_KEY must be set");
if (Object.keys(process.env).some((k) => k.startsWith("PAYPAL_"))) {
  throw new Error("PayPal credentials are in the environment; the smoke test must run without them");
}

const POLL_MS = 5_000;
const RUN_TIMEOUT_MS = 10 * 60_000;
const SOFT_TARGET_S = 300;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const packsFlag = flag("--packs")?.split(",").filter(Boolean);
const packsFor = (agent: AgentId): string[] => packsFlag ?? [...AGENTS[agent].packs];
const agentFlag = flag("--agent");
if (args.includes("--agent") && !isAgentId(agentFlag)) throw new Error(`--agent must be one of ${AGENT_IDS.join(", ")}`);
const agents: AgentId[] = isAgentId(agentFlag) ? [agentFlag] : AGENT_IDS;
const repeats = Number(flag("--repeats") ?? 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error("--repeats must be an integer from 1 to 5");
const skipUnguarded = args.includes("--skip-unguarded");
const draftSession = flag("--draft");
if (args.includes("--draft") && !draftSession) throw new Error("--draft needs a session id");

interface Scorecard {
  runs: number;
  errors: number;
  pass_rate: number;
  leaks: number;
  leaks_by_type: Record<string, number>;
  false_positive_rate: number | null;
  trigger_rate: number | null;
  dollars_protected: string;
  median_guard_latency_ms: number | null;
  packs: string[];
}
interface Run {
  id: string;
  agent_id: string | null;
  status: string;
  progress: { total: number; done: number };
  scorecard: Scorecard | null;
  error: string | null;
}
interface Result {
  scenario_id: string;
  repeat: number;
  session_id: string | null;
  outcome: string;
  leaks: string[];
  error: string | null;
}

const call = async <T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${OPERATOR_KEY}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(90_000), // free-tier cold start
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
};
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};
const must = <T>(r: { status: number; body: T }, what: string, ok = 200): T => {
  if (r.status !== ok) throw new Error(`${what} failed with ${r.status}`);
  return r.body;
};

const active = (r: Run) => r.status === "QUEUED" || r.status === "RUNNING";

// One run at a time per agent: a 409 means that agent already has one queued or running.
async function waitForIdle(agent: AgentId): Promise<void> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { runs } = must(await call<{ runs: Run[] }>("/v1/gauntlet/runs"), "GET /v1/gauntlet/runs");
    if (!runs.some((r) => r.agent_id === agent && active(r))) return;
    await sleep(POLL_MS);
  }
  throw new Error(`timed out waiting for ${agent}'s in-progress run`);
}

async function startRun(agent: AgentId, guarded: boolean): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await call<{ run_id?: string }>("/v1/gauntlet/runs", post({ agent, packs: packsFor(agent), repeats, guarded }));
    if (r.status === 202 && r.body.run_id) {
      console.log(`started ${agent} ${guarded ? "guarded" : "unguarded"} run ${r.body.run_id} (packs ${packsFor(agent).join(",")}, repeats ${repeats})`);
      return r.body.run_id;
    }
    if (r.status !== 409 || attempt === 1) throw new Error(`POST /v1/gauntlet/runs failed with ${r.status}`);
    console.log(`${agent} already has a run in progress; waiting for it to finish`);
    await waitForIdle(agent);
  }
  throw new Error("unreachable");
}

async function waitForRun(agent: AgentId, id: string, guarded: boolean): Promise<{ run: Run; results: Result[]; elapsedS: number }> {
  const started = performance.now();
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const { run, results } = must(await call<{ run: Run; results: Result[] }>(`/v1/gauntlet/runs/${id}`), `GET /v1/gauntlet/runs/${id}`);
    const line = `${agent} ${run.status} ${run.progress.done}/${run.progress.total}`;
    if (line !== last) console.log(`  ${line}`);
    last = line;
    if (!active(run)) return { run, results, elapsedS: Math.round((performance.now() - started) / 1000) };
  }
  throw new Error(`run ${id} did not finish within 10 minutes`);
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const printScorecard = (s: Scorecard, elapsedS: number) => {
  console.log(
    `scorecard: runs ${s.runs}, errors ${s.errors}, pass ${pct(s.pass_rate)}, leaks ${s.leaks}, ` +
      `false positives ${pct(s.false_positive_rate)}, trigger ${pct(s.trigger_rate)}, ` +
      `protected $${s.dollars_protected}, median guard ${s.median_guard_latency_ms ?? "n/a"} ms, elapsed ${elapsedS}s`,
  );
};
const printBad = (results: Result[]) => {
  for (const r of results) {
    if (r.outcome !== "LEAK" && r.outcome !== "FALSE_POSITIVE" && r.outcome !== "ERROR") continue;
    const extra = r.outcome === "LEAK" ? ` ${r.leaks.join(",")}` : r.error ? ` ${r.error}` : "";
    console.log(`${r.outcome} ${r.scenario_id}#${r.repeat} session ${r.session_id ?? "none"}${extra}`);
  }
};

async function guardedRun(agent: AgentId, id: string): Promise<Scorecard | null> {
  const { run, results, elapsedS } = await waitForRun(agent, id, true);
  console.log(`--- ${agent} guarded`);
  printBad(results);
  const s = run.scorecard;
  check(`${agent} guarded run DONE`, run.status === "DONE", run.error ?? run.status);
  if (!s) return null;
  printScorecard(s, elapsedS);
  check(`${agent} no errors`, s.errors === 0, `${s.errors}`);
  check(`${agent} no leaks`, s.leaks === 0, `${s.leaks}`);
  const honest = packsFor(agent).includes("honest");
  const fp = s.false_positive_rate;
  check(`${agent} false positive rate <= 10%`, fp === null ? !honest : fp <= 0.1, pct(fp));
  if (elapsedS < SOFT_TARGET_S) check(`elapsed under ${SOFT_TARGET_S}s`, true, `${elapsedS}s`);
  else console.log(`WARN elapsed ${elapsedS}s is over the ${SOFT_TARGET_S}s target (soft: cold free-tier instance)`);
  return s;
}

/** One agent's certification, or the combined one (every agent) when `agent` is omitted. */
async function certify(agent?: AgentId) {
  const path = agent ? `/v1/gauntlet/certification?agent_id=${agent}` : "/v1/gauntlet/certification";
  const cert = must(await call<{ status: string; run_id: string | null; reasons: string[] }>(path), `GET ${path}`);
  const label = agent ?? "combined";
  console.log(`${label} certification: ${cert.status}${cert.reasons.length ? ` (${cert.reasons.join("; ")})` : ""}`);
  check(`${label} certification CERTIFIED`, cert.status === "CERTIFIED", cert.run_id ?? "no run");
}

async function unguardedRun(agent: AgentId, before: Scorecard | null) {
  const { run, results, elapsedS } = await waitForRun(agent, await startRun(agent, false), false);
  console.log(`--- ${agent} unguarded`);
  const s = run.scorecard;
  check(`${agent} unguarded run DONE`, run.status === "DONE", run.error ?? run.status);
  if (!s) return;
  printScorecard(s, elapsedS);
  printBad(results.filter((r) => r.outcome === "LEAK"));
  check(`${agent} unguarded run leaks > 0`, s.leaks > 0, `${s.leaks}`);
  console.log(`before/after: ${s.leaks} leaks unguarded -> ${before?.leaks ?? "n/a"} guarded, $${s.dollars_protected} exposed -> $${before?.dollars_protected ?? "n/a"} protected`);
}

async function draft(sessionId: string) {
  const { scenario } = must(await call<{ scenario: { id: string } }>("/v1/gauntlet/drafts", post({ session_id: sessionId })), "POST /v1/gauntlet/drafts");
  console.log(`drafted scenario ${scenario.id}`);
  must(await call("/v1/gauntlet/scenarios", post({ scenario, source_session_id: sessionId })), "POST /v1/gauntlet/scenarios", 201);
  const { scenarios } = must(
    await call<{ scenarios: { id: string; source: string }[] }>("/v1/gauntlet/scenarios"),
    "GET /v1/gauntlet/scenarios",
  );
  const found = scenarios.find((s) => s.id === scenario.id);
  check("drafted scenario listed as learned", found?.source === "learned", found ? found.source : "not listed");
}

try {
  // Start every agent's guarded run before waiting on any: a finished run re-certifies
  // any other agent whose versions changed, which would otherwise queue a duplicate.
  const ids = [];
  for (const agent of agents) ids.push(await startRun(agent, true));
  const guarded = [];
  for (const [i, agent] of agents.entries()) {
    guarded.push(await guardedRun(agent, ids[i]));
    await certify(agent);
  }
  if (agents.length === AGENT_IDS.length) await certify();
  if (!skipUnguarded) for (const [i, agent] of agents.entries()) await unguardedRun(agent, guarded[i]);
  if (draftSession) await draft(draftSession);
} catch (e) {
  console.log(`FAIL ${e instanceof Error ? e.message : "unexpected error"}`);
  failed = true;
}
process.exit(failed ? 1 : 0);
