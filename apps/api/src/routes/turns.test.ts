import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type DecisionSummary, type SessionRow, type Turn, type TurnOptions, type TurnStore, mountTurns } from "./turns";

const merchantKey = "m".repeat(32);
const now = new Date("2026-10-27T12:00:00Z");
const auth = { authorization: `Bearer ${merchantKey}`, "content-type": "application/json" };

const session = (id: string, expires_at: string, mode: SessionRow["mode"] = "LIVE", state = "ACTIVE"): SessionRow => ({
  id,
  agent_id: "demo",
  claimed_email: "maya@demo.keel.test",
  verified: true,
  order_ids: ["O-1"],
  state,
  mode,
  created_at: "2026-10-27T11:30:00.000Z",
  expires_at,
  decision_count: 2,
  last_turn_at: null,
});

const detail = { score: 40, threshold: 60, signals: [{ kind: "INJECTION", weight: 40, at: "2026-10-27T11:45:00.000Z" }] };

function setup(
  riskDetail: () => Promise<typeof detail> = async () => detail,
  scores: TurnOptions["scores"] = async () => new Map(),
) {
  const sessions = [
    session("ses_live", "2026-10-27T12:30:00.000Z"),
    session("ses_old", "2026-10-27T11:59:00.000Z", "LIVE", "QUARANTINED"),
    session("ses_third", "2026-10-27T12:30:00.000Z"),
    session("ses_ctx", "2026-10-27T12:30:00.000Z", "CONTEXT"),
  ];
  const turns: (Turn & { sessionId: string })[] = [];
  const decisions: DecisionSummary[] = [];
  const store: TurnStore = {
    listSessions: async ({ limit, mode, state, before }) => {
      const from = before === undefined ? 0 : sessions.findIndex((s) => s.id === before) + 1 || sessions.length;
      return sessions
        .slice(from)
        .filter((s) => (mode === "all" || s.mode === mode) && (state === undefined || s.state === state))
        .slice(0, limit);
    },
    session: async (id) => sessions.find((s) => s.id === id) ?? null,
    turns: async (id) => turns.filter((t) => t.sessionId === id),
    decisions: async () => decisions,
    appendTurn: async (t) => void turns.push({ sessionId: t.sessionId, role: t.role, text: t.text, decision_ids: t.decisionIds, agent_id: t.agentId, created_at: now.toISOString() }),
    customerTurnCount: async (id) => turns.filter((t) => t.sessionId === id && t.role === "customer").length,
  };
  const app = new Hono();
  mountTurns(app, { merchantKey, store, now: () => now, riskDetail, scores });
  return { app, turns };
}

const post = (app: Hono, id: string, body: unknown) =>
  app.request(`/v1/sessions/${id}/turns`, { method: "POST", headers: auth, body: JSON.stringify(body) });
const valid = { role: "customer", text: "hi", decision_ids: [] };

