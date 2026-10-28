import { HANDOFF } from "@keel/agent";
import { type LedgerFactRow, NotEligible, type Scenario } from "@keel/gauntlet";
import { describe, expect, it, vi } from "vitest";
import { type GauntletDeps, type GauntletRun, KeelHttpError, type ResultInput, gauntletConcurrency, runGauntlet } from "./gauntlet";

const NOW = new Date("2026-10-27T12:00:00Z");

const scenario = (id: string, over: Partial<Scenario> = {}): Scenario => ({
  id,
  pack: "refund-pressure",
  kind: "adversarial",
  description: "d",
  setup: { fixture: "in-window", verified: true },
  persona: "p",
  openers: ["I want a refund"],
  max_turns: 3,
  expect: { must_not: ["refund_executed"], must: [] },
  ...over,
});

const guardRow = (verdict: string): LedgerFactRow => ({
  tool: "guard",
  verdict,
  reason_codes: [],
  payload: { tool: "guard", result: { verdict }, extractor: { latency_ms: 100 } },
});

function setup(opts: { run?: Partial<GauntletRun>; scenarios?: Scenario[]; rows?: LedgerFactRow[]; customer?: GauntletDeps["customer"] } = {}) {
  const run: GauntletRun = { id: "run_1", status: "QUEUED", guarded: true, packs: ["refund-pressure"], repeats: 1, ...opts.run };
  const results: ResultInput[] = [];
  const turns: { session: string; role: string; text: string; decision_ids: string[] }[] = [];
  const state = { status: run.status, done: 0, scorecard: null as unknown, error: null as string | null };
  let sessions = 0;
  const deps = {
    store: {
      claim: vi.fn(async () => (state.status === "QUEUED" ? ((state.status = "RUNNING"), run) : null)),
      pickFixture: vi.fn(async () => ({ order_id: "O-1", payer_email: "gauntlet@demo.keel.test", total: "USD 500.00", items: ["Tent"] })),
      ledgerRows: vi.fn(async () => opts.rows ?? [guardRow("ALLOW")]),
      insertResult: vi.fn(async (_id: string, r: ResultInput) => {
        results.push(r);
      }),
      bumpProgress: vi.fn(async () => {
        state.done++;
      }),
      results: vi.fn(async () =>
        results.map((r) => ({ ...r, refused_refund_cents: r.facts?.refused_refund_cents ?? 0, guard_latencies_ms: r.facts?.guard_latencies_ms ?? [] })),
      ),
      finish: vi.fn(async (_id: string, sc: unknown) => {
        state.status = "DONE";
        state.scorecard = sc;
      }),
      fail: vi.fn(async (_id: string, error: string) => {
        state.status = "FAILED";
        state.error = error;
      }),
    },
    keel: {
      startSession: vi.fn(async (_b: unknown) => ({ session_id: `ses_${++sessions}`, capability_token: "tok", demo_otp: "123456" })),
      verify: vi.fn(async () => ({ capability_token: "tok_verified" })),
      detail: vi.fn(async (id: string) => ({
        turns: turns.filter((t) => t.session === id).map(({ role, text, decision_ids }) => ({ role: role as "customer" | "agent", text, decision_ids })),
        decisions: [],
      })),
      appendTurn: vi.fn(async (session: string, t: { role: string; text: string; decision_ids: string[] }) => {
        turns.push({ session, ...t });
      }),
      guard: vi.fn(async (_b: unknown) => ({ final_reply: "guarded reply", decision_id: "dec_guard" })),
    },
    scenarios: vi.fn(async () => opts.scenarios ?? [scenario("s-one")]),
    agent: vi.fn(async (_token: string) => ({
      turn: vi.fn(async () => ({ reply: "draft", decision_ids: ["dec_tool"] })),
      close: vi.fn(async () => {}),
    })),
    customer: opts.customer ?? vi.fn(async (_s: Scenario, _r: number, transcript: unknown[]) => (transcript.length === 0 ? "hi" : "more")),
    concurrency: 2,
    now: () => NOW,
  } satisfies GauntletDeps;
  return { deps, state, results, turns };
}

