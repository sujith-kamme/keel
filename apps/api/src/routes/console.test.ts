import type { LedgerContent } from "@keel/engine";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../password";
import { type ConsoleAccount, type ConsoleStore, type LimiterRedis, LOCK_SECONDS, failKey, initConsoleAccount, mountConsole } from "./console";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const bearer = (k: string) => ({ authorization: `Bearer ${k}`, "content-type": "application/json" });
const op = bearer(operatorKey);
const EMAIL = "admin@tidewell.com";
const PASSWORD = "correct-horse-battery";
const NEW_PASSWORD = "another-long-passphrase";

function fakeStore(initial: ConsoleAccount | null = null) {
  let account = initial;
  const ledger: LedgerContent[] = [];
  const must = () => {
    if (!account) throw new Error("console account missing");
    return account;
  };
  const store: ConsoleStore = {
    get: async () => account && { ...account },
    seed: async (email, passwordHash) => {
      account ??= { email, passwordHash, sessionVersion: 1 };
    },
    setEmail: async (email, entry) => {
      const from = must().email;
      account = { ...must(), email };
      ledger.push(entry(from));
    },
    setPassword: async (fromHash, toHash, entry) => {
      if (must().passwordHash !== fromHash) return null;
      account = { ...must(), passwordHash: toHash, sessionVersion: must().sessionVersion + 1 };
      ledger.push(entry);
      return account.sessionVersion;
    },
    revokeSessions: async (entry) => {
      account = { ...must(), sessionVersion: must().sessionVersion + 1 };
      ledger.push(entry);
      return account.sessionVersion;
    },
  };
  return { store, ledger, account: () => account };
}

/** INCR / EXPIRE NX / TTL / DEL over a map; `down` makes every call fail like a lost connection. */
function fakeRedis() {
  const keys = new Map<string, { n: number; ttl: number }>();
  const state = { down: false, keys };
  const redis: LimiterRedis = {
    multi: () => {
      const ops: (() => unknown)[] = [];
      return {
        incr: (k) => ops.push(() => {
          const e = keys.get(k) ?? { n: 0, ttl: -1 };
          e.n += 1;
          keys.set(k, e);
          return e.n;
        }),
        expire: (k, s) => ops.push(() => {
          const e = keys.get(k);
          if (!e || e.ttl !== -1) return 0;
          e.ttl = s;
          return 1;
        }),
        ttl: (k) => ops.push(() => keys.get(k)?.ttl ?? -2),
        exec: async () => {
          if (state.down) throw new Error("Connection is closed.");
          return ops.map((o) => [null, o()] as [null, unknown]);
        },
      };
    },
    del: async (k) => {
      if (state.down) throw new Error("Connection is closed.");
      return keys.delete(k) ? 1 : 0;
    },
  };
  return { redis, state };
}

async function setup() {
  const s = fakeStore({ email: EMAIL, passwordHash: await hashPassword(PASSWORD), sessionVersion: 1 });
  const r = fakeRedis();
  const app = new Hono();
  let n = 0;
  mountConsole(app, { operatorKey, merchantKey, store: s.store, redis: r.redis, newId: (p) => `${p}_${++n}` });
  return { app, ...s, redis: r.state };
}

const send = (app: Hono, method: string, path: string, body?: unknown, headers: Record<string, string> = op) =>
  app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const login = (app: Hono, body: Record<string, unknown>) => send(app, "POST", "/v1/console/login", { email: EMAIL, password: PASSWORD, ip: "1.2.3.4", ...body });
const session = (app: Hono, v: string | number) => send(app, "GET", `/v1/console/session?v=${v}`);
const valid = async (app: Hono, v: number) => ((await (await session(app, v)).json()) as { valid: boolean }).valid;

describe("console API: auth", () => {
  it("401 without or with a wrong key, 403 for the merchant key, on every route", async () => {
    const { app } = await setup();
    const routes: [string, string, unknown][] = [
      ["POST", "/v1/console/login", { email: EMAIL, password: PASSWORD, ip: "1.2.3.4" }],
      ["GET", "/v1/console/session?v=1", undefined],
      ["PUT", "/v1/console/email", { email: "x@example.com", operator: "ops" }],
      ["PUT", "/v1/console/password", { current_password: PASSWORD, new_password: NEW_PASSWORD, operator: "ops" }],
      ["POST", "/v1/console/sessions/revoke", { operator: "ops" }],
    ];
    for (const [method, path, body] of routes) {
      expect((await send(app, method, path, body, {})).status).toBe(401);
      expect((await send(app, method, path, body, bearer("x".repeat(32)))).status).toBe(401);
      expect((await send(app, method, path, body, bearer(merchantKey))).status).toBe(403);
    }
  });
});

