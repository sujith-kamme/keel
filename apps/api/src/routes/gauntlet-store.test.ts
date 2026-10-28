import { randomUUID } from "node:crypto";
import { appendLedger, createDb, eq, gauntletRuns, inArray, storeOrders } from "@keel/db";
import type { Versions } from "@keel/gauntlet";
import { describe, expect, it } from "vitest";
import { createGauntletStore } from "./gauntlet-store";

const rid = () => randomUUID().replaceAll("-", "");
const versions: Versions = { agent_model: "m", agent_prompt: "p", extractor_model: "e", extractor_prompt_version: "v", policies: {} };

describe.skipIf(!process.env.DATABASE_URL)("gauntlet store (Postgres)", () => {
  const db = createDb();
  const prefix = `t${rid().slice(0, 12)}-`;
  const store = createGauntletStore(db, { fixturePrefix: prefix });
  const now = new Date();

  async function insertRun(over: Partial<typeof gauntletRuns.$inferInsert> = {}) {
    const id = `run_${rid()}`;
    await db.insert(gauntletRuns).values({ id, guarded: true, packs: ["honest"], repeats: 1, versions, progress: { total: 2, done: 0 }, createdBy: "test", ...over });
    return id;
  }

  async function order(scenario: string, total: string) {
    const orderId = `T-${rid()}`;
    await db.insert(storeOrders).values({
      orderId,
      captureId: `CAP-${orderId}`,
      scenario: `${prefix}${scenario}`,
      payerEmail: "gauntlet@demo.keel.test",
      currency: "USD",
      total,
      items: [{ sku: "s", title: "Tent", price: total }],
    });
    return orderId;
  }

  const refund = (orderId: string, amount: string, status: string) =>
    appendLedger(db, {
      decision_id: `dec_${rid()}`,
      session_id: null,
      order_id: orderId,
      capture_id: null,
      dispute_id: null,
      mode: "CONTEXT",
      verdict: "ALLOW",
      reason_codes: ["OK"],
      payload: { tool: "offer_refund", execution: { status, amount } },
    });

  it("claims, records results and progress, and finishes a run", async () => {
    const id = await insertRun();
    expect(await store.runner.claim(id, now)).toMatchObject({ id, status: "RUNNING", guarded: true, packs: ["honest"], repeats: 1 });
    expect(await store.runner.claim(id, now)).toBeNull();

    const facts = { refund_executed: false, discount_issued: false, free_text_commitment_delivered: false, verdicts: [], refused_refund_cents: 4000, guard_latencies_ms: [7], honest_violations: [] };
    const result = { scenario_id: "a", pack: "honest", kind: "honest" as const, repeat: 0, session_id: null, outcome: "PASS" as const, triggered: true, leaks: [], facts, error: null };
    await store.runner.insertResult(id, result);
    await store.runner.insertResult(id, result); // duplicate is ignored
    await store.runner.insertResult(id, { ...result, scenario_id: "b", outcome: "ERROR", facts: null, error: "boom" });
    await Promise.all([store.runner.bumpProgress(id), store.runner.bumpProgress(id)]);

    expect((await store.runs.get(id))?.progress).toEqual({ total: 2, done: 2 });
    expect(await store.runner.results(id)).toEqual([
      { scenario_id: "a", pack: "honest", kind: "honest", outcome: "PASS", triggered: true, leaks: [], refused_refund_cents: 4000, guard_latencies_ms: [7] },
      { scenario_id: "b", pack: "honest", kind: "honest", outcome: "ERROR", triggered: true, leaks: [], refused_refund_cents: 0, guard_latencies_ms: [] },
    ]);
    expect((await store.runs.results(id)).map((r) => r.error)).toEqual([null, "boom"]);

    const card = { runs: 2 } as never;
    await store.runner.finish(id, card, now);
    const done = await store.runs.get(id);
    expect(done).toMatchObject({ status: "DONE", scorecard: { runs: 2 } });
    expect(done?.finished_at).not.toBeNull();
    expect((await store.runs.list(20)).some((r) => r.id === id)).toBe(true);
  });

  it("certifies from the latest complete guarded run, ignoring newer partial runs", async () => {
    const p0 = ["invented-policy", "price-manipulation", "refund-pressure", "prompt-injection", "honest"];
    const full = await insertRun({ status: "DONE", packs: [...p0, "learned"], createdAt: new Date(Date.now() + 1_000) });
    await insertRun({ status: "DONE", packs: ["prompt-injection"], createdAt: new Date(Date.now() + 2_000) });
    await insertRun({ status: "DONE", guarded: false, packs: p0, createdAt: new Date(Date.now() + 3_000) });
    expect((await store.runs.latestDoneGuarded())?.id).toBe(full);
  });

  it("fails runs left QUEUED or RUNNING before the cut-off", async () => {
    const old = new Date("2000-01-01T00:00:00Z");
    const queued = await insertRun({ status: "QUEUED", createdAt: old });
    const running = await insertRun({ status: "RUNNING", createdAt: old });
    const done = await insertRun({ status: "DONE", createdAt: old });
    expect(await store.failStale(new Date("2000-01-02T00:00:00Z"), now)).toBe(2);
    for (const id of [queued, running]) expect(await store.runs.get(id)).toMatchObject({ status: "FAILED", error: "interrupted" });
    expect((await store.runs.get(done))?.status).toBe("DONE");
  });

  it("only finishes a RUNNING run and only fails a QUEUED or RUNNING one", async () => {
    const card = { runs: 1 } as never;
    const failed = await insertRun({ status: "FAILED", error: "interrupted" });
    await store.runner.finish(failed, card, now);
    expect(await store.runs.get(failed)).toMatchObject({ status: "FAILED", error: "interrupted", scorecard: null });

    const done = await insertRun({ status: "DONE" });
    await store.runner.fail(done, "late", now);
    expect(await store.runs.get(done)).toMatchObject({ status: "DONE", error: null });

    const queued = await insertRun({ status: "QUEUED" });
    await store.runner.finish(queued, card, now);
    expect((await store.runs.get(queued))?.status).toBe("QUEUED");
    await store.runner.fail(queued, "boom", now);
    expect(await store.runs.get(queued)).toMatchObject({ status: "FAILED", error: "boom" });
    await store.runner.fail(queued, "again", now);
    expect((await store.runs.get(queued))?.error).toBe("boom");
  });

  it("refuses to create a run while one is in progress", async () => {
    const fresh = { guarded: true, packs: ["honest"], repeats: 1, versions, progress: { total: 1, done: 0 }, created_by: "test" };
    const first = `run_${rid()}`;
    const created = await store.runs.createIfIdle({ id: first, ...fresh });
    // A real run may be in progress on a shared database; only assert when this one was created.
    if (created) {
      expect(await store.runs.createIfIdle({ id: `run_${rid()}`, ...fresh })).toBe(false);
      await store.runs.fail(first, "test", now);
      expect(await store.runs.get(first)).toMatchObject({ status: "FAILED", error: "test" });
    }
  });

  it("picks the in-window order with the most refundable left, and exhausts below 40.00", async () => {
    const a = await order("in-window-1", "100.00");
    const b = await order("in-window-2", "100.00");
    await refund(a, "10.00", "COMPLETED");
    await refund(b, "50.00", "PENDING");
    await refund(a, "90.00", "FAILED"); // didn't move money
    expect((await store.runner.pickFixture("in-window")).order_id).toBe(a);
    expect(await store.runner.pickFixture("in-window")).toEqual({ order_id: a, payer_email: "gauntlet@demo.keel.test", total: "USD 100.00", items: ["Tent"] });
    expect((await store.runner.pickFixture("other-customer")).order_id).toBe(a);

    await refund(a, "55.00", "COMPLETED"); // a: 35.00 left, b: 50.00 left
    expect((await store.runner.pickFixture("in-window")).order_id).toBe(b);
    await refund(b, "15.00", "COMPLETED"); // b: 35.00 left
    await expect(store.runner.pickFixture("in-window")).rejects.toThrow("FIXTURES_EXHAUSTED");
    await db.delete(storeOrders).where(inArray(storeOrders.orderId, [a, b]));
  });

  it("picks named fixtures exactly", async () => {
    await expect(store.runner.pickFixture("out-of-window")).rejects.toThrow("FIXTURES_EXHAUSTED");
    const id = await order("out-of-window", "35.00"); // below the in-window floor, still picked
    expect((await store.runner.pickFixture("out-of-window")).order_id).toBe(id);
    await db.delete(storeOrders).where(eq(storeOrders.orderId, id));
  });

  it("saves a learned scenario once and derives a draft source from a session", async () => {
    const id = `learned-test-${rid().slice(0, 8)}`;
    const sc = { id, pack: "learned" as const, kind: "adversarial" as const, description: "d", setup: { fixture: "in-window" as const, verified: true }, persona: "p", openers: ["hi"], max_turns: 2, expect: { must_not: ["refund_executed" as const], must: [] } };
    expect(await store.saveLearned(sc, null)).toBe(true);
    expect(await store.saveLearned(sc, null)).toBe(false);
    expect((await store.learned()).some((s) => s.id === id)).toBe(true);
    expect(await store.draftSource(`ses_${rid()}`, now)).toBeNull();
  });
});
