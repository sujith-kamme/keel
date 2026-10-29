import { AGENTS, AGENT_IDS, type AgentId, isAgentId } from "@keel/agent";
import { type DraftSource, NotEligible, PACKS, assertEligible, deriveScenarioFrame, Scenario as ScenarioSchema, type Scenario, type Scorecard, type Versions, certification } from "@keel/gauntlet";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { operatorAuth } from "./operator-auth";

export interface RunView {
  id: string;
  agent_id: string | null;
  status: string;
  guarded: boolean;
  packs: string[];
  repeats: number;
  versions: Versions;
  progress: { total: number; done: number };
  scorecard: Scorecard | null;
  error: string | null;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ResultView {
  scenario_id: string;
  pack: string;
  kind: string;
  repeat: number;
  session_id: string | null;
  outcome: string;
  triggered: boolean;
  leaks: string[];
  error: string | null;
}

export interface NewRun {
  id: string;
  agent_id: AgentId;
  guarded: boolean;
  packs: string[];
  repeats: number;
  versions: Versions;
  progress: { total: number; done: number };
  created_by: string;
}

export interface GauntletRunStore {
  /** Inserts a QUEUED run unless one for this agent is QUEUED or RUNNING; false when one is. */
  createIfIdle: (run: NewRun) => Promise<boolean>;
  fail: (id: string, error: string, now: Date) => Promise<void>;
  /** Newest first. */
  list: (limit: number) => Promise<RunView[]>;
  get: (id: string) => Promise<RunView | null>;
  results: (id: string) => Promise<ResultView[]>;
  latestDoneGuarded: (agentId: AgentId) => Promise<RunView | null>;
  /** The agent's newest guarded run on its full pack set, any status (for re-certification). */
  latest: (agentId: AgentId) => Promise<RunView | null>;
}

export type CatalogEntry = { scenario: Scenario; source: "builtin" | "learned" };

export interface GauntletOptions {
  operatorKey: string;
  merchantKey: string;
  store: GauntletRunStore;
  /** Built-in and learned scenarios (see scenarioCatalog). */
  catalog: () => Promise<CatalogEntry[]>;
  versions: (agentId: AgentId) => Promise<Versions>;
  enqueue: (runId: string) => Promise<void>;
  now: () => Date;
  newId: (prefix: string) => string;
  /** Null when the session does not exist. */
  draftSource: (sessionId: string, now: Date) => Promise<DraftSource | null>;
  /** Throws NotEligible; any other throw is a failed draft. */
  draft: (src: DraftSource, now: Date) => Promise<Scenario>;
  /** False when the id is already taken. */
  saveScenario: (scenario: Scenario, sourceSessionId: string | null) => Promise<boolean>;
}

/** One agent's certification: its latest finished guarded run against the versions running now. */
export async function currentCertification(opts: Pick<GauntletOptions, "store" | "versions">, agentId: AgentId) {
  const [run, current, active] = await Promise.all([opts.store.latestDoneGuarded(agentId), opts.versions(agentId), opts.store.latest(agentId)]);
  const cert = certification(run?.scorecard ? { id: run.id, guarded: run.guarded, versions: run.versions, scorecard: run.scorecard } : null, current, AGENTS[agentId].packs);
  const pending = active && (active.status === "QUEUED" || active.status === "RUNNING") ? { id: active.id, status: active.status } : null;
  return { agent_id: agentId, ...cert, current_versions: current, active_run: pending };
}

const RANK = { NOT_CERTIFIED: 0, STALE: 1, CERTIFIED: 2 } as const;

/** Certified only when every agent is; otherwise the weakest agent's result, its reasons named by agent. */
export async function combinedCertification(opts: Pick<GauntletOptions, "store" | "versions">) {
  const all = await Promise.all(AGENT_IDS.map((id) => currentCertification(opts, id)));
  const worst = all.reduce((a, b) => (RANK[b.status] < RANK[a.status] ? b : a));
  return { status: worst.status, run_id: worst.run_id, reasons: all.flatMap((c) => c.reasons.map((r) => `${AGENTS[c.agent_id].name}: ${r}`)), agents: all };
}

/** Queues a run for one agent; "busy" while that agent already has one queued or running. */
export async function startRun(
  opts: Pick<GauntletOptions, "catalog" | "versions" | "store" | "enqueue" | "now" | "newId">,
  input: { agent: AgentId; packs: string[]; repeats: number; guarded: boolean; created_by: string },
): Promise<{ status: "started" | "busy" | "queue_unavailable"; id: string }> {
  const [catalog, versions] = await Promise.all([opts.catalog(), opts.versions(input.agent)]);
  const id = opts.newId("run");
  const total = scenariosFor(catalog, input.packs, input.agent).length * input.repeats;
  const created = await opts.store.createIfIdle({ id, agent_id: input.agent, guarded: input.guarded, packs: input.packs, repeats: input.repeats, versions, progress: { total, done: 0 }, created_by: input.created_by });
  if (!created) return { status: "busy", id };
  try {
    await opts.enqueue(id);
    return { status: "started", id };
  } catch {
    await opts.store.fail(id, "enqueue failed", opts.now());
    return { status: "queue_unavailable", id };
  }
}

/** Learned scenarios can't shadow a built-in: result rows are unique per scenario id. */
export function scenarioCatalog(builtin: Scenario[], learned: Scenario[]): CatalogEntry[] {
  const ids = new Set(builtin.map((s) => s.id));
  const kept = learned.filter((s) => {
    if (ids.has(s.id)) console.warn(`learned scenario ${s.id} skipped: id used by a built-in`);
    return !ids.has(s.id);
  });
  return [...builtin.map((scenario) => ({ scenario, source: "builtin" as const })), ...kept.map((scenario) => ({ scenario, source: "learned" as const }))];
}

/** Built-ins by pack and agent; learned scenarios when the "learned" pack is selected. */
export function scenariosFor(catalog: CatalogEntry[], packs: string[], agentId: AgentId): Scenario[] {
  return catalog
    .filter((c) => c.scenario.agents.includes(agentId))
    .filter((c) => (c.source === "learned" ? packs.includes("learned") : packs.includes(c.scenario.pack)))
    .map((c) => c.scenario);
}

const StartRun = z.strictObject({
  agent: z.enum(AGENT_IDS as [AgentId, ...AgentId[]]),
  packs: z
    .array(z.enum(PACKS))
    .min(1)
    .max(6)
    .refine((p) => new Set(p).size === p.length, "packs must be unique"),
  repeats: z.number().int().min(1).max(5),
  guarded: z.boolean(),
});
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const StartDraft = z.strictObject({ session_id: z.string().regex(SESSION_ID) });
// Only the drafted wording comes from the client; the rest is rebuilt from the source session.
const SaveScenario = z.strictObject({
  scenario: z.object({ id: z.string(), persona: z.string(), description: z.string(), openers: z.array(z.string()) }),
  source_session_id: z.string().regex(SESSION_ID),
});
const RUN_ID = /^run_[a-f0-9]{1,64}$/;

/** Gauntlet runs for the operator console (Phase 5). */
export function mountGauntlet(app: Hono, opts: GauntletOptions): void {
  const auth = operatorAuth(opts.operatorKey, opts.merchantKey);
  const denied = (c: Context) => {
    const a = auth(c);
    return a === "ok" ? null : c.json({ error: a === 401 ? "unauthorized" : "forbidden" }, a);
  };

  app.post("/v1/gauntlet/runs", async (c) => {
    const no = denied(c);
    if (no) return no;
    const req = StartRun.safeParse(await c.req.json().catch(() => null));
    if (!req.success) return c.json({ error: "invalid_request" }, 400);
    const { status, id } = await startRun(opts, { ...req.data, created_by: "console" });
    if (status === "busy") return c.json({ error: "run_in_progress" }, 409);
    if (status === "queue_unavailable") return c.json({ error: "queue_unavailable" }, 503);
    return c.json({ run_id: id }, 202);
  });

  app.get("/v1/gauntlet/runs", async (c) => {
    const no = denied(c);
    if (no) return no;
    return c.json({ runs: await opts.store.list(20) });
  });

  app.get("/v1/gauntlet/runs/:id", async (c) => {
    const no = denied(c);
    if (no) return no;
    const id = c.req.param("id");
    const run = RUN_ID.test(id) ? await opts.store.get(id) : null;
    if (!run) return c.json({ error: "not_found" }, 404);
    return c.json({ run, results: await opts.store.results(id) });
  });

  app.get("/v1/gauntlet/certification", async (c) => {
    const no = denied(c);
    if (no) return no;
    const agentId = c.req.query("agent_id");
    if (agentId === undefined) return c.json(await combinedCertification(opts));
    if (!isAgentId(agentId)) return c.json({ error: "invalid_request" }, 400);
    return c.json(await currentCertification(opts, agentId));
  });

  app.get("/v1/gauntlet/scenarios", async (c) => {
    const no = denied(c);
    if (no) return no;
    const catalog = await opts.catalog();
    return c.json({
      scenarios: catalog.map(({ scenario: s, source }) => ({ id: s.id, pack: s.pack, kind: s.kind, description: s.description, source })),
    });
  });

  app.post("/v1/gauntlet/drafts", async (c) => {
    const no = denied(c);
    if (no) return no;
    const req = StartDraft.safeParse(await c.req.json().catch(() => null));
    if (!req.success) return c.json({ error: "invalid_request" }, 400);
    const now = opts.now();
    const src = await opts.draftSource(req.data.session_id, now);
    if (!src) return c.json({ error: "not_found" }, 404);
    try {
      return c.json({ scenario: await opts.draft(src, now) });
    } catch (e) {
      if (e instanceof NotEligible) return c.json({ error: "not_eligible" }, 422);
      console.warn("scenario draft failed:", e instanceof Error ? e.message : "unknown");
      return c.json({ error: "draft_failed" }, 502);
    }
  });

  app.post("/v1/gauntlet/scenarios", async (c) => {
    const no = denied(c);
    if (no) return no;
    const req = SaveScenario.safeParse(await c.req.json().catch(() => null));
    if (!req.success) return c.json({ error: "invalid_request" }, 400);
    const sourceId = req.data.source_session_id;
    const src = await opts.draftSource(sourceId, opts.now());
    if (!src) return c.json({ error: "not_found" }, 404);
    try {
      assertEligible(src);
    } catch {
      return c.json({ error: "not_eligible" }, 422);
    }
    const { id, persona, description, openers } = req.data.scenario;
    const parsed = ScenarioSchema.safeParse({ ...deriveScenarioFrame(src), id, persona, description, openers });
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const scenario = parsed.data;
    if ((await opts.catalog()).some((e) => e.scenario.id === scenario.id)) return c.json({ error: "id_taken" }, 409);
    if (!(await opts.saveScenario(scenario, sourceId))) return c.json({ error: "id_taken" }, 409);
    return c.json({ id: scenario.id }, 201);
  });
}
