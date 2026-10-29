import { randomBytes } from "node:crypto";
import type { LedgerContent } from "@keel/engine";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../password";
import { operatorAuth } from "./operator-auth";

export interface ConsoleAccount {
  email: string;
  passwordHash: string;
  sessionVersion: number;
}

export interface ConsoleStore {
  get: () => Promise<ConsoleAccount | null>;
  /** Inserts the account unless one exists. */
  seed: (email: string, passwordHash: string) => Promise<void>;
  /** Under a row lock, sets the email and appends `entry(previous email)`, in one transaction. */
  setEmail: (email: string, entry: (from: string) => LedgerContent) => Promise<void>;
  /**
   * Under a row lock, if the stored hash is still `fromHash`: sets `toHash`, bumps session_version and
   * appends `entry`, in one transaction. Returns the new version, or null when the hash changed meanwhile.
   */
  setPassword: (fromHash: string, toHash: string, entry: LedgerContent) => Promise<number | null>;
  /** Bumps session_version and appends `entry` in one transaction; returns the new version. */
  revokeSessions: (entry: LedgerContent) => Promise<number>;
}

/** The subset of ioredis the login limiter uses. */
export interface LimiterRedis {
  multi(): {
    incr(key: string): unknown;
    expire(key: string, seconds: number, mode: "NX"): unknown;
    ttl(key: string): unknown;
    exec(): Promise<[Error | null, unknown][] | null>;
  };
  del(key: string): Promise<number>;
}

export interface ConsoleOptions {
  operatorKey: string;
  merchantKey: string;
  store: ConsoleStore;
  redis: LimiterRedis;
  newId: (prefix: string) => string;
}

export const Email = z.email().max(254);
export const Password = z.string().min(12).max(128);

/**
 * CONSOLE_USER / CONSOLE_PASSWORD seed the account on first boot only; once it exists they are ignored.
 * With no account and no valid seed the API must not start: nobody could sign in.
 */
export async function initConsoleAccount(store: ConsoleStore, env: Record<string, string | undefined>): Promise<void> {
  if (await store.get()) return;
  const email = Email.safeParse((env.CONSOLE_USER ?? "").toLowerCase());
  if (!email.success) throw new Error("CONSOLE_USER must be a valid email to create the console account");
  const password = Password.safeParse(env.CONSOLE_PASSWORD ?? "");
  if (!password.success) throw new Error("CONSOLE_PASSWORD must be 12 to 128 characters to create the console account");
  await store.seed(email.data, await hashPassword(password.data));
}

export const MAX_FAILURES = 5;
export const LOCK_SECONDS = 15 * 60;
export const failKey = (ip: string) => `keel:login-fail:${ip}`;

const Operator = z.string().min(1).max(64);
const Login = z.strictObject({ email: z.string().min(1).max(254), password: z.string().min(1).max(128), ip: z.string().min(1).max(64) });
const EmailChange = z.strictObject({ email: z.string().max(254).transform((e) => e.toLowerCase()).pipe(Email), operator: Operator });
const PasswordChange = z
  .strictObject({ current_password: z.string().min(1).max(128), new_password: Password, operator: Operator })
  .refine((b) => b.new_password !== b.current_password);
const Revoke = z.strictObject({ operator: Operator });
const Version = /^\d{1,9}$/;

// Unknown email and wrong password cost the same scrypt run, so timing does not reveal which was wrong.
let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword(randomBytes(32).toString("base64")));

