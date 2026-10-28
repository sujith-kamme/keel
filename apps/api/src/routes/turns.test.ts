import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type DecisionSummary, type SessionSummary, type Turn, type TurnStore, mountTurns } from "./turns";

const merchantKey = "m".repeat(32);
const now = new Date("2026-10-27T12:00:00Z");
const auth = { authorization: `Bearer ${merchantKey}`, "content-type": "application/json" };

const session = (id: string, expires_at: string, mode: SessionSummary["mode"] = "LIVE"): SessionSummary => ({
  id,
  agent_id: "demo",
  claimed_email: "maya@demo.keel.test",
  verified: true,
  state: "ACTIVE",
  mode,
  created_at: "2026-10-27T11:30:00.000Z",
  expires_at,
});

const detail = { score: 40, threshold: 60, signals: [{ kind: "INJECTION", weight: 40, at: "2026-10-27T11:45:00.000Z" }] };

function setup(riskDetail: () => Promise<typeof detail> = async () => detail) {
  const sessions = [
    session("ses_live", "2026-10-27T12:30:00.000Z"),
    session("ses_old", "2026-10-27T11:59:00.000Z"),
    session("ses_third", "2026-10-27T12:30:00.000Z"),
    session("ses_ctx", "2026-10-27T12:30:00.000Z", "CONTEXT"),
  ];
  const turns: (Turn & { sessionId: string })[] = [];
  const decisions: DecisionSummary[] = [];
  const store: TurnStore = {
    listSessions: async (limit, mode) => sessions.filter((s) => mode === "all" || s.mode === mode).slice(0, limit),
    session: async (id) => sessions.find((s) => s.id === id) ?? null,
    turns: async (id) => turns.filter((t) => t.sessionId === id),
    decisions: async () => decisions,
    appendTurn: async (t) => void turns.push({ sessionId: t.sessionId, role: t.role, text: t.text, decision_ids: t.decisionIds, created_at: now.toISOString() }),
    customerTurnCount: async (id) => turns.filter((t) => t.sessionId === id && t.role === "customer").length,
  };
  const app = new Hono();
  mountTurns(app, { merchantKey, store, now: () => now, riskDetail });
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
