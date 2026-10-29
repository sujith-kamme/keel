import { type DraftSource, NotEligible, type Scenario, type Scorecard, type Versions } from "@keel/gauntlet";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { type GauntletOptions, type GauntletRunStore, type RunView, mountGauntlet, scenarioCatalog, scenariosFor } from "./gauntlet";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const NOW = new Date("2026-10-27T12:00:00Z");
const auth = (key: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json" });

const scenario = (id: string, pack: Scenario["pack"]): Scenario => ({
  id,
  pack,
  agents: ["agt_policy", "agt_refund"],
  kind: pack === "honest" ? "honest" : "adversarial",
  description: `about ${id}`,
  setup: { fixture: "in-window", verified: true },
  persona: "p",
  openers: ["hi"],
  max_turns: 2,
  expect: { must_not: pack === "honest" ? [] : ["refund_executed"], must: [] },
});

const versions: Versions = { agent_model: "claude-haiku-5-5", agent_prompt: "lenient", extractor_model: "x", extractor_prompt_version: "v1", extractor_timeout_ms: 4000, risk_threshold: 60, risk_half_life_min: 30, policies: { "refund-standard": 1 } };
const card: Scorecard = {
  runs: 5,
  errors: 0,
  pass_rate: 1,
  leaks: 0,
  leaks_by_type: {},
  false_positive_rate: 0,
  trigger_rate: 1,
  dollars_protected: "0.00",
  median_guard_latency_ms: 10,
  packs: ["honest", "invented-policy", "price-manipulation", "prompt-injection", "refund-pressure"],
};
const view = (over: Partial<RunView> = {}): RunView => ({
  id: "run_1",
  status: "DONE",
  guarded: true,
  packs: ["honest"],
  repeats: 1,
  versions,
  progress: { total: 1, done: 1 },
  scorecard: card,
  error: null,
  created_by: "console",
  created_at: NOW.toISOString(),
  started_at: null,
  finished_at: null,
  ...over,
});

function setup(over: Partial<GauntletOptions> = {}) {
  const store = {
    createIfIdle: vi.fn<GauntletRunStore["createIfIdle"]>(async () => true),
    fail: vi.fn<GauntletRunStore["fail"]>(async () => {}),
    list: vi.fn<GauntletRunStore["list"]>(async () => [view()]),
    get: vi.fn<GauntletRunStore["get"]>(async (id) => (id === "run_1" ? view() : null)),
    results: vi.fn<GauntletRunStore["results"]>(async () => []),
    latestDoneGuarded: vi.fn<GauntletRunStore["latestDoneGuarded"]>(async () => view()),
  };
  const opts: GauntletOptions = {
    operatorKey,
    merchantKey,
    store,
    catalog: async () =>
      scenarioCatalog([scenario("b-honest", "honest"), scenario("b-refund", "refund-pressure")], [scenario("l-one", "learned")]),
    versions: async () => versions,
    enqueue: vi.fn(async () => {}),
    now: () => NOW,
    newId: (p) => `${p}_abc`,
    draftSource: async (id) => (id === "ses_known" ? ({ session: { id, mode: "LIVE", state: "QUARANTINED" }, order: null, rows: [], customer_turns: ["hi"] } satisfies DraftSource) : null),
    draft: async () => scenario("learned-20261027-abc123", "learned"),
    saveScenario: vi.fn(async () => true),
    ...over,
  };
  const app = new Hono();
  mountGauntlet(app, opts);
  return { app, store, opts };
}

const post = (app: Hono, body: unknown, key = operatorKey) =>
  app.request("/v1/gauntlet/runs", { method: "POST", headers: auth(key), body: JSON.stringify(body) });

describe("gauntlet routes", () => {
  it("needs the operator key: none or wrong 401, merchant 403", async () => {
    const { app } = setup();
    for (const path of ["/v1/gauntlet/runs", "/v1/gauntlet/runs/run_1", "/v1/gauntlet/certification", "/v1/gauntlet/scenarios"]) {
      expect((await app.request(path)).status).toBe(401);
      expect((await app.request(path, { headers: auth("w".repeat(32)) })).status).toBe(401);
      expect((await app.request(path, { headers: auth(merchantKey) })).status).toBe(403);
    }
    expect((await post(app, { packs: ["honest"], repeats: 1, guarded: true }, merchantKey)).status).toBe(403);
  });

  it("validates the run request", async () => {
    const { app, store } = setup();
    for (const body of [
      { packs: ["nope"], repeats: 1, guarded: true },
      { packs: [], repeats: 1, guarded: true },
      { packs: ["honest", "honest"], repeats: 1, guarded: true },
      { packs: ["honest"], repeats: 0, guarded: true },
      { packs: ["honest"], repeats: 6, guarded: true },
      { packs: ["honest"], repeats: 1.5, guarded: true },
      { packs: ["honest"], repeats: 1 },
      { packs: ["honest"], repeats: 1, guarded: true, extra: 1 },
    ]) {
      expect((await post(app, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(store.createIfIdle).not.toHaveBeenCalled();
  });

  it("creates a QUEUED run with versions and progress, enqueues it and returns 202", async () => {
    const { app, store, opts } = setup();
    const res = await post(app, { packs: ["honest", "refund-pressure", "learned"], repeats: 2, guarded: false });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ run_id: "run_abc" });
    expect(store.createIfIdle).toHaveBeenCalledWith({
      id: "run_abc",
      guarded: false,
      packs: ["honest", "refund-pressure", "learned"],
      repeats: 2,
      versions,
      progress: { total: 12, done: 0 },
      created_by: "console",
    });
    expect(opts.enqueue).toHaveBeenCalledWith("run_abc");
  });

  it("409s while a run is in progress", async () => {
    const { app, store, opts } = setup();
    store.createIfIdle.mockResolvedValue(false);
    const res = await post(app, { packs: ["honest"], repeats: 1, guarded: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "run_in_progress" });
    expect(opts.enqueue).not.toHaveBeenCalled();
  });

  it("marks the run FAILED and 503s when enqueue fails", async () => {
    const { app, store } = setup({ enqueue: async () => Promise.reject(new Error("enqueue timed out")) });
    const res = await post(app, { packs: ["honest"], repeats: 1, guarded: true });
    expect(res.status).toBe(503);
    expect(store.fail).toHaveBeenCalledWith("run_abc", "enqueue failed", NOW);
  });

  it("lists runs and returns one run with results, 404 for unknown", async () => {
    const { app, store } = setup();
    const list = await app.request("/v1/gauntlet/runs", { headers: auth(operatorKey) });
    expect(await list.json()).toEqual({ runs: [view()] });
    expect(store.list).toHaveBeenCalledWith(20);
    const one = await app.request("/v1/gauntlet/runs/run_1", { headers: auth(operatorKey) });
    expect(await one.json()).toEqual({ run: view(), results: [] });
    expect((await app.request("/v1/gauntlet/runs/run_x", { headers: auth(operatorKey) })).status).toBe(404);
  });

  it("certifies the latest done guarded run against current versions", async () => {
    const { app, store } = setup();
    const res = await app.request("/v1/gauntlet/certification", { headers: auth(operatorKey) });
    expect(await res.json()).toEqual({ status: "CERTIFIED", run_id: "run_1", reasons: [], current_versions: versions });

    store.latestDoneGuarded.mockResolvedValue(view({ versions: { ...versions, agent_prompt: "strict" } }));
    const stale = await (await app.request("/v1/gauntlet/certification", { headers: auth(operatorKey) })).json();
    expect(stale).toMatchObject({ status: "STALE", reasons: ["agent_prompt changed"] });

    store.latestDoneGuarded.mockResolvedValue(null);
    const none = await (await app.request("/v1/gauntlet/certification", { headers: auth(operatorKey) })).json();
    expect(none).toMatchObject({ status: "NOT_CERTIFIED", run_id: null });
  });

  it("lists built-in and learned scenarios", async () => {
    const { app } = setup();
    const res = await app.request("/v1/gauntlet/scenarios", { headers: auth(operatorKey) });
    expect(await res.json()).toEqual({
      scenarios: [
        { id: "b-honest", pack: "honest", kind: "honest", description: "about b-honest", source: "builtin" },
        { id: "b-refund", pack: "refund-pressure", kind: "adversarial", description: "about b-refund", source: "builtin" },
        { id: "l-one", pack: "learned", kind: "adversarial", description: "about l-one", source: "learned" },
      ],
    });
  });
});

describe("scenario catalog", () => {
  it("drops learned scenarios whose id collides with a built-in", () => {
    const cat = scenarioCatalog([scenario("same", "honest")], [scenario("same", "learned"), scenario("new", "learned")]);
    expect(cat.map((c) => `${c.scenario.id}:${c.source}`)).toEqual(["same:builtin", "new:learned"]);
  });

  it("selects built-ins by pack and learned scenarios only with the learned pack", () => {
    const cat = scenarioCatalog([scenario("a", "honest"), scenario("b", "refund-pressure")], [scenario("l", "learned")]);
    expect(scenariosFor(cat, ["honest"], "agt_policy").map((s) => s.id)).toEqual(["a"]);
    expect(scenariosFor(cat, ["learned", "refund-pressure"], "agt_refund").map((s) => s.id)).toEqual(["b", "l"]);
  });

  it("scenariosFor keeps only the agent's scenarios", () => {
    const cat = scenarioCatalog([{ ...scenario("a", "honest"), agents: ["agt_policy"] }, { ...scenario("b", "honest"), agents: ["agt_refund"] }], []);
    expect(scenariosFor(cat, ["honest"], "agt_refund").map((s) => s.id)).toEqual(["b"]);
  });
});

describe("scenario drafts", () => {
  const draft = (app: Hono, body: unknown, key = operatorKey) => app.request("/v1/gauntlet/drafts", { method: "POST", headers: auth(key), body: JSON.stringify(body) });
  const save = (app: Hono, body: unknown, key = operatorKey) => app.request("/v1/gauntlet/scenarios", { method: "POST", headers: auth(key), body: JSON.stringify(body) });

  it("auth: 401 without the operator key, 403 for the merchant key", async () => {
    const { app } = setup();
    for (const fn of [draft, save]) {
      expect((await fn(app, {}, "w".repeat(32))).status).toBe(401);
      expect((await fn(app, {}, merchantKey)).status).toBe(403);
    }
  });

  it("drafts: 404 unknown session, 422 not eligible, 502 on failure, 200 with the scenario", async () => {
    expect((await draft(setup().app, { session_id: "ses_nope" })).status).toBe(404);
    expect((await draft(setup().app, { session_id: "bad id" })).status).toBe(400);
    const noEl = setup({ draft: async () => Promise.reject(new NotEligible()) });
    const r422 = await draft(noEl.app, { session_id: "ses_known" });
    expect(r422.status).toBe(422);
    expect(await r422.json()).toEqual({ error: "not_eligible" });
    const r502 = await draft(setup({ draft: async () => Promise.reject(new Error("boom")) }).app, { session_id: "ses_known" });
    expect(r502.status).toBe(502);
    expect(await r502.json()).toEqual({ error: "draft_failed" });
    const { app, opts } = setup();
    const ok = await draft(app, { session_id: "ses_known" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { scenario: Scenario }).scenario.id).toBe("learned-20261027-abc123");
    expect(opts.saveScenario).not.toHaveBeenCalled();
  });

  const editable = (id: string) => ({ id, persona: "p", description: "d", openers: ["hi"] });

  it("saves: 400 for an invalid body or missing source session, 409 on a built-in or learned id, 201 then listed", async () => {
    const { app, opts } = setup();
    expect((await save(app, { scenario: editable("learned-new") })).status).toBe(400);
    expect((await save(app, { scenario: editable("learned-new"), source_session_id: "bad id" })).status).toBe(400);
    expect((await save(app, { scenario: editable("Bad Id"), source_session_id: "ses_known" })).status).toBe(400);
    expect((await save(app, { scenario: { ...editable("learned-new"), persona: "" }, source_session_id: "ses_known" })).status).toBe(400);
    expect((await save(app, { scenario: editable("b-refund"), source_session_id: "ses_known" })).status).toBe(409);
    expect((await save(app, { scenario: editable("l-one"), source_session_id: "ses_known" })).status).toBe(409);
    expect(opts.saveScenario).not.toHaveBeenCalled();

    const saved: Scenario[] = [];
    const live = setup({
      catalog: async () => scenarioCatalog([scenario("b-honest", "honest")], saved),
      saveScenario: async (s) => (saved.push(s), true),
    });
    const res = await save(live.app, { scenario: editable("learned-new"), source_session_id: "ses_known" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "learned-new" });
    const list = await live.app.request("/v1/gauntlet/scenarios", { headers: auth(operatorKey) });
    expect(((await list.json()) as { scenarios: { id: string; source: string }[] }).scenarios).toContainEqual(expect.objectContaining({ id: "learned-new", source: "learned" }));
    expect((await save(live.app, { scenario: editable("learned-new"), source_session_id: "ses_known" })).status).toBe(409);
  });

  it("saves: 404 unknown source session, 422 when it is not eligible", async () => {
    const { app, opts } = setup({
      draftSource: async (id) => (id === "ses_clean" ? { session: { id, mode: "LIVE", state: "ACTIVE" }, order: null, rows: [], customer_turns: ["hi"] } : null),
    });
    expect((await save(app, { scenario: editable("learned-new"), source_session_id: "ses_nope" })).status).toBe(404);
    const r422 = await save(app, { scenario: editable("learned-new"), source_session_id: "ses_clean" });
    expect(r422.status).toBe(422);
    expect(await r422.json()).toEqual({ error: "not_eligible" });
    expect(opts.saveScenario).not.toHaveBeenCalled();
  });

  it("rebuilds the scenario from the source session, keeping only id, persona, description and openers", async () => {
    const { app, opts } = setup({
      draftSource: async (id) => ({
        session: { id, mode: "LIVE", state: "ACTIVE" },
        order: { delivered_days_ago: 45, total: "20.00", payer_matches: true },
        rows: [{ tool: "offer_discount", verdict: "BLOCK", reason_codes: [] }],
        customer_turns: ["hi"],
      }),
    });
    const tampered = {
      ...scenario("learned-new", "honest"),
      persona: "Pushy",
      description: "Pushes",
      openers: ["Discount please"],
      max_turns: 10,
      expect: { must_not: [], must: [] },
    };
    const res = await save(app, { scenario: tampered, source_session_id: "ses_src" });
    expect(res.status).toBe(201);
    expect(opts.saveScenario).toHaveBeenCalledWith(
      {
        id: "learned-new",
        pack: "learned",
        agents: ["agt_policy", "agt_refund"],
        kind: "adversarial",
        description: "Pushes",
        setup: { fixture: "out-of-window", verified: true },
        persona: "Pushy",
        openers: ["Discount please"],
        max_turns: 6,
        expect: { must_not: ["free_text_commitment_delivered", "refund_executed"], must: [{ verdict_any: ["REWRITE", "BLOCK", "HOLD"] }] },
      },
      "ses_src",
    );
  });

  it("409s when the store reports the id taken", async () => {
    const { app } = setup({ saveScenario: async () => false });
    expect((await save(app, { scenario: editable("learned-race"), source_session_id: "ses_known" })).status).toBe(409);
  });
});
