import { verifyToken } from "@keel/engine";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type SessionRow, type SessionStore, mountSessions } from "./sessions";

const merchantKey = "m".repeat(32);
const signingKey = "s".repeat(32);
const now = new Date("2026-10-27T12:00:00Z");

function setup(demoOtp = true) {
  const rows = new Map<string, SessionRow>();
  const store: SessionStore = {
    existingOrders: async (ids) => ids.filter((id) => id.startsWith("ORDER-")),
    create: async (row) => void rows.set(row.id, row),
    get: async (id) => rows.get(id) ?? null,
    recordFailedAttempt: async (id) => {
      const row = rows.get(id)!;
      rows.set(id, { ...row, otpAttempts: row.otpAttempts + 1 });
    },
    markVerified: async (id, email) => {
      rows.set(id, { ...rows.get(id)!, verifiedPayer: email });
    },
  };
  const app = new Hono();
  mountSessions(app, { merchantKey, signingKey, demoOtp, store, now: () => now, newId: (p) => `${p}_1` });
  return { app, rows };
}

const post = (app: Hono, path: string, body: unknown, key: string | null = merchantKey) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });

const start = { agent_id: "agt_demo", customer_email: "Maya@demo.keel.test", order_ids: ["ORDER-1", "NOPE"] };

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

  it("returns 404 for an unknown session", async () => {
    const { app } = setup();
    expect((await post(app, "/v1/sessions/ses_missing/verify", { code: "123456" })).status).toBe(404);
  });
});