/** The console's sign-in (operator key: the web server is the only caller). Never returns or logs password material. */
export function mountConsole(app: Hono, opts: ConsoleOptions): void {
  const auth = operatorAuth(opts.operatorKey, opts.merchantKey);
  const { store, redis } = opts;

  const denied = (c: Context): Response | null => {
    const a = auth(c);
    return a === "ok" ? null : c.json({ error: a === 401 ? "unauthorized" : "forbidden" }, a);
  };
  const entry = (payload: Record<string, unknown>): LedgerContent => ({
    decision_id: opts.newId("dec"),
    session_id: null,
    order_id: null,
    capture_id: null,
    dispute_id: null,
    mode: "LIVE",
    verdict: "ALLOW",
    reason_codes: ["OK"],
    payload,
  });
  const account = async () => {
    const a = await store.get();
    if (!a) throw new Error("console account missing");
    return a;
  };
  // A driver error can carry bound parameters (a password hash): log only the name and return nothing of it.
  const safely = (handler: (c: Context) => Promise<Response>) => async (c: Context) => {
    const d = denied(c);
    if (d) return d;
    try {
      return await handler(c);
    } catch (e) {
      console.error("console route failed:", e instanceof Error ? e.name : "unknown");
      return c.json({ error: "internal_error" }, 500);
    }
  };

  /** Counts this attempt before checking it, so parallel guesses cannot slip past the limit. Throws when Redis is down. */
  const attempt = async (ip: string): Promise<{ allowed: boolean; retryAfterS: number }> => {
    const m = redis.multi();
    m.incr(failKey(ip));
    m.expire(failKey(ip), LOCK_SECONDS, "NX");
    m.ttl(failKey(ip));
    const res = await m.exec();
    if (!res || res.some(([e]) => e)) throw new Error("limiter unavailable");
    const [count, ttl] = [Number(res[0]![1]), Number(res[2]![1])];
    return { allowed: count <= MAX_FAILURES, retryAfterS: ttl > 0 ? ttl : LOCK_SECONDS };
  };

  app.post(
    "/v1/console/login",
    safely(async (c) => {
      const req = Login.safeParse(await c.req.json().catch(() => null));
      if (!req.success) return c.json({ error: "invalid_request" }, 400);
      const { email, password, ip } = req.data;
      let gate: Awaited<ReturnType<typeof attempt>>;
      try {
        gate = await attempt(ip);
      } catch {
        // Fail closed: no sign-in without the limiter.
        return c.json({ error: "unavailable" }, 503);
      }
      if (!gate.allowed) return c.json({ error: "locked", retry_after_s: gate.retryAfterS }, 429);
      const a = await store.get();
      const passwordOk = await verifyPassword(password, a?.passwordHash ?? (await dummyHash()));
      if (!a || !passwordOk || email.toLowerCase() !== a.email) return c.json({ error: "invalid_credentials" }, 401);
      try {
        await redis.del(failKey(ip));
      } catch {
        return c.json({ error: "unavailable" }, 503);
      }
      return c.json({ email: a.email, session_version: a.sessionVersion });
    }),
  );

  app.get(
    "/v1/console/session",
    safely(async (c) => {
      const v = c.req.query("v") ?? "";
      if (!Version.test(v)) return c.json({ error: "invalid_request" }, 400);
      const a = await account();
      return c.json({ email: a.email, valid: Number(v) === a.sessionVersion });
    }),
  );

  // No password needed: there is no email delivery or recovery, so the address is only a login name.
  app.put(
    "/v1/console/email",
    safely(async (c) => {
      const req = EmailChange.safeParse(await c.req.json().catch(() => null));
      if (!req.success) return c.json({ error: "invalid_request" }, 400);
      const { email, operator } = req.data;
      await store.setEmail(email, (from) => entry({ tool: "console_email_change", from, to: email, operator }));
      return c.json({ email });
    }),
  );

  app.put(
    "/v1/console/password",
    safely(async (c) => {
      const req = PasswordChange.safeParse(await c.req.json().catch(() => null));
      if (!req.success) return c.json({ error: "invalid_request" }, 400);
      const a = await account();
      if (!(await verifyPassword(req.data.current_password, a.passwordHash))) return c.json({ error: "invalid_credentials" }, 401);
      const version = await store.setPassword(
        a.passwordHash,
        await hashPassword(req.data.new_password),
        entry({ tool: "console_password_change", operator: req.data.operator }),
      );
      if (version === null) return c.json({ error: "conflict" }, 409);
      return c.json({ session_version: version });
    }),
  );

  app.post(
    "/v1/console/sessions/revoke",
    safely(async (c) => {
      const req = Revoke.safeParse(await c.req.json().catch(() => null));
      if (!req.success) return c.json({ error: "invalid_request" }, 400);
      return c.json({ session_version: await store.revokeSessions(entry({ tool: "console_sessions_revoke", operator: req.data.operator })) });
    }),
  );
}
