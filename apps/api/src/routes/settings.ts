import type { Context, Hono } from "hono";
import { z } from "zod";
import type { SettingsService } from "../settings";
import { SECTION_SCHEMAS, type Section } from "../settings-schema";
import { merchantAuth } from "./merchant-auth";
import { operatorAuth } from "./operator-auth";

/** Env-derived, computed once at boot. Never holds a secret. */
export interface SettingsStatus {
  paypal: { mode: "sandbox" | "live"; client_id: string | null; webhook_configured: boolean };
  anthropic: { key_set: boolean };
  demo_otp: boolean;
}

export interface SettingsOptions {
  operatorKey: string;
  merchantKey: string;
  settings: SettingsService;
  status: SettingsStatus;
  /** Reschedules the dispute poll (a no-op when this process runs no worker). */
  reschedulePoll: (seconds: number) => Promise<void>;
  getHookUrl: () => Promise<string | null>;
  send: (hookUrl: string) => Promise<{ status: number }>;
}

const Update = z.strictObject({ operator: z.string().min(1).max(64), values: z.record(z.string(), z.unknown()) });
const isSection = (s: string): s is Section => Object.hasOwn(SECTION_SCHEMAS, s);

/** Runtime settings (operator key) and the agent config the storefront reads (merchant key). */
export function mountSettings(app: Hono, opts: SettingsOptions): void {
  const auth = operatorAuth(opts.operatorKey, opts.merchantKey);
  const merchant = merchantAuth(opts.merchantKey);
  const { settings } = opts;

  const denied = (c: Context): Response | null => {
    const a = auth(c);
    return a === "ok" ? null : c.json({ error: a === 401 ? "unauthorized" : "forbidden" }, a);
  };

  app.get("/v1/settings", async (c) => {
    const d = denied(c);
    if (d) return d;
    const { zapier_hook_url, ...values } = await settings.get();
    return c.json({ values, zapier: { configured: zapier_hook_url !== null }, status: opts.status });
  });

  // Registered before /:section so "zapier/test" is never read as a section.
  app.post("/v1/settings/zapier/test", async (c) => {
    const d = denied(c);
    if (d) return d;
    const hookUrl = await opts.getHookUrl();
    if (!hookUrl) return c.json({ error: "not_configured" }, 409);
    try {
      return c.json({ ok: true, status: (await opts.send(hookUrl)).status });
    } catch (e) {
      // Log only the name and never echo the error: it can carry the URL or the upstream body.
      console.error("zapier test failed:", e instanceof Error ? e.name : "unknown");
      const status = (e as { status?: unknown } | null)?.status;
      return c.json({ ok: false, status: typeof status === "number" ? status : null });
    }
  });

  app.put("/v1/settings/:section", async (c) => {
    const d = denied(c);
    if (d) return d;
    const section = c.req.param("section");
    if (!isSection(section)) return c.json({ error: "not_found" }, 404);
    const req = Update.safeParse(await c.req.json().catch(() => null));
    if (!req.success || !SECTION_SCHEMAS[section].partial().safeParse(req.data.values).success) {
      return c.json({ error: "invalid_request" }, 400);
    }
    let result: Awaited<ReturnType<SettingsService["update"]>>;
    try {
      result = await settings.update(section, req.data.values, req.data.operator);
    } catch {
      return c.json({ error: "settings_write_failed" }, 500);
    }
    const poll = result.changes.dispute_poll_seconds;
    if (section !== "disputes" || !poll) return c.json({ changes: result.changes });
    // The write is committed: a failed reschedule must not turn into a 500 the client would retry as a no-op.
    try {
      await opts.reschedulePoll(poll.to as number);
      return c.json({ changes: result.changes, poll_rescheduled: true });
    } catch (e) {
      console.error("dispute poll reschedule failed:", e instanceof Error ? e.name : "unknown");
      return c.json({ changes: result.changes, poll_rescheduled: false });
    }
  });

  app.get("/v1/agent-config", async (c) => {
    if (!merchant(c)) return c.json({ error: "unauthorized" }, 401);
    const s = await settings.get();
    return c.json({ model: s.agent_model, prompt: s.agent_prompt });
  });
}