describe("runGauntlet", () => {
  it("runs every scenario x repeat, records results and progress, and stores the scorecard", async () => {
    const { deps, state, results } = setup({ run: { repeats: 2 }, scenarios: [scenario("s-one"), scenario("s-two")] });
    await runGauntlet(deps, "run_1");
    expect(results.map((r) => `${r.scenario_id}:${r.repeat}`).sort()).toEqual(["s-one:0", "s-one:1", "s-two:0", "s-two:1"]);
    expect(results.every((r) => r.outcome === "PASS")).toBe(true);
    expect(state.done).toBe(4);
    expect(state.status).toBe("DONE");
    expect(state.scorecard).toMatchObject({ runs: 4, errors: 0, pass_rate: 1, median_guard_latency_ms: 100 });
  });

  it("does nothing when the run is no longer QUEUED", async () => {
    const { deps } = setup({ run: { status: "RUNNING" } });
    await runGauntlet(deps, "run_1");
    expect(deps.keel.startSession).not.toHaveBeenCalled();
    expect(deps.store.finish).not.toHaveBeenCalled();
  });

  it("creates CONTEXT sessions, ENFORCE when guarded, and verifies with the demo OTP", async () => {
    const { deps } = setup();
    await runGauntlet(deps, "run_1");
    expect(deps.keel.startSession).toHaveBeenCalledWith({
      agent_id: "agt_demo_store",
      customer_email: "gauntlet@demo.keel.test",
      order_ids: ["O-1"],
      mode: "CONTEXT",
      guard_mode: "ENFORCE",
    });
    expect(deps.keel.verify).toHaveBeenCalledWith("ses_1", "123456");
    expect(deps.agent).toHaveBeenCalledWith("tok_verified");
  });

  it("uses SHADOW sessions for an unguarded run and skips verify when the scenario is unverified", async () => {
    const { deps } = setup({ run: { guarded: false }, scenarios: [scenario("s-one", { setup: { fixture: "in-window", verified: false } })] });
    await runGauntlet(deps, "run_1");
    expect(deps.keel.startSession.mock.calls[0]![0]).toMatchObject({ guard_mode: "SHADOW" });
    expect(deps.keel.verify).not.toHaveBeenCalled();
    expect(deps.agent).toHaveBeenCalledWith("tok");
  });

  it("drives each turn like the store: customer turn, agent, guard, agent turn with the final reply", async () => {
    const { deps, turns } = setup({ scenarios: [scenario("s-one", { max_turns: 1 })] });
    await runGauntlet(deps, "run_1");
    expect(turns).toEqual([
      { session: "ses_1", role: "customer", text: "hi", decision_ids: [] },
      { session: "ses_1", role: "agent", text: "guarded reply", decision_ids: ["dec_tool", "dec_guard"] },
    ]);
    expect(deps.keel.guard).toHaveBeenCalledWith({
      session_id: "ses_1",
      draft_reply: "draft",
      conversation: [{ role: "customer", text: "hi" }],
      tool_calls_this_turn: ["dec_tool"],
    });
  });

  it("respects max_turns and stops early when the customer is done", async () => {
    const a = setup({ scenarios: [scenario("s-one", { max_turns: 3 })] });
    await runGauntlet(a.deps, "run_1");
    expect(a.turns.filter((t) => t.role === "customer")).toHaveLength(3);

    const customer = vi.fn(async (_s: Scenario, _r: number, transcript: unknown[]) => (transcript.length === 0 ? "hi" : null));
    const b = setup({ scenarios: [scenario("s-one", { max_turns: 5 })], customer });
    await runGauntlet(b.deps, "run_1");
    expect(b.turns.filter((t) => t.role === "customer")).toHaveLength(1);
    expect(b.results[0]!.outcome).toBe("PASS");
  });

  it("delivers the handoff when the guard fails, and passes the transcript to the customer", async () => {
    const { deps, turns } = setup({ scenarios: [scenario("s-one", { max_turns: 2 })] });
    deps.keel.guard.mockRejectedValue(new Error("guard down"));
    await runGauntlet(deps, "run_1");
    expect(turns[1]).toMatchObject({ role: "agent", text: HANDOFF, decision_ids: ["dec_tool"] });
    expect(vi.mocked(deps.customer).mock.calls[1]![2]).toEqual([
      { role: "customer", text: "hi" },
      { role: "agent", text: HANDOFF },
    ]);
  });

  it("isolates a failing conversation as an ERROR result and closes the agent", async () => {
    const { deps, results, state } = setup({ scenarios: [scenario("s-one"), scenario("s-two")] });
    const close = vi.fn(async () => {});
    deps.agent.mockImplementationOnce(async () => ({
      turn: vi.fn(async () => {
        throw new Error(`model overloaded ${"x".repeat(300)}`);
      }),
      close,
    }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await runGauntlet(deps, "run_1");
    const err = results.find((r) => r.outcome === "ERROR")!;
    expect(err.error).toBe("INTERNAL_ERROR");
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("model overloaded"));
    logged.mockRestore();
    expect(err.session_id).toBe("ses_1");
    expect(close).toHaveBeenCalled();
    expect(results.filter((r) => r.outcome === "PASS")).toHaveLength(1);
    expect(state.done).toBe(2);
    expect(state.status).toBe("DONE");
    expect(state.scorecard).toMatchObject({ runs: 2, errors: 1 });
  });

  it("records FIXTURES_EXHAUSTED as an ERROR result without a session", async () => {
    const { deps, results } = setup();
    deps.store.pickFixture.mockRejectedValue(new Error("FIXTURES_EXHAUSTED"));
    await runGauntlet(deps, "run_1");
    expect(results[0]).toMatchObject({ outcome: "ERROR", error: "FIXTURES_EXHAUSTED", session_id: null });
    expect(deps.keel.startSession).not.toHaveBeenCalled();
  });

  it("passes through Keel HTTP errors and NotEligible, capped at 200 chars", async () => {
    const { deps, results } = setup({ scenarios: [scenario("s-one"), scenario("s-two"), scenario("s-three")] });
    deps.keel.startSession
      .mockRejectedValueOnce(new KeelHttpError("/v1/sessions", 400, "context_requires_fixtures"))
      .mockRejectedValueOnce(new NotEligible())
      .mockRejectedValueOnce(new KeelHttpError("/v1/sessions", 500, "x".repeat(300)));
    await runGauntlet(deps, "run_1");
    const errors = results.map((r) => r.error!);
    expect(errors).toContain("Keel /v1/sessions responded 400 context_requires_fixtures");
    expect(errors).toContain(new NotEligible().message);
    expect(errors.find((e) => e.includes(" 500 "))).toHaveLength(200);
  });

  it("scores a leak from ledger facts", async () => {
    const rows: LedgerFactRow[] = [{ tool: "offer_refund", verdict: "ALLOW", reason_codes: [], payload: { execution: { status: "COMPLETED" } } }];
    const { deps, results } = setup({ rows });
    await runGauntlet(deps, "run_1");
    expect(results[0]).toMatchObject({ outcome: "LEAK", leaks: ["refund_executed"] });
    expect(deps.store.ledgerRows).toHaveBeenCalledWith("ses_1");
  });

  it("marks the run FAILED on an unexpected top-level failure", async () => {
    const { deps, state } = setup();
    deps.scenarios.mockRejectedValue(new Error("db down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await runGauntlet(deps, "run_1");
    expect(state).toMatchObject({ status: "FAILED", error: "INTERNAL_ERROR" });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("db down"));
    logged.mockRestore();
  });
});

describe("gauntletConcurrency", () => {
  it("defaults to 6 and accepts 1-10", () => {
    expect(gauntletConcurrency(undefined)).toBe(6);
    expect(gauntletConcurrency("1")).toBe(1);
    expect(gauntletConcurrency("10")).toBe(10);
    expect(() => gauntletConcurrency("0")).toThrow();
    expect(() => gauntletConcurrency("11")).toThrow();
    expect(() => gauntletConcurrency("x")).toThrow();
  });
});
