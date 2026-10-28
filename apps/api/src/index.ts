import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { agentModel, connectAgentTools, promptMode, runTurn } from "@keel/agent";
import { activePolicy, appendLedger, createDb, sql } from "@keel/db";
import { PROMPT_VERSION, extract, extractorModel } from "@keel/extractor";
import { type Versions, customerModel, loadBuiltin, nextCustomerMessage } from "@keel/gauntlet";
import { PayPalClient, configFromEnv } from "@keel/paypal";
import { riskConfig } from "@keel/risk";
import { type KeelClient, gauntletConcurrency, runGauntlet } from "@keel/worker/gauntlet";
import { enqueueGauntlet, enqueueNotify } from "@keel/worker/queue";
import { Redis } from "ioredis";
import { createApp } from "./app";
import { createRisk } from "./risk";
import { createGatewayDeps } from "./gateway/deps";
import { handleTool } from "./gateway/handle";
import { createAgentStore } from "./routes/agent-store";
import { scenarioCatalog, scenariosFor } from "./routes/gauntlet";
import { createGauntletStore } from "./routes/gauntlet-store";
import { KNOWN_POLICY_IDS } from "./routes/guard";
import { createReviewStore } from "./routes/review-store";
import { createOrdersFor, createSessionStore, createTurnDecisions, createTurnStore } from "./routes/session-store";

const { KEEL_SIGNING_KEY, KEEL_MERCHANT_KEY, KEEL_OPERATOR_KEY } = process.env;
if (!KEEL_SIGNING_KEY || !KEEL_MERCHANT_KEY || !KEEL_OPERATOR_KEY) {
  throw new Error("KEEL_SIGNING_KEY, KEEL_MERCHANT_KEY and KEEL_OPERATOR_KEY must be set");
}

const db = createDb();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
const now = () => new Date();
const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const consoleUrl = process.env.CONSOLE_URL ?? "http://localhost:3000";
const risk = createRisk(db, { cfg: riskConfig(process.env), enqueue: enqueueNotify, consoleUrl, now, newId });
const notifyHeld = (e: { session_id: string; decision_id: string; reason_codes: string[] }) =>
  enqueueNotify({ event: "action.held", ...e, console_url: `${consoleUrl}/review`, at: now().toISOString() });
const gateway = createGatewayDeps(db, new PayPalClient(configFromEnv()), risk, notifyHeld);
const anthropic = new Anthropic();
const model = extractorModel(process.env.EXTRACTOR_MODEL);
const timeoutMs = Number(process.env.EXTRACTOR_TIMEOUT_MS ?? 4000);
const turnStore = createTurnStore(db);

// Gauntlet (Phase 5). Typos in these settings fail here, at start-up.
const gauntletStore = createGauntletStore(db);
const builtinScenarios = loadBuiltin();
const catalog = async () => scenarioCatalog(builtinScenarios, await gauntletStore.learned());
const demoAgent = { model: agentModel(process.env.DEMO_AGENT_MODEL), mode: promptMode(process.env.DEMO_AGENT_PROMPT) };
const currentVersions = async (): Promise<Versions> => {
  const policies: Record<string, number> = {};
  for (const id of KNOWN_POLICY_IDS) {
    const version = ((await activePolicy(db, id)) as { version?: unknown } | null)?.version;
    if (typeof version === "number") policies[id] = version;
  }
  return { agent_model: demoAgent.model, agent_prompt: demoAgent.mode, extractor_model: model, extractor_prompt_version: PROMPT_VERSION, policies };
};
// Render injects PORT; API_PORT is the local default.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);

