import { describe, expect, it } from "vitest";
import { canLearn, certBadge, draftErrorMessage, isRunId, outcomeBadge, packStats, parseEdits, parseStart, pct, pickBeforeAfter, progressPct, runOutcome, saveErrorMessage, startErrorMessage, type Run, type RunResult, type Scorecard } from "./context-view";

const sc = { runs: 1, errors: 0, pass_rate: 1, leaks: 0, leaks_by_type: {}, false_positive_rate: 0, trigger_rate: 1, dollars_protected: "0.00", median_guard_latency_ms: 1, packs: [] } as Scorecard;
const run = (id: string, over: Partial<Run>): Run =>
  ({ id, status: "DONE", guarded: true, packs: [], repeats: 1, progress: { total: 1, done: 1 }, scorecard: sc, error: null, created_at: "x", finished_at: null, ...over }) as Run;

describe("parseStart", () => {
  const ok = { packs: ["honest", "learned"], repeats: 3, guarded: true };
  it("accepts a valid request", () => expect(parseStart(ok)).toEqual(ok));
  it("rejects bad input", () => {
    expect(parseStart({ ...ok, packs: [] })).toBeNull();
    expect(parseStart({ ...ok, packs: ["nope"] })).toBeNull();
    expect(parseStart({ ...ok, packs: ["honest", "honest"] })).toBeNull();
    expect(parseStart({ ...ok, repeats: 6 })).toBeNull();
    expect(parseStart({ ...ok, repeats: 1.5 })).toBeNull();
    expect(parseStart({ ...ok, guarded: "yes" })).toBeNull();
    expect(parseStart(null)).toBeNull();
  });
});

describe("ids", () => {
  it("validates run ids", () => {
    expect(isRunId(`run_${"a".repeat(32)}`)).toBe(true);
    expect(isRunId("run_abc")).toBe(false);
    expect(isRunId(`run_${"A".repeat(32)}`)).toBe(false);
  });
});

describe("formatting", () => {
  it("formats rates", () => {
    expect(pct(0.857)).toBe("85.7%");
    expect(pct(1)).toBe("100%");
    expect(pct(null)).toBe("—");
  });
  it("labels outcomes and certification", () => {
    expect(outcomeBadge("PASS")).toEqual({ label: "Pass", tone: "ok" });
    expect(outcomeBadge("LEAK").tone).toBe("bad");
    expect(outcomeBadge("FALSE_POSITIVE").tone).toBe("warn");
    expect(outcomeBadge("WEIRD")).toEqual({ label: "WEIRD", tone: "" });
    expect(certBadge("STALE")).toEqual({ label: "Stale", tone: "warn" });
  });
  it("bounds progress", () => {
    expect(progressPct({ total: 0, done: 0 })).toBe(0);
    expect(progressPct({ total: 4, done: 1 })).toBe(25);
    expect(progressPct({ total: 4, done: 9 })).toBe(100);
  });
});

describe("pickBeforeAfter", () => {
  it("picks the newest DONE of each kind", () => {
    const runs = [run("a", { status: "RUNNING" }), run("b", { guarded: false }), run("c", {}), run("d", { guarded: false })];
    const p = pickBeforeAfter(runs);
    expect(p?.without.id).toBe("b");
    expect(p?.with.id).toBe("c");
  });
  it("needs both", () => expect(pickBeforeAfter([run("a", {})])).toBeNull());
});

describe("messages", () => {
  it("maps API errors", () => {
    expect(startErrorMessage(409)).toBe("A run is already in progress");
    expect(startErrorMessage(503)).toMatch(/try again/);
    expect(draftErrorMessage(404)).toBe("Session not found");
    expect(draftErrorMessage(422)).toBe("This session has nothing to learn from");
    expect(draftErrorMessage(502)).toMatch(/try again/);
    expect(saveErrorMessage(409)).toBe("A scenario with this id already exists");
    expect(saveErrorMessage(404)).toBe("The source session no longer exists");
    expect(saveErrorMessage(422)).toBe("This session has nothing to learn from");
  });
});

describe("parseEdits", () => {
  const ok = { persona: "p", description: "d", openers: ["hi"] };
  it("accepts and rejects", () => {
    expect(parseEdits(ok)).toEqual(ok);
    expect(parseEdits({ ...ok, persona: "x".repeat(601) })).toBeNull();
    expect(parseEdits({ ...ok, description: "x".repeat(501) })).toBeNull();
    expect(parseEdits({ ...ok, openers: [] })).toBeNull();
    expect(parseEdits({ ...ok, openers: ["a", "b", "c"] })).toBeNull();
    expect(parseEdits({ ...ok, openers: ["  "] })).toBeNull();
    expect(parseEdits({ ...ok, persona: 5 })).toBeNull();
  });
});

describe("canLearn", () => {
  it("offers flagged or blocked sessions", () => {
    expect(canLearn("QUARANTINED", [])).toBe(true);
    expect(canLearn("ACTIVE", ["ALLOW", "HOLD"])).toBe(true);
    expect(canLearn("ACTIVE", ["ALLOW", "REWRITE"])).toBe(false);
  });
});

describe("packStats", () => {
  const r = (pack: string, kind: string, outcome: string): RunResult => ({ scenario_id: "s", pack, kind, repeat: 0, session_id: null, outcome, triggered: true, leaks: [], error: null });
  it("counts per pack and rates passes over non-errors", () => {
    const stats = packStats([r("refund-pressure", "adversarial", "PASS"), r("refund-pressure", "adversarial", "LEAK"), r("refund-pressure", "adversarial", "ERROR"), r("honest", "honest", "FALSE_POSITIVE"), r("honest", "honest", "PASS")]);
    expect(stats.map((s) => s.pack)).toEqual(["honest", "refund-pressure"]);
    expect(stats[0]).toMatchObject({ conversations: 2, passed: 1, leaks: 0, falsePositives: 1, passRate: 0.5 });
    expect(stats[1]).toMatchObject({ conversations: 3, passed: 1, leaks: 1, falsePositives: null, errors: 1, passRate: 0.5 });
  });
  it("has no rate when every conversation errored", () => expect(packStats([r("honest", "honest", "ERROR")])[0]!.passRate).toBeNull());
});

describe("runOutcome", () => {
  const cert = { status: "CERTIFIED" as const, run_id: "c" };
  it("derives the history result", () => {
    expect(runOutcome(run("a", { status: "RUNNING", scorecard: null }), cert).label).toBe("Running");
    expect(runOutcome(run("a", { status: "FAILED", scorecard: null }), cert).label).toBe("Failed");
    expect(runOutcome(run("a", { scorecard: null }), cert).label).toBe("No scorecard");
    expect(runOutcome(run("a", { guarded: false, scorecard: { ...sc, leaks: 4 } }), cert).label).toBe("Baseline");
    expect(runOutcome(run("a", { scorecard: { ...sc, leaks: 1 } }), cert).label).toBe("Leak");
    expect(runOutcome(run("c", {}), cert).label).toBe("Certifies");
    expect(runOutcome(run("c", {}), { status: "STALE", run_id: "c" }).label).toBe("Certified, stale");
    expect(runOutcome(run("a", {}), cert).label).toBe("No leaks");
  });
});
