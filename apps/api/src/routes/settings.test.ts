import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { SettingsService } from "../settings";
import { SETTINGS_DEFAULTS, type Settings } from "../settings-schema";
import { type SettingsStatus, mountSettings } from "./settings";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const bearer = (k: string) => ({ authorization: `Bearer ${k}`, "content-type": "application/json" });
const op = bearer(operatorKey);
const HOOK = "https://hooks.zapier.com/hooks/catch/123/secret-token";
const status: SettingsStatus = {
  paypal: { mode: "sandbox", client_id: "AXk3…9fQ", webhook_configured: true },
  anthropic: { key_set: true },
  demo_otp: false,
};

function setup(opts: { hook?: string | null; fail?: boolean; rescheduleFails?: boolean; send?: (url: string) => Promise<{ status: number }> } = {}) {
  let current: Settings = { ...SETTINGS_DEFAULTS, zapier_hook_url: opts.hook ?? null };
  const polls: number[] = [];
  const settings: SettingsService = {
    init: async () => {},
    get: async () => current,
    update: async (_section, patch) => {
      if (opts.fail) throw new Error("settings write failed");
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        const from = (current as Record<string, unknown>)[k];
        if (from !== v) changes[k] = { from, to: v };
      }
      current = { ...current, ...(patch as object) };
      return { changes };
    },
  };
  const app = new Hono();
  mountSettings(app, {
    operatorKey,
    merchantKey,
    settings,
    status,
    reschedulePoll: async (s) => {
      if (opts.rescheduleFails) throw new Error("redis down");
      polls.push(s);
    },
    getHookUrl: async () => current.zapier_hook_url,
    send: opts.send ?? (async () => ({ status: 200 })),
  });
  return { app, polls };
}
const put = (app: Hono, section: string, body: unknown, headers: Record<string, string> = op) =>
  app.request(`/v1/settings/${section}`, { method: "PUT", headers, body: JSON.stringify(body) });
const test = (app: Hono, headers: Record<string, string> = op) =>
  app.request("/v1/settings/zapier/test", { method: "POST", headers });

describe("settings API", () => {
  it("401 without or with a wrong key, 403 for the merchant key on operator routes", async () => {
    const { app } = setup();
    for (const headers of [{}, bearer("x".repeat(32))] as Record<string, string>[]) {
      expect((await app.request("/v1/settings", { headers })).status).toBe(401);
      expect((await put(app, "guard", { operator: "ops", values: {} }, headers)).status).toBe(401);
      expect((await test(app, headers)).status).toBe(401);
    }
    const m = bearer(merchantKey);
    expect((await app.request("/v1/settings", { headers: m })).status).toBe(403);
    expect((await put(app, "guard", { operator: "ops", values: {} }, m)).status).toBe(403);
    expect((await test(app, m)).status).toBe(403);
  });

  it("GET returns values and status, and never the hook URL", async () => {
    const { app } = setup({ hook: HOOK });
    const res = await app.request("/v1/settings", { headers: op });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("zapier_hook_url");
    const body = JSON.parse(text);
    expect(body.zapier).toEqual({ configured: true });
    expect(body.values.risk_threshold).toBe(SETTINGS_DEFAULTS.risk_threshold);
    expect(body.status).toEqual(status);
    expect(((await (await setup().app.request("/v1/settings", { headers: op })).json()) as { zapier: unknown }).zapier).toEqual({ configured: false });
  });

  it("PUT returns the changes", async () => {
    const { app } = setup();
    const res = await put(app, "guard", { operator: "ops", values: { risk_threshold: 70 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changes: { risk_threshold: { from: 60, to: 70 } } });
  });

  it("PUT rejects an unknown section, invalid values, unknown keys and a bad body", async () => {
    const { app } = setup();
    expect((await put(app, "nope", { operator: "ops", values: {} })).status).toBe(404);
    expect((await put(app, "guard", { operator: "ops", values: { risk_threshold: 0 } })).status).toBe(400);
    expect((await put(app, "guard", { operator: "ops", values: { bogus: 1 } })).status).toBe(400);
    expect((await put(app, "guard", { operator: "ops", values: { agent_model: "x" } })).status).toBe(400);
    expect((await put(app, "guard", { values: {} })).status).toBe(400);
    expect((await put(app, "guard", { operator: "ops", values: {}, extra: 1 })).status).toBe(400);
    expect((await put(app, "zapier", { operator: "ops", values: { zapier_hook_url: "https://evil.test/x" } })).status).toBe(400);
  });

  it("reschedules the poll once when dispute_poll_seconds changes, not when unchanged", async () => {
    const { app, polls } = setup();
    await put(app, "disputes", { operator: "ops", values: { dispute_poll_seconds: 300 } });
    expect(polls).toEqual([300]);
    await put(app, "disputes", { operator: "ops", values: { dispute_poll_seconds: 300 } });
    await put(app, "disputes", { operator: "ops", values: { dispute_auto_submit: true } });
    await put(app, "guard", { operator: "ops", values: { risk_threshold: 70 } });
    expect(polls).toEqual([300]);
  });

  it("still 200 when the poll reschedule fails after the write", async () => {
    const { app } = setup({ rescheduleFails: true });
    const res = await put(app, "disputes", { operator: "ops", values: { dispute_poll_seconds: 300 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changes: { dispute_poll_seconds: { from: 120, to: 300 } }, poll_rescheduled: false });
    expect(await (await put(app, "guard", { operator: "ops", values: { risk_threshold: 70 } })).json()).not.toHaveProperty("poll_rescheduled");
  });

  it("500 settings_write_failed without leaking", async () => {
    const { app } = setup({ fail: true });
    const res = await put(app, "zapier", { operator: "ops", values: { zapier_hook_url: HOOK } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "settings_write_failed" });
    expect(text).not.toContain("secret-token");
  });

  it("zapier test: 409 when unset, status when set, never the URL", async () => {
    expect((await test(setup().app)).status).toBe(409);
    let sent = "";
    const { app } = setup({ hook: HOOK, send: async (u) => ((sent = u), { status: 200 }) });
    const res = await test(app);
    expect(await res.json()).toEqual({ ok: true, status: 200 });
    expect(sent).toBe(HOOK);
    const failing = setup({ hook: HOOK, send: async () => { throw new Error(`boom ${HOOK}`); } });
    const bad = await (await test(failing.app)).text();
    expect(JSON.parse(bad)).toEqual({ ok: false, status: null });
    expect(bad).not.toContain("secret-token");
    const gone = setup({ hook: HOOK, send: async () => { throw Object.assign(new Error(`zapier responded 410 ${HOOK}`), { status: 410 }); } });
    const goneText = await (await test(gone.app)).text();
    expect(JSON.parse(goneText)).toEqual({ ok: false, status: 410 });
    expect(goneText).not.toContain("secret-token");
    expect((await app.request("/v1/settings/zapier/test", { method: "POST", headers: op })).status).toBe(200);
  });

  it("agent-config needs the merchant key and returns model and prompt", async () => {
    const { app } = setup();
    expect((await app.request("/v1/agent-config")).status).toBe(401);
    expect((await app.request("/v1/agent-config", { headers: op })).status).toBe(401);
    const res = await app.request("/v1/agent-config", { headers: bearer(merchantKey) });
    expect(await res.json()).toEqual({ model: SETTINGS_DEFAULTS.agent_model, prompt: SETTINGS_DEFAULTS.agent_prompt });
  });
});
