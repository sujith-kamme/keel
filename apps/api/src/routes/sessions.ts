import { type Capability, TOOLS, checkOtp, issueToken, newOtp } from "@keel/engine";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { GuardMode, SessionMode } from "../mode";
import { merchantAuth } from "./merchant-auth";

const SESSION_TTL_MS = 30 * 60_000;
// Matches the refund-standard session budget; the engine enforces the policy
// budget, the token enforces this hard cap even if a policy is misconfigured.
export const MAX_REFUND_TOTAL = "100.00";

export interface SessionRow {
  id: string;
  agentId: string;
  claimedEmail: string;
  orderIds: string[];
  verifiedPayer: string | null;
  otpHash: string;
  otpExpiresAt: Date;
  otpAttempts: number;
  expiresAt: Date;
  mode: SessionMode;
  guardMode: GuardMode;
}

export interface SessionStore {
  /** The requested orders that exist and belong to this customer. */
  customerOrders: (orderIds: string[], email: string) => Promise<string[]>;
  create: (row: SessionRow) => Promise<void>;
  get: (id: string) => Promise<SessionRow | null>;
  /**
   * Atomically uses up one OTP attempt; false when none are left. Reserving
   * before checking means parallel guesses can't exceed the attempt limit.
   */
  reserveAttempt: (id: string) => Promise<boolean>;
  markVerified: (id: string, email: string) => Promise<void>;
}

export interface SessionOptions {
  merchantKey: string;
  signingKey: string;
  /** Return the OTP in the response (demo only: there is no email delivery). */
  demoOtp: boolean;
  store: SessionStore;
  now: () => Date;
  newId: (prefix: string) => string;
}

const StartSession = z.object({
  agent_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  customer_email: z.email().max(254),
  order_ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(20),
  mode: z.enum(["LIVE", "CONTEXT"]).default("LIVE"),
  guard_mode: z.enum(["ENFORCE", "SHADOW"]).default("ENFORCE"),
});
const Verify = z.object({ code: z.string().regex(/^\d{6}$/) });

function token(row: SessionRow, verifiedPayer: string | null, signingKey: string): string {
  const claims: Capability = {
    session_id: row.id,
    agent_id: row.agentId,
    verified_payer: verifiedPayer,
    orders: row.orderIds,
    allow: [...TOOLS],
    max_refund_total: MAX_REFUND_TOTAL,
    expires_at: row.expiresAt.toISOString(),
  };
  return issueToken(claims, signingKey);
}

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** Sessions API for the merchant backend (docs/FSD.md §12.1). */
export function mountSessions(app: Hono, opts: SessionOptions): void {
  const authorized = merchantAuth(opts.merchantKey);

  app.post("/v1/sessions", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const req = await body(c, StartSession);
    if (!req) return c.json({ error: "invalid_request" }, 400);
    // A shadow guard never blocks, so it is only for simulated (CONTEXT) sessions.
    if (req.guard_mode === "SHADOW" && req.mode === "LIVE") return c.json({ error: "invalid_request" }, 400);
    const now = opts.now();
    const otp = newOtp(now);
    const email = req.customer_email.toLowerCase();
    const row: SessionRow = {
      id: opts.newId("ses"),
      agentId: req.agent_id,
      claimedEmail: email,
      // Least privilege: only the claimed customer's orders. Until the OTP is
      // verified, payer_verified still blocks every money tool.
      orderIds: await opts.store.customerOrders(req.order_ids, email),
      verifiedPayer: null,
      otpHash: otp.hash,
      otpExpiresAt: new Date(otp.expires_at),
      otpAttempts: 0,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      mode: req.mode,
      guardMode: req.guard_mode,
    };
    await opts.store.create(row);
    return c.json(
      {
        session_id: row.id,
        capability_token: token(row, null, opts.signingKey),
        orders: row.orderIds,
        expires_at: row.expiresAt.toISOString(),
        // Simulated customers have no inbox, so CONTEXT sessions always get the code.
        ...(opts.demoOtp || row.mode === "CONTEXT" ? { demo_otp: otp.code } : {}),
      },
      201,
    );
  });

  app.post("/v1/sessions/:id/verify", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const req = await body(c, Verify);
    if (!req) return c.json({ error: "invalid_request" }, 400);
    const now = opts.now();
    const row = await opts.store.get(c.req.param("id"));
    if (!row || row.expiresAt <= now) return c.json({ error: "not_found" }, 404);

    if (!(await opts.store.reserveAttempt(row.id))) return c.json({ error: "locked" }, 400);
    // The attempt is already counted, so check against a fresh budget here.
    const check = checkOtp({ hash: row.otpHash, expires_at: row.otpExpiresAt.toISOString(), attempts: 0 }, req.code, now);
    if (check !== "OK") return c.json({ error: check.toLowerCase() }, 400);

    await opts.store.markVerified(row.id, row.claimedEmail);
    return c.json({ session_id: row.id, capability_token: token(row, row.claimedEmail, opts.signingKey) });
  });
}