const app = createApp({
  checks: {
    db: async () => {
      await db.execute(sql`select 1`);
    },
    redis: async () => {
      await redis.ping();
    },
  },
  sessions: {
    merchantKey: KEEL_MERCHANT_KEY,
    signingKey: KEEL_SIGNING_KEY,
    demoOtp: process.env.DEMO_OTP === "true",
    store: createSessionStore(db),
    now,
    newId,
  },
  store: { merchantKey: KEEL_MERCHANT_KEY, ordersFor: createOrdersFor(db) },
  turns: { merchantKey: KEEL_MERCHANT_KEY, store: turnStore, now, riskDetail: risk.detail },
  guard: {
    merchantKey: KEEL_MERCHANT_KEY,
    session: turnStore.session,
    turnDecisions: createTurnDecisions(db),
    policy: (id) => activePolicy(db, id),
    control: risk.control,
    assess: risk.assess,
    extract: (input) => extract({ parse: (p, o) => anthropic.messages.parse(p, o), model, timeoutMs }, input),
    appendLedger: (c) => appendLedger(db, c),
    extractor: { model, prompt_version: PROMPT_VERSION },
    now,
    newId,
  },
  mcp: { signingKey: KEEL_SIGNING_KEY, now, handle: (cap, call) => handleTool(gateway, cap, call) },
  review: { operatorKey: KEEL_OPERATOR_KEY, merchantKey: KEEL_MERCHANT_KEY, store: createReviewStore(db), gateway, detail: risk.detail },
  agents: { operatorKey: KEEL_OPERATOR_KEY, merchantKey: KEEL_MERCHANT_KEY, store: createAgentStore(db), newId },
  gauntlet: {
    operatorKey: KEEL_OPERATOR_KEY,
    merchantKey: KEEL_MERCHANT_KEY,
    store: gauntletStore.runs,
    catalog,
    versions: currentVersions,
    enqueue: enqueueGauntlet,
    now,
    newId,
  },
});

// When this process runs the worker, any QUEUED or RUNNING run at start-up was
// cut off by the restart. With a separate worker, only runs older than 15 minutes are.
const staleBefore = process.env.RUN_WORKER === "true" ? new Date() : new Date(Date.now() - 15 * 60_000);
await gauntletStore.failStale(staleBefore, now()).catch((e: unknown) => {
  console.error("gauntlet stale-run cleanup failed:", e instanceof Error ? e.message : "unknown");
});

// On Render's free tier there is no background-worker service, so the API
// process also runs the job worker when RUN_WORKER=true.
if (process.env.RUN_WORKER === "true") {
  const { startWorker } = await import("@keel/worker/worker");
  const concurrency = gauntletConcurrency(process.env.GAUNTLET_CONCURRENCY);
  const customer = customerModel(process.env.GAUNTLET_CUSTOMER_MODEL);
  // The runner plays the merchant backend against this same process, over HTTP.
  const apiBase = `http://127.0.0.1:${port}`;
  const keel = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${apiBase}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${KEEL_MERCHANT_KEY}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
      throw new Error(`Keel ${path.split("/").slice(0, 3).join("/")} responded ${res.status}${error ? ` ${error}` : ""}`);
    }
    return (await res.json()) as T;
  };
  const sessionPath = (id: string) => `/v1/sessions/${encodeURIComponent(id)}`;
  const client: KeelClient = {
    startSession: (body) => keel("/v1/sessions", body),
    verify: (id, code) => keel(`${sessionPath(id)}/verify`, { code }),
    detail: (id) => keel(sessionPath(id)),
    appendTurn: async (id, turn) => {
      await keel(`${sessionPath(id)}/turns`, turn);
    },
    guard: (body) => keel("/v1/guard", body),
  };
  const createMessage = (p: Anthropic.MessageCreateParamsNonStreaming) => anthropic.messages.create(p);
  startWorker({
    gauntlet: (runId) =>
      runGauntlet(
        {
          store: gauntletStore.runner,
          keel: client,
          scenarios: async (packs) => scenariosFor(await catalog(), packs),
          agent: async (token) => {
            const tools = await connectAgentTools(apiBase, token);
            return {
              turn: (input) => runTurn({ ...demoAgent, createMessage, tools: tools.tools, callTool: tools.callTool }, input),
              close: tools.close,
            };
          },
          customer: (scenario, repeat, transcript) => nextCustomerMessage({ createMessage, model: customer }, scenario, repeat, transcript),
          concurrency,
          now,
        },
        runId,
      ),
  });
}

serve({ fetch: app.fetch, port }, () => console.log(`keel api listening on :${port}`));
