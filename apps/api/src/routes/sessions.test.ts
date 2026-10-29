import { verifyToken } from "@keel/engine";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type SessionRow, type SessionStore, mountSessions } from "./sessions";

const merchantKey = "m".repeat(32);
const signingKey = "s".repeat(32);
const now = new Date("2026-10-27T12:00:00Z");
const GAUNTLET = "gauntlet@demo.keel.test";

function setup(demoOtp = true) {
  const rows = new Map<string, SessionRow>();
  const store: SessionStore = {
    customerOrders: async (ids, email) =>
      email === "maya@demo.keel.test" ? ids.filter((id) => id.startsWith("ORDER-")) : email === GAUNTLET ? ids.filter((id) => id.startsWith("CTX-")) : [],
    fixtureOrders: async (ids, email) => (email === GAUNTLET ? ids.filter((id) => id.startsWith("CTX-")) : []),
    create: async (row) => void rows.set(row.id, row),
    get: async (id) => rows.get(id) ?? null,
    reserveAttempt: async (id) => {
      const row = rows.get(id)!;
      if (row.otpAttempts >= 5) return false;
      rows.set(id, { ...row, otpAttempts: row.otpAttempts + 1 });
      return true;
    },
    markVerified: async (id, email) => {
      rows.set(id, { ...rows.get(id)!, verifiedPayer: email });
    },
  };
  const app = new Hono();
  mountSessions(app, { merchantKey, signingKey, demoOtp, gauntletPayer: GAUNTLET, store, now: () => now, newId: (p) => `${p}_1` });
  return { app, rows };
}

const post = (app: Hono, path: string, body: unknown, key: string | null = merchantKey) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });

const start = { agent_id: "agt_policy", customer_email: "Maya@demo.keel.test", order_ids: ["ORDER-1", "NOPE"] };
const fixture = { agent_id: "agt_policy", customer_email: "Gauntlet@demo.keel.test", order_ids: ["CTX-1"] };

