import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { type OverviewOptions, mountOverview } from "./overview";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const auth = (key: string) => ({ authorization: `Bearer ${key}` });
const NOW = new Date("2026-10-28T12:00:00Z");

const money = { blocked_refunds: "100.00", denied_holds: "45.00", disputes_won: "10.00", total: "155.00" };
const cert = { status: "CERTIFIED", run_id: "run_1", reasons: [], current_versions: {} };

function setup(over: Partial<OverviewOptions> = {}) {
  const violations = vi.fn<OverviewOptions["violations"]>(async (since) => ({ total: since ? 2 : 5, byReason: [{ code: "OUTSIDE_WINDOW", count: 3 }] }));
  const dollarsProtected = vi.fn<OverviewOptions["dollarsProtected"]>(async (since) => (since ? { ...money, total: "45.00" } : money));
  const app = new Hono();
  mountOverview(app, {
    operatorKey,
    merchantKey,
    certification: async () => cert,
    sessions: async () => ({ active: 3, quarantined: 1 }),
    violations,
    dollarsProtected,
    decisionsByDay: async () => [{ day: "2026-10-28", ALLOW: 4, REWRITE: 1, BLOCK: 2, HOLD: 1 }],
    disputes: async () => ({ OPEN: 1, WON: 1, LOST: 0, CONCEDED: 2, amount_won: "10.00", amount_conceded: "5.00" }),
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

  it("combines certification, sessions, violations, dollars, decisions and disputes", async () => {
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
    });
    const weekAgo = new Date("2026-10-21T12:00:00Z");
    expect(violations).toHaveBeenCalledWith();
    expect(violations).toHaveBeenCalledWith(weekAgo);
    expect(dollarsProtected).toHaveBeenCalledWith(weekAgo);
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
