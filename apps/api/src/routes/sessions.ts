import { createHash, timingSafeEqual } from "node:crypto";
import { type Capability, TOOLS, checkOtp, issueToken, newOtp } from "@keel/engine";
import type { Context, Hono } from "hono";
import { z } from "zod";

const SESSION_TTL_MS = 30 * 60_000;
// Matches the refund-standard session budget; the engine enforces the policy
// budget, the token enforces this hard cap even if a policy is misconfigured.
const MAX_REFUND_TOTAL = "100.00";

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
}

export interface SessionStore {
  existingOrders: (orderIds: string[]) => Promise<string[]>;
  create: (row: SessionRow) => Promise<void>;
  get: (id: string) => Promise<SessionRow | null>;
  recordFailedAttempt: (id: string) => Promise<void>;
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
});
const Verify = z.object({ code: z.string().regex(/^\d{6}$/) });

const digest = (value: string) => createHash("sha256").update(value).digest();

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
  if (Buffer.byteLength(opts.merchantKey) < 32) throw new Error("KEEL_MERCHANT_KEY must be at least 32 bytes");
  const expected = digest(opts.merchantKey);
  // Digests have equal length, so timingSafeEqual never throws and leaks nothing about the key.
  const authorized = (c: Context) => {
    const given = /^Bearer (\S+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    return given !== undefined && timingSafeEqual(digest(given), expected);
  };

  app.post("/v1/sessions", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const req = await body(c, StartSession);
    if (!req) return c.json({ error: "invalid_request" }, 400);
    const now = opts.now();
    const otp = newOtp(now);
    const row: SessionRow = {
      id: opts.newId("ses"),
      agentId: req.agent_id,
      claimedEmail: req.customer_email.toLowerCase(),
      // Only orders Keel knows; the payer_verified rule still checks ownership per order.
      orderIds: await opts.store.existingOrders(req.order_ids),
      verifiedPayer: null,
      otpHash: otp.hash,
      otpExpiresAt: new Date(otp.expires_at),
      otpAttempts: 0,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    };
    await opts.store.create(row);
    return c.json(
      {
        session_id: row.id,
        capability_token: token(row, null, opts.signingKey),
        orders: row.orderIds,
        expires_at: row.expiresAt.toISOString(),
        ...(opts.demoOtp ? { demo_otp: otp.code } : {}),
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

    const check = checkOtp(
      { hash: row.otpHash, expires_at: row.otpExpiresAt.toISOString(), attempts: row.otpAttempts },
      req.code,
      now,
    );
    if (check === "WRONG") await opts.store.recordFailedAttempt(row.id);
    if (check !== "OK") return c.json({ error: check.toLowerCase() }, 400);

    await opts.store.markVerified(row.id, row.claimedEmail);
    return c.json({ session_id: row.id, capability_token: token(row, row.claimedEmail, opts.signingKey) });
  });
}
