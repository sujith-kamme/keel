import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { agentModel, connectAgentTools, promptMode, runTurn } from "@keel/agent";
import { activePolicy, appendLedger, approveVersion, createDb, discardVersion, decisionsByDay, disputeOutcomes, dollarsProtected, insertDraft, listPolicies, liveSessions, policyVersions, readChain, readLedgerPage, sql, violations } from "@keel/db";
import { PROMPT_VERSION, draftPolicy, extract } from "@keel/extractor";
import { type Versions, draftScenario, loadBuiltin, nextCustomerMessage } from "@keel/gauntlet";
import { PayPalClient, configFromEnv } from "@keel/paypal";
import { acceptClaim, adjudicate, escalate, getDispute, listDisputes, provideEvidence, verifyWebhook } from "@keel/paypal/disputes";
import { type KeelClient, KeelHttpError, runGauntlet } from "@keel/worker/gauntlet";
import { type DisputeDeps, pollDisputes, syncDispute } from "@keel/worker/dispute";
import { enqueueDisputePoll, enqueueDisputeSync, enqueueGauntlet, enqueueNotify, scheduleDisputePoll } from "@keel/worker/queue";
import { sendNotify } from "@keel/worker/notify";
import { Redis } from "ioredis";
import { createApp } from "./app";
import { createRisk } from "./risk";
import { createGatewayDeps } from "./gateway/deps";
import { newId } from "./id";
import { handleTool } from "./gateway/handle";
import { createAgentStore } from "./routes/agent-store";
import { initConsoleAccount } from "./routes/console";
import { createConsoleStore } from "./routes/console-store";
import { createDisputeStore } from "./routes/dispute-store";
import { currentCertification, scenarioCatalog, scenariosFor } from "./routes/gauntlet";
import { createGauntletStore } from "./routes/gauntlet-store";
import { KNOWN_POLICY_IDS } from "./routes/guard";
import { createReviewStore } from "./routes/review-store";
import { createOrdersFor, createSessionDecisions, createSessionStore, createTurnDecisions, createTurnStore } from "./routes/session-store";
import { createSettings } from "./settings";
import type { SettingsStatus } from "./routes/settings";

const { KEEL_SIGNING_KEY, KEEL_MERCHANT_KEY, KEEL_OPERATOR_KEY } = process.env;
if (!KEEL_SIGNING_KEY || !KEEL_MERCHANT_KEY || !KEEL_OPERATOR_KEY) {
  throw new Error("KEEL_SIGNING_KEY, KEEL_MERCHANT_KEY and KEEL_OPERATOR_KEY must be set");
}

const db = createDb();
// Runtime settings live in the DB; env values only seed keys that have no row yet. Read at use time.
const settings = createSettings(db, process.env);
await settings.init();
// The console sign-in lives in the DB; CONSOLE_USER / CONSOLE_PASSWORD only create it on first boot.
const consoleStore = createConsoleStore(db);
await initConsoleAccount(consoleStore, process.env);
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
const now = () => new Date();
const consoleUrl = process.env.CONSOLE_URL ?? "http://localhost:3000";
const riskCfg = async () => {
  const s = await settings.get();
  return { threshold: s.risk_threshold, half_life_min: s.risk_half_life_min };
};
const risk = createRisk(db, { cfg: riskCfg, enqueue: enqueueNotify, consoleUrl, now, newId });
const notifyHeld = (e: { session_id: string; decision_id: string; reason_codes: string[] }) =>
  enqueueNotify({ event: "action.held", ...e, console_url: `${consoleUrl}/review`, at: now().toISOString() });
const paypal = new PayPalClient(configFromEnv());
const gateway = createGatewayDeps(db, paypal, risk, notifyHeld);
const anthropic = new Anthropic();
const turnStore = createTurnStore(db);