describe("sessions API", () => {
  it.each([null, "wrong".repeat(8)])("rejects merchant key %j", async (key) => {
    const { app } = setup();
    expect((await post(app, "/v1/sessions", start, key)).status).toBe(401);
    expect((await post(app, "/v1/sessions/ses_1/verify", { code: "123456" }, key)).status).toBe(401);
  });

  it("starts an unverified session scoped to known orders", async () => {
    const { app } = setup();
    const res = await post(app, "/v1/sessions", start);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { capability_token: string; demo_otp: string; orders: string[] };
    expect(body.demo_otp).toMatch(/^\d{6}$/);
    expect(body.orders).toEqual(["ORDER-1"]);
    const cap = verifyToken(body.capability_token, signingKey, now);
    expect(cap).toMatchObject({ session_id: "ses_1", verified_payer: null, orders: ["ORDER-1"], max_refund_total: "100.00" });
  });

  it("omits the OTP when demo mode is off", async () => {
    const { app } = setup(false);
    const body = (await (await post(app, "/v1/sessions", start)).json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("demo_otp");
  });

  it("defaults to a LIVE session with an enforcing guard", async () => {
    const { app, rows } = setup();
    await post(app, "/v1/sessions", start);
    expect(rows.get("ses_1")).toMatchObject({ mode: "LIVE", guardMode: "ENFORCE" });
  });

  it("stores CONTEXT and SHADOW, and always returns the OTP for CONTEXT", async () => {
    const { app, rows } = setup(false);
    const res = await post(app, "/v1/sessions", { ...fixture, mode: "CONTEXT", guard_mode: "SHADOW" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { demo_otp: string; orders: string[] };
    expect(body.demo_otp).toMatch(/^\d{6}$/);
    expect(body.orders).toEqual(["CTX-1"]);
    expect(rows.get("ses_1")).toMatchObject({ mode: "CONTEXT", guardMode: "SHADOW", claimedEmail: GAUNTLET });
    const enforce = await post(app, "/v1/sessions", { ...fixture, mode: "CONTEXT" });
    expect(enforce.status).toBe(201);
    expect(rows.get("ses_1")).toMatchObject({ mode: "CONTEXT", guardMode: "ENFORCE" });
  });

  it.each([
    ["a real customer's orders", { ...start, mode: "CONTEXT" }],
    ["the Gauntlet payer with a non-fixture order", { ...fixture, order_ids: ["CTX-1", "ORDER-1"], mode: "CONTEXT" }],
    ["another email with fixture orders", { ...fixture, customer_email: "maya@demo.keel.test", mode: "CONTEXT" }],
  ])("rejects a CONTEXT session for %s and returns no OTP", async (_, req) => {
    const { app, rows } = setup(false);
    const res = await post(app, "/v1/sessions", req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "context_requires_fixtures" });
    expect(rows.size).toBe(0);
  });

  it("rejects SHADOW on a LIVE session and unknown modes", async () => {
    const { app, rows } = setup();
    expect((await post(app, "/v1/sessions", { ...start, guard_mode: "SHADOW" })).status).toBe(400);
    expect((await post(app, "/v1/sessions", { ...start, mode: "LIVE", guard_mode: "SHADOW" })).status).toBe(400);
    expect((await post(app, "/v1/sessions", { ...start, mode: "DEMO" })).status).toBe(400);
    expect((await post(app, "/v1/sessions", { ...start, guard_mode: "OFF" })).status).toBe(400);
    expect(rows.size).toBe(0);
  });

  it("rejects an invalid request", async () => {
    const { app } = setup();
    expect((await post(app, "/v1/sessions", { ...start, customer_email: "not-an-email" })).status).toBe(400);
  });

  it("verifies the claimed email with the right code and issues an upgraded token", async () => {
    const { app } = setup();
    const { demo_otp } = (await (await post(app, "/v1/sessions", start)).json()) as { demo_otp: string };
    const res = await post(app, "/v1/sessions/ses_1/verify", { code: demo_otp });
    expect(res.status).toBe(200);
    const { capability_token } = (await res.json()) as { capability_token: string };
    expect(verifyToken(capability_token, signingKey, now)?.verified_payer).toBe("maya@demo.keel.test");
  });

  it("locks after 5 wrong codes, even for the right code", async () => {
    const { app } = setup();
    const { demo_otp } = (await (await post(app, "/v1/sessions", start)).json()) as { demo_otp: string };
    const wrong = demo_otp === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const res = await post(app, "/v1/sessions/ses_1/verify", { code: wrong });
      expect(await res.json()).toEqual({ error: "wrong" });
    }
    const res = await post(app, "/v1/sessions/ses_1/verify", { code: demo_otp });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "locked" });
  });

  it("caps parallel guesses at 5 attempts", async () => {
    const { app, rows } = setup();
    const { demo_otp } = (await (await post(app, "/v1/sessions", start)).json()) as { demo_otp: string };
    const wrong = demo_otp === "000000" ? "111111" : "000000";
    const results = await Promise.all(Array.from({ length: 10 }, () => post(app, "/v1/sessions/ses_1/verify", { code: wrong })));
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.filter((b) => (b as { error: string }).error === "wrong")).toHaveLength(5);
    expect(rows.get("ses_1")?.otpAttempts).toBe(5);
  });

  it("returns 404 for an unknown session", async () => {
    const { app } = setup();
    expect((await post(app, "/v1/sessions/ses_missing/verify", { code: "123456" })).status).toBe(404);
  });

  it("starts a live session at the policy agent with only its tools, whatever agent_id is sent", async () => {
    const { app } = setup();
    const res = await post(app, "/v1/sessions", { ...start, agent_id: "agt_refund" });
    expect(res.status).toBe(201);
    const cap = verifyToken(((await res.json()) as { capability_token: string }).capability_token, signingKey, now)!;
    expect(cap.agent_id).toBe("agt_policy");
    expect(cap.allow).toEqual(["get_order", "state_policy", "escalate_to_human", "handoff_to_refund"]);
  });

  it("lets a CONTEXT session start at a registry agent and rejects unknown ones", async () => {
    const { app } = setup();
    const ctx = (agent_id: string) => post(app, "/v1/sessions", { ...fixture, agent_id, mode: "CONTEXT" });
    const ok = await ctx("agt_refund");
    expect(verifyToken(((await ok.json()) as { capability_token: string }).capability_token, signingKey, now)!.allow).toContain("offer_refund");
    expect((await ctx("agt_demo_store")).status).toBe(400);
  });

  it("POST /v1/sessions/:id/token mints for the session's current agent", async () => {
    const { app, rows } = setup();
    await post(app, "/v1/sessions", start);
    rows.get("ses_1")!.agentId = "agt_refund"; // what a handoff does
    const res = await post(app, "/v1/sessions/ses_1/token", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent_id: string; capability_token: string };
    expect(body.agent_id).toBe("agt_refund");
    const cap = verifyToken(body.capability_token, signingKey, now)!;
    expect(cap.allow).toContain("offer_refund");
    expect(cap.orders).toEqual(["ORDER-1"]);
    expect(cap.max_refund_total).toBe("100.00");
  });

  it("POST /v1/sessions/:id/token needs the merchant key and 404s for an unknown session", async () => {
    const { app } = setup();
    expect((await post(app, "/v1/sessions/ses_1/token", {}, null)).status).toBe(401);
    expect((await post(app, "/v1/sessions/ses_missing/token", {})).status).toBe(404);
  });
});
