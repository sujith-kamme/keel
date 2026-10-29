import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { type OverviewOptions, mountOverview } from "./overview";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const auth = (key: string) => ({ authorization: `Bearer ${key}` });
const NOW = new Date("2026-10-28T12:00:00Z");

const money = { blocked_refunds: "100.00", denied_holds: "45.00", disputes_won: "10.00", total: "155.00" };
const row = {
  decision_id: "dec_1",
  session_id: "ses_1",
  order_id: "O-1",
  capture_id: null,
  dispute_id: null,
  mode: "LIVE" as const,
  verdict: "BLOCK" as const,
  reason_codes: ["OUTSIDE_WINDOW" as const],
  payload: { tool: "offer_refund", args: { amount: "35.00" } },
  hash: "h1",
  prev_hash: "h0",
  seq: 7,
  created_at: NOW,
};
const cert = { status: "CERTIFIED", run_id: "run_1", reasons: [], current_versions: {} };

function setup(over: Partial<OverviewOptions> = {}) {
  const violations = vi.fn<OverviewOptions["violations"]>(async (since) => ({ total: since ? 2 : 5, byReason: [{ code: "OUTSIDE_WINDOW", count: 3 }] }));
  const dollarsProtected = vi.fn<OverviewOptions["dollarsProtected"]>(async (since) => (since ? { ...money, total: "45.00" } : money));
  const app = new Hono();
  mountOverview(app, {
    operatorKey,
    merchantKey,
    certification: async () => cert,
    run: async () => null,
    sessions: async () => ({ active: 3, quarantined: 1 }),
    violations,
    dollarsProtected,
    decisionsByDay: async () => [{ day: "2026-10-28", ALLOW: 4, REWRITE: 1, BLOCK: 2, HOLD: 1 }],
    disputes: async () => ({ OPEN: 1, WON: 1, LOST: 0, CONCEDED: 2, amount_won: "10.00", amount_conceded: "5.00" }),
    recent: async () => [row],
    now: () => NOW,
    ...over,
  });
  return { app, violations, dollarsProtected };
}

describe("overview route", () => {
  it("needs the operator key", async () => {
    const { app } = setup();
    expect((await app.request("/v1/overview")).status).toBe(401);
    expect((await app.request("/v1/overview", { headers: auth(merchantKey) })).status).toBe(403);
  });

  it("combines certification, sessions, violations, dollars, decisions, disputes and recent activity", async () => {
    const { app, violations, dollarsProtected } = setup();
    const res = await app.request("/v1/overview", { headers: auth(operatorKey) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      certification: cert,
      sessions: { active: 3, quarantined: 1 },
      violations: { all_time: { total: 5, byReason: [{ code: "OUTSIDE_WINDOW", count: 3 }] }, last_7_days: { total: 2, byReason: [{ code: "OUTSIDE_WINDOW", count: 3 }] } },
      dollars_protected: { all_time: money, last_7_days: { ...money, total: "45.00" } },
      decisions_by_day: [{ day: "2026-10-28", ALLOW: 4, REWRITE: 1, BLOCK: 2, HOLD: 1 }],
      disputes: { OPEN: 1, WON: 1, LOST: 0, CONCEDED: 2, amount_won: "10.00", amount_conceded: "5.00" },
      recent_activity: [{ ...row, created_at: NOW.toISOString(), tool: "offer_refund", amount: "35.00" }],
    });
    const weekAgo = new Date("2026-10-21T12:00:00Z");
    expect(violations).toHaveBeenCalledWith();
    expect(violations).toHaveBeenCalledWith(weekAgo);
    expect(dollarsProtected).toHaveBeenCalledWith(weekAgo);
  });

  it("adds the certifying run's leaks, conversation count and finish time", async () => {
    const run = vi.fn<OverviewOptions["run"]>(async () => ({ scorecard: { leaks: 0, runs: 51 }, finished_at: "2026-10-28T10:00:00.000Z" }));
    const { app } = setup({ run });
    const body = (await (await app.request("/v1/overview", { headers: auth(operatorKey) })).json()) as { certification: unknown };
    expect(body.certification).toEqual({ ...cert, leaks: 0, scenarios: 51, finished_at: "2026-10-28T10:00:00.000Z" });
    expect(run).toHaveBeenCalledWith("run_1");
  });

  it("leaves the run stats out when there is no certifying run", async () => {
    const run = vi.fn<OverviewOptions["run"]>();
    const none = { status: "NOT_CERTIFIED", run_id: null, reasons: ["no guarded run"] };
    const { app } = setup({ certification: async () => none, run });
    const body = (await (await app.request("/v1/overview", { headers: auth(operatorKey) })).json()) as { certification: unknown };
    expect(body.certification).toEqual(none);
    expect(run).not.toHaveBeenCalled();
  });

  it("still answers when certification fails", async () => {
    const { app } = setup({ certification: async () => Promise.reject(new Error("redis down")) });
    const res = await app.request("/v1/overview", { headers: auth(operatorKey) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { certification: unknown; sessions: unknown };
    expect(body.certification).toBeNull();
    expect(body.sessions).toEqual({ active: 3, quarantined: 1 });
  });
});