// Gauntlet (Phase 5).
const gauntletStore = createGauntletStore(db);
const builtinScenarios = loadBuiltin();
const catalog = async () => scenarioCatalog(builtinScenarios, await gauntletStore.learned());
const currentVersions = async (): Promise<Versions> => {
  const policies: Record<string, number> = {};
  // price-catalog isn't a policy the guard checks claims against, but an approved change to it still makes certification stale.
  const ids = [...KNOWN_POLICY_IDS, "price-catalog"];
  const [active, s] = await Promise.all([Promise.all(ids.map((id) => activePolicy(db, id))), settings.get()]);
  ids.forEach((id, i) => {
    const version = (active[i] as { version?: unknown } | null)?.version;
    if (typeof version === "number") policies[id] = version;
  });
  return {
    agent_model: s.agent_model,
    agent_prompt: s.agent_prompt,
    extractor_model: s.extractor_model,
    extractor_prompt_version: PROMPT_VERSION,
    extractor_timeout_ms: s.extractor_timeout_ms,
    risk_threshold: s.risk_threshold,
    risk_half_life_min: s.risk_half_life_min,
    policies,
  };
};
// Disputes (Phase 6). dispute_auto_submit acts on DEFEND/CONCEDE without an operator (demo).
const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim() || null;
const disputeStore = createDisputeStore(db);
const disputeDeps: DisputeDeps = {
  store: disputeStore,
  paypal: {
    get: (id) => getDispute(paypal, id),
    list: (after) => listDisputes(paypal, after),
    refunds: async (orderId) =>
      (await paypal.getOrderDetails(orderId)).purchase_units
        .flatMap((u) => u.payments?.refunds ?? [])
        .map((r) => ({ id: r.id, status: r.status, amount: r.amount.value })),
    capture: async (id) => {
      const c = await paypal.getCapture(id);
      return { id: c.id, status: c.status, amount: c.amount.value };
    },
    provideEvidence: (id, e, requestId) => provideEvidence(paypal, id, e, requestId),
    acceptClaim: (id, note, requestId) => acceptClaim(paypal, id, note, requestId),
  },
  // The buyer's dispute text goes to the extractor as customer data, never as instructions (FR-SEC-5).
  scan: async (text) =>
    (await extract({ parse: (p, o) => anthropic.messages.parse(p, o), model: (await settings.get()).extractor_model, timeoutMs: 15_000 }, { draft: "", customer_message: text, policy_ids: [] }))
      .injection_signals.some((s) => s.source === "customer"),
  notify: enqueueNotify,
  enqueueSync: enqueueDisputeSync,
  autoSubmit: async () => (await settings.get()).dispute_auto_submit,
  consoleUrl,
  newId,
  now,
};
// Render injects PORT; API_PORT is the local default.
const clientId = process.env.PAYPAL_CLIENT_ID?.trim() || null;
const settingsStatus: SettingsStatus = {
  paypal: {
    mode: paypal.isSandbox ? "sandbox" : "live",
    client_id: clientId && `${clientId.slice(0, 4)}…${clientId.slice(-3)}`,
    webhook_configured: webhookId !== null,
  },
  anthropic: { key_set: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) },
  demo_otp: process.env.DEMO_OTP === "true",
};
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
    gauntletPayer: (process.env.GAUNTLET_PAYER ?? "gauntlet@demo.keel.test").toLowerCase(),
    store: createSessionStore(db),
    now,
    newId,
  },
  store: { merchantKey: KEEL_MERCHANT_KEY, ordersFor: createOrdersFor(db) },
  turns: { merchantKey: KEEL_MERCHANT_KEY, store: turnStore, now, riskDetail: risk.detail, scores: risk.scores },
  guard: {
    merchantKey: KEEL_MERCHANT_KEY,
    session: turnStore.session,
    turnDecisions: createTurnDecisions(db),
    sessionDecisions: createSessionDecisions(db),
    policy: (id) => activePolicy(db, id),
    control: risk.control,
    assess: risk.assess,
    extract: (input, cfg) => extract({ parse: (p, o) => anthropic.messages.parse(p, o), model: cfg.model, timeoutMs: cfg.timeout_ms }, input),
    appendLedger: (c) => appendLedger(db, c),
    extractor: async () => {
      const s = await settings.get();
      return { model: s.extractor_model, prompt_version: PROMPT_VERSION, timeout_ms: s.extractor_timeout_ms };
    },
    now,
    newId,
  },
  mcp: { signingKey: KEEL_SIGNING_KEY, now, handle: (cap, call) => handleTool(gateway, cap, call) },
  review: { operatorKey: KEEL_OPERATOR_KEY, merchantKey: KEEL_MERCHANT_KEY, store: createReviewStore(db), gateway, scores: risk.scores },
  agents: { operatorKey: KEEL_OPERATOR_KEY, merchantKey: KEEL_MERCHANT_KEY, store: createAgentStore(db), newId },
  console: { operatorKey: KEEL_OPERATOR_KEY, merchantKey: KEEL_MERCHANT_KEY, store: consoleStore, redis, newId },
  settings: {
    operatorKey: KEEL_OPERATOR_KEY,
    merchantKey: KEEL_MERCHANT_KEY,
    settings,
    status: settingsStatus,
    reschedulePoll: process.env.RUN_WORKER === "true" ? scheduleDisputePoll : async () => {},
    getHookUrl: async () => (await settings.get()).zapier_hook_url,
    send: async (hookUrl) => {
      const res = await sendNotify(
        { event: "keel.test", session_id: "test", decision_id: "test", reason_codes: ["OK"], console_url: consoleUrl, at: now().toISOString() },
        { hookUrl, fetch },
      );
      if (!("status" in res)) throw new Error("notify skipped");
      return res;
    },
  },
  gauntlet: {
    operatorKey: KEEL_OPERATOR_KEY,
    merchantKey: KEEL_MERCHANT_KEY,
    store: gauntletStore.runs,
    catalog,
    versions: currentVersions,
    enqueue: enqueueGauntlet,
    now,
    newId,
    draftSource: gauntletStore.draftSource,
    draft: async (src, at) =>
      draftScenario({ parse: (p, o) => anthropic.messages.parse(p, o), model: (await settings.get()).gauntlet_customer_model, timeoutMs: 20_000 }, src, at),
    saveScenario: gauntletStore.saveLearned,
  },
  disputes: {
    operatorKey: KEEL_OPERATOR_KEY,
    merchantKey: KEEL_MERCHANT_KEY,
    store: disputeStore,
    deps: disputeDeps,
    appendLedger: (c) => appendLedger(db, c),
    enqueueSync: enqueueDisputeSync,
    enqueuePoll: enqueueDisputePoll,
    sandbox: paypal.isSandbox
      ? { escalate: (id) => escalate(paypal, id, "Requesting PayPal review."), adjudicate: (id, outcome) => adjudicate(paypal, id, outcome) }
      : undefined,
    webhook: webhookId ? (headers, raw) => verifyWebhook(paypal, headers, raw, webhookId) : null,
    now,
    newId,
  },
  ledger: {
    operatorKey: KEEL_OPERATOR_KEY,
    merchantKey: KEEL_MERCHANT_KEY,
    page: (o) => readLedgerPage(db, o),
    chain: () => readChain(db),
  },
  overview: {
    operatorKey: KEEL_OPERATOR_KEY,
    merchantKey: KEEL_MERCHANT_KEY,
    certification: () => currentCertification({ store: gauntletStore.runs, versions: currentVersions }),
    run: (id) => gauntletStore.runs.get(id),
    sessions: () => liveSessions(db),
    violations: (since) => violations(db, { since }),
    dollarsProtected: (since) => dollarsProtected(db, { since }),
    decisionsByDay: () => decisionsByDay(db),
    disputes: () => disputeOutcomes(db),
    recent: () => readLedgerPage(db, { limit: 6, live: true }),
    now,
  },
  gridQuery: {
    operatorKey: KEEL_OPERATOR_KEY,
    merchantKey: KEEL_MERCHANT_KEY,
    complete: (p, o) => anthropic.messages.create(p, o),
    model: async () => (await settings.get()).extractor_model,
    timeoutMs: 20_000,
    now,
  },
  policies: {
    operatorKey: KEEL_OPERATOR_KEY,
    merchantKey: KEEL_MERCHANT_KEY,
    list: () => listPolicies(db),
    versions: (id) => policyVersions(db, id),
    active: (id) => activePolicy(db, id),
    draft: async (input) =>
      draftPolicy({ parse: (p, o) => anthropic.messages.parse(p, o), model: (await settings.get()).extractor_model, timeoutMs: 45_000 }, input),
    insertDraft: (id, policy) => insertDraft(db, id, policy),
    approve: (id, version, edits, entry) => approveVersion(db, id, version, edits, entry),
    discard: (id, version, entry) => discardVersion(db, id, version, entry),
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
      throw new KeelHttpError(path.split("/").slice(0, 3).join("/"), res.status, error ?? null);
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
  await scheduleDisputePoll((await settings.get()).dispute_poll_seconds);
  startWorker({
    hookUrl: async () => (await settings.get()).zapier_hook_url,
    dispute: { sync: (id) => syncDispute(disputeDeps, id), poll: () => pollDisputes(disputeDeps) },
    // The agent runs on the run's own snapshot (what is certified); the customer model and
    // concurrency are read once, at run start, so every scenario in a run uses one config.
    gauntlet: async (runId) => {
      const s = await settings.get();
      return runGauntlet(
        {
          store: gauntletStore.runner,
          keel: client,
          scenarios: async (packs) => scenariosFor(await catalog(), packs),
          agent: async (token, v) => {
            const demoAgent = { model: agentModel(v.agent_model), mode: promptMode(v.agent_prompt) };
            const tools = await connectAgentTools(apiBase, token);
            return {
              turn: (input) => runTurn({ ...demoAgent, createMessage, tools: tools.tools, callTool: tools.callTool }, input),
              close: tools.close,
            };
          },
          customer: (scenario, repeat, transcript) =>
            nextCustomerMessage({ createMessage, model: s.gauntlet_customer_model }, scenario, repeat, transcript),
          concurrency: s.gauntlet_concurrency,
          now,
        },
        runId,
      );
    },
  });
}

serve({ fetch: app.fetch, port }, () => console.log(`keel api listening on :${port}`));
