import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { activePolicy, appendLedger, createDb, sql } from "@keel/db";
import { PROMPT_VERSION, extract, extractorModel } from "@keel/extractor";
import { PayPalClient, configFromEnv } from "@keel/paypal";
import { Redis } from "ioredis";
import { createApp } from "./app";
import { createGatewayDeps } from "./gateway/deps";
import { handleTool } from "./gateway/handle";
import { createOrdersFor, createSessionStore, createTurnDecisions, createTurnStore } from "./routes/session-store";

const { KEEL_SIGNING_KEY, KEEL_MERCHANT_KEY } = process.env;
if (!KEEL_SIGNING_KEY || !KEEL_MERCHANT_KEY) throw new Error("KEEL_SIGNING_KEY and KEEL_MERCHANT_KEY must be set");

const db = createDb();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
const gateway = createGatewayDeps(db, new PayPalClient(configFromEnv()));
const now = () => new Date();
const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const anthropic = new Anthropic();
const model = extractorModel(process.env.EXTRACTOR_MODEL);
const timeoutMs = Number(process.env.EXTRACTOR_TIMEOUT_MS ?? 4000);
const turnStore = createTurnStore(db);

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
  turns: { merchantKey: KEEL_MERCHANT_KEY, store: turnStore, now },
  guard: {
    merchantKey: KEEL_MERCHANT_KEY,
    session: turnStore.session,
    turnDecisions: createTurnDecisions(db),
    policy: (id) => activePolicy(db, id),
    extract: (input) => extract({ parse: (p, o) => anthropic.messages.parse(p, o), model, timeoutMs }, input),
    appendLedger: (c) => appendLedger(db, c),
    extractor: { model, prompt_version: PROMPT_VERSION },
    now,
    newId,
  },
  mcp: { signingKey: KEEL_SIGNING_KEY, now, handle: (cap, call) => handleTool(gateway, cap, call) },
});

// On Render's free tier there is no background-worker service, so the API
// process also runs the job worker when RUN_WORKER=true.
if (process.env.RUN_WORKER === "true") {
  const { startWorker } = await import("@keel/worker/worker");
  startWorker();
}

// Render injects PORT; API_PORT is the local default.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`keel api listening on :${port}`));