describe("console API: login", () => {
  it("200 with the email and session version; the email is case-insensitive", async () => {
    const { app } = await setup();
    const res = await login(app, { email: "Admin@Tidewell.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: EMAIL, session_version: 1 });
  });

  it("the same 401 for an unknown email and a wrong password", async () => {
    const { app } = await setup();
    const unknown = await login(app, { email: "nobody@example.com" });
    const wrong = await login(app, { password: "wrong-password-123" });
    expect([unknown.status, wrong.status]).toEqual([401, 401]);
    expect(await unknown.json()).toEqual({ error: "invalid_credentials" });
    expect(await wrong.json()).toEqual({ error: "invalid_credentials" });
  });

  it("400 for a malformed body", async () => {
    const { app } = await setup();
    for (const body of [{ ip: "" }, { ip: "x".repeat(65) }, { password: "" }, { extra: 1 }]) {
      expect((await login(app, body)).status).toBe(400);
    }
  });

  it("locks an IP after 5 failures, even for the right password, while another IP signs in", async () => {
    const { app, redis } = await setup();
    for (let i = 0; i < 5; i++) expect((await login(app, { password: "wrong-password-123" })).status).toBe(401);
    expect(redis.keys.get(failKey("1.2.3.4"))).toEqual({ n: 5, ttl: LOCK_SECONDS });
    const locked = await login(app, {});
    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ error: "locked", retry_after_s: LOCK_SECONDS });
    expect((await login(app, { ip: "5.6.7.8" })).status).toBe(200);
    expect((await login(app, {})).status).toBe(429);
  });

  it("success clears only that IP's counter", async () => {
    const { app, redis } = await setup();
    await login(app, { password: "wrong-password-123" });
    await login(app, { ip: "5.6.7.8", password: "wrong-password-123" });
    expect((await login(app, {})).status).toBe(200);
    expect(redis.keys.has(failKey("1.2.3.4"))).toBe(false);
    expect(redis.keys.get(failKey("5.6.7.8"))?.n).toBe(1);
  });

  it("503 without Redis, and no sign-in", async () => {
    const { app, redis } = await setup();
    redis.down = true;
    const res = await login(app, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });
});

describe("console API: session", () => {
  it("valid only for the current version", async () => {
    const { app } = await setup();
    expect(await (await session(app, 1)).json()).toEqual({ email: EMAIL, valid: true });
    expect(await (await session(app, 2)).json()).toEqual({ email: EMAIL, valid: false });
    for (const v of ["", "x", "-1", "1.5", "1".repeat(10)]) expect((await session(app, v)).status).toBe(400);
  });
});

describe("console API: changes", () => {
  it("password change verifies the current one, bumps the version and ledgers no secrets", async () => {
    const { app, ledger, account } = await setup();
    const change = (body: Record<string, unknown>) =>
      send(app, "PUT", "/v1/console/password", { current_password: PASSWORD, new_password: NEW_PASSWORD, operator: EMAIL, ...body });
    expect((await change({ current_password: "wrong-password-123" })).status).toBe(401);
    expect((await change({ new_password: "short" })).status).toBe(400);
    expect((await change({ new_password: "x".repeat(129) })).status).toBe(400);
    expect((await change({ new_password: PASSWORD })).status).toBe(400);
    expect(ledger).toHaveLength(0);

    const res = await change({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session_version: 2 });
    expect(await verifyPassword(NEW_PASSWORD, account()!.passwordHash)).toBe(true);
    expect(await valid(app, 1)).toBe(false);
    expect(await valid(app, 2)).toBe(true);
    expect((await login(app, {})).status).toBe(401);
    expect((await login(app, { password: NEW_PASSWORD })).status).toBe(200);

    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ verdict: "ALLOW", reason_codes: ["OK"], mode: "LIVE", session_id: null });
    expect(ledger[0]!.payload).toEqual({ tool: "console_password_change", operator: EMAIL });
    const text = JSON.stringify(ledger);
    for (const secret of [PASSWORD, NEW_PASSWORD, "scrypt"]) expect(text).not.toContain(secret);
  });

  it("password change locks an IP after 5 wrong current passwords, sharing the sign-in counter", async () => {
    const { app, ledger, redis } = await setup();
    const change = (body: Record<string, unknown>) =>
      send(app, "PUT", "/v1/console/password", { current_password: PASSWORD, new_password: NEW_PASSWORD, operator: EMAIL, ip: "1.2.3.4", ...body });
    for (let i = 0; i < 5; i++) expect((await change({ current_password: "wrong-password-123" })).status).toBe(401);
    const locked = await change({});
    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ error: "locked", retry_after_s: LOCK_SECONDS });
    expect((await login(app, {})).status).toBe(429);
    expect(ledger).toHaveLength(0);
    expect((await change({ ip: "5.6.7.8" })).status).toBe(200);
    expect(redis.keys.has(failKey("5.6.7.8"))).toBe(false);
    expect((await change({ ip: "x".repeat(65) })).status).toBe(400);
  });

  it("password change without an IP is limited on a shared counter", async () => {
    const { app, redis } = await setup();
    await send(app, "PUT", "/v1/console/password", { current_password: "wrong-password-123", new_password: NEW_PASSWORD, operator: EMAIL });
    expect(redis.keys.get(failKey("unknown"))?.n).toBe(1);
  });

  it("password change is 503 without Redis, and changes nothing", async () => {
    const { app, ledger, redis } = await setup();
    redis.down = true;
    const res = await send(app, "PUT", "/v1/console/password", { current_password: PASSWORD, new_password: NEW_PASSWORD, operator: EMAIL, ip: "1.2.3.4" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(ledger).toHaveLength(0);
    expect(await valid(app, 1)).toBe(true);
  });

  it("email change lowercases, ledgers from/to and keeps the session version", async () => {
    const { app, ledger } = await setup();
    expect((await send(app, "PUT", "/v1/console/email", { email: "not-an-email", operator: EMAIL })).status).toBe(400);
    const res = await send(app, "PUT", "/v1/console/email", { email: "Ops@Tidewell.com", operator: EMAIL });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "ops@tidewell.com" });
    expect(await (await session(app, 1)).json()).toEqual({ email: "ops@tidewell.com", valid: true });
    expect(ledger.map((e) => e.payload)).toEqual([{ tool: "console_email_change", from: EMAIL, to: "ops@tidewell.com", operator: EMAIL }]);
    expect((await login(app, { email: "ops@tidewell.com" })).status).toBe(200);
  });

  it("sign out everywhere bumps the version and ledgers it", async () => {
    const { app, ledger } = await setup();
    expect((await send(app, "POST", "/v1/console/sessions/revoke", {})).status).toBe(400);
    const res = await send(app, "POST", "/v1/console/sessions/revoke", { operator: EMAIL });
    expect(await res.json()).toEqual({ session_version: 2 });
    expect(await valid(app, 1)).toBe(false);
    expect(ledger.map((e) => e.payload)).toEqual([{ tool: "console_sessions_revoke", operator: EMAIL }]);
  });

  it("a store failure is a bare 500", async () => {
    const broken = new Hono();
    mountConsole(broken, {
      operatorKey,
      merchantKey,
      store: { get: async () => Promise.reject(new Error("password_hash=scrypt$leak")) } as unknown as ConsoleStore,
      redis: fakeRedis().redis,
      newId: (p) => p,
    });
    const res = await session(broken, 1);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(JSON.stringify({ error: "internal_error" }));
  });
});