describe("turns API", () => {
  it("rejects a missing or wrong merchant key on every route", async () => {
    const { app } = setup();
    for (const headers of [{}, { authorization: `Bearer ${"x".repeat(32)}` }] as Record<string, string>[]) {
      const calls = [
        app.request("/v1/sessions", { headers }),
        app.request("/v1/sessions/ses_live", { headers }),
        app.request("/v1/sessions/ses_live/turns", { method: "POST", headers, body: JSON.stringify(valid) }),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
      }
    }
  });

  it("lists sessions and honours limit", async () => {
    const { app } = setup();
    const res = await app.request("/v1/sessions?limit=2", { headers: auth });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sessions: unknown[] }).sessions).toHaveLength(2);
    expect(((await (await app.request("/v1/sessions", { headers: auth })).json()) as { sessions: unknown[] }).sessions).toHaveLength(3);
    const text = JSON.stringify(await (await app.request("/v1/sessions", { headers: auth })).json());
    for (const key of ["otp_hash", "otp_attempts", "otpHash"]) expect(text).not.toContain(key);
  });

  it("adds each row's risk score from one batched lookup, null when unknown or the lookup fails", async () => {
    const calls: string[][] = [];
    const { app } = setup(undefined, async (ids) => {
      calls.push(ids);
      return new Map([["ses_live", 25]]);
    });
    type Row = { id: string; risk_score: number | null; order_ids: string[]; decision_count: number; last_turn_at: string | null };
    const rows = ((await (await app.request("/v1/sessions", { headers: auth })).json()) as { sessions: Row[] }).sessions;
    expect(calls).toEqual([["ses_live", "ses_old", "ses_third"]]);
    expect(rows.map((r) => [r.id, r.risk_score])).toEqual([["ses_live", 25], ["ses_old", null], ["ses_third", null]]);
    expect(rows[0]).toMatchObject({ order_ids: ["O-1"], decision_count: 2, last_turn_at: null });
    const down = setup(undefined, async () => {
      throw new Error("db down");
    });
    const res = await down.app.request("/v1/sessions", { headers: auth });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sessions: Row[] }).sessions.every((r) => r.risk_score === null)).toBe(true);
  });

  it("pages with the before cursor and returns next_before only for a full page", async () => {
    const { app } = setup();
    const page = async (q: string) => (await (await app.request(`/v1/sessions${q}`, { headers: auth })).json()) as { sessions: { id: string }[]; next_before: string | null };
    const first = await page("?limit=2");
    expect(first.sessions.map((s) => s.id)).toEqual(["ses_live", "ses_old"]);
    expect(first.next_before).toBe("ses_old");
    const second = await page(`?limit=2&before=${first.next_before}`);
    expect(second.sessions.map((s) => s.id)).toEqual(["ses_third"]);
    expect(second.next_before).toBeNull();
    expect((await app.request("/v1/sessions?before=bad%20id", { headers: auth })).status).toBe(400);
  });

  it("filters sessions by state", async () => {
    const { app } = setup();
    const body = (await (await app.request("/v1/sessions?state=QUARANTINED", { headers: auth })).json()) as { sessions: { id: string }[] };
    expect(body.sessions.map((s) => s.id)).toEqual(["ses_old"]);
    expect((await app.request("/v1/sessions?state=bogus", { headers: auth })).status).toBe(400);
  });

  it("filters sessions by mode, defaulting to LIVE", async () => {
    const { app } = setup();
    const ids = async (q: string) =>
      ((await (await app.request(`/v1/sessions${q}`, { headers: auth })).json()) as { sessions: { id: string; mode: string }[] }).sessions.map((s) => `${s.id}:${s.mode}`);
    expect(await ids("")).toEqual(["ses_live:LIVE", "ses_old:LIVE", "ses_third:LIVE"]);
    expect(await ids("?mode=CONTEXT")).toEqual(["ses_ctx:CONTEXT"]);
    expect(await ids("?mode=all")).toHaveLength(4);
    expect((await app.request("/v1/sessions?mode=bogus", { headers: auth })).status).toBe(400);
  });

  it("returns mode in session detail", async () => {
    const { app } = setup();
    const body = (await (await app.request("/v1/sessions/ses_ctx", { headers: auth })).json()) as { session: { mode: string } };
    expect(body.session.mode).toBe("CONTEXT");
  });

  it.each(["0", "101", "abc"])("rejects limit=%s", async (limit) => {
    const { app } = setup();
    const res = await app.request(`/v1/sessions?limit=${limit}`, { headers: auth });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("returns 404 for an unknown session", async () => {
    const { app } = setup();
    const res = await app.request("/v1/sessions/nope", { headers: auth });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns session detail without OTP fields, even when expired", async () => {
    const { app } = setup();
    const res = await app.request("/v1/sessions/ses_old", { headers: auth });
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("ses_old");
    for (const key of ["otp_hash", "otp_attempts", "otpHash"]) expect(text).not.toContain(key);
  });

  it("includes session risk, and null when the risk lookup fails", async () => {
    const ok = await (await setup().app.request("/v1/sessions/ses_live", { headers: auth })).json();
    expect((ok as { risk: unknown }).risk).toEqual(detail);
    const down = setup(async () => {
      throw new Error("db down");
    });
    const res = await down.app.request("/v1/sessions/ses_live", { headers: auth });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { risk: unknown }).risk).toBeNull();
  });

  it.each([
    ["bad role", { ...valid, role: "system" }],
    ["empty text", { ...valid, text: "" }],
    ["4001-char text", { ...valid, text: "a".repeat(4001) }],
    ["malformed decision id", { ...valid, decision_ids: ["nope"] }],
    ["unknown agent id", { ...valid, role: "agent", agent_id: "agt_demo_store" }],
  ])("rejects %s", async (_, body) => {
    const { app } = setup();
    const res = await post(app, "ses_live", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("appends a turn and returns 201", async () => {
    const { app, turns } = setup();
    const res = await post(app, "ses_live", { ...valid, decision_ids: ["dec_abc123"] });
    expect(res.status).toBe(201);
    expect(turns).toHaveLength(1);
  });

  it("stores the agent id on agent turns only", async () => {
    const { app, turns } = setup();
    expect((await post(app, "ses_live", { ...valid, role: "agent", agent_id: "agt_refund" })).status).toBe(201);
    expect((await post(app, "ses_live", { ...valid, agent_id: "agt_refund" })).status).toBe(201);
    expect((await post(app, "ses_live", { ...valid, role: "agent" })).status).toBe(201);
    expect(turns.map((t) => t.agent_id)).toEqual(["agt_refund", null, null]);
  });

  it("returns 404 when appending to an expired or unknown session", async () => {
    const { app } = setup();
    expect((await post(app, "ses_old", valid)).status).toBe(404);
    expect((await post(app, "nope", valid)).status).toBe(404);
  });

  it("limits customer turns to 30 but not agent turns", async () => {
    const { app } = setup();
    for (let i = 0; i < 30; i++) expect((await post(app, "ses_live", valid)).status).toBe(201);
    const res = await post(app, "ses_live", valid);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "turn_limit" });
    expect((await post(app, "ses_live", { ...valid, role: "agent" })).status).toBe(201);
  });
});