describe("initConsoleAccount", () => {
  it("seeds from env: lowercased email, hashed password", async () => {
    const s = fakeStore();
    await initConsoleAccount(s.store, { CONSOLE_USER: "Admin@Tidewell.com", CONSOLE_PASSWORD: PASSWORD });
    expect(s.account()?.email).toBe(EMAIL);
    expect(s.account()?.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, s.account()!.passwordHash)).toBe(true);
  });

  it("ignores env once the account exists, even when env is missing", async () => {
    const existing = { email: "ops@example.com", passwordHash: "scrypt$x", sessionVersion: 3 };
    const s = fakeStore(existing);
    await initConsoleAccount(s.store, { CONSOLE_USER: "other@example.com", CONSOLE_PASSWORD: "another-long-password" });
    await initConsoleAccount(s.store, {});
    expect(s.account()).toEqual(existing);
  });

  it("throws at boot with no account and a missing or invalid seed", async () => {
    for (const env of [
      {},
      { CONSOLE_USER: EMAIL },
      { CONSOLE_USER: "judge", CONSOLE_PASSWORD: PASSWORD },
      { CONSOLE_USER: EMAIL, CONSOLE_PASSWORD: "short" },
      { CONSOLE_USER: EMAIL, CONSOLE_PASSWORD: "x".repeat(129) },
    ]) {
      const s = fakeStore();
      await expect(initConsoleAccount(s.store, env)).rejects.toThrow(/CONSOLE_(USER|PASSWORD)/);
      expect(s.account()).toBeNull();
    }
  });

  it("never puts the password in the error", async () => {
    await expect(initConsoleAccount(fakeStore().store, { CONSOLE_USER: "a@b.co", CONSOLE_PASSWORD: "secret" })).rejects.not.toThrow(/secret/);
  });
});
