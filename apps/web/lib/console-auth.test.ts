import { describe, expect, it, vi } from "vitest";
import { seal } from "./seal";
import {
  CONSOLE_TTL_MS,
  clientIp,
  consoleSession,
  consoleSessionChecker,
  consoleSessionVersion,
  consoleUser,
  isConsoleSession,
  loginError,
  safeNext,
} from "./console-auth";

const secret = "s".repeat(48);
const now = new Date("2026-01-01T00:00:00Z");

describe("console session", () => {
  it("round trips with its version", () => {
    expect(isConsoleSession(consoleSession(secret, now, 3), secret, now)).toBe(true);
    expect(consoleSessionVersion(consoleSession(secret, now, 3), secret, now)).toBe(3);
  });
  it("rejects other purposes", () => {
    const chat = seal({ sub: "console", v: 1 }, secret, "chat", new Date(now.getTime() + CONSOLE_TTL_MS));
    expect(isConsoleSession(chat, secret, now)).toBe(false);
  });
  it("rejects the old env-login cookie and a cookie without a version", () => {
    const exp = new Date(now.getTime() + CONSOLE_TTL_MS);
    expect(isConsoleSession(seal({ sub: "demo" }, secret, "console", exp), secret, now)).toBe(false);
    expect(isConsoleSession(seal({ sub: "console" }, secret, "console", exp), secret, now)).toBe(false);
    expect(isConsoleSession(seal({ sub: "console", v: "1" }, secret, "console", exp), secret, now)).toBe(false);
  });
  it("rejects expired", () => {
    const later = new Date(now.getTime() + CONSOLE_TTL_MS + 1);
    expect(isConsoleSession(consoleSession(secret, now, 1), secret, later)).toBe(false);
  });
  it("rejects undefined and garbage", () => {
    expect(isConsoleSession(undefined, secret, now)).toBe(false);
    expect(isConsoleSession("garbage", secret, now)).toBe(false);
  });
});

describe("consoleUser", () => {
  const check = vi.fn(async (v: number) => ({ email: "admin@tidewell.com", valid: v === 2 }));

  it("returns the email for the current version", async () => {
    expect(await consoleUser(consoleSession(secret, now, 2), secret, now, check)).toBe("admin@tidewell.com");
  });
  it("signs out a cookie with an old version", async () => {
    expect(await consoleUser(consoleSession(secret, now, 1), secret, now, check)).toBeNull();
  });
  it("does not ask the API about a missing or invalid cookie", async () => {
    check.mockClear();
    expect(await consoleUser(undefined, secret, now, check)).toBeNull();
    expect(await consoleUser("garbage", secret, now, check)).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });
  it("fails closed when the check throws", async () => {
    await expect(consoleUser(consoleSession(secret, now, 2), secret, now, async () => Promise.reject(new Error("down")))).rejects.toThrow();
  });
});

describe("consoleSessionChecker", () => {
  const reply = (body: unknown, status = 200) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

  it("calls the session route and caches each version for 5 seconds", async () => {
    const f = reply({ email: "admin@tidewell.com", valid: true });
    let t = 0;
    const check = consoleSessionChecker({ url: "http://api", key: "k", fetch: f as unknown as typeof fetch, now: () => t });
    expect(await check(1)).toEqual({ email: "admin@tidewell.com", valid: true });
    expect(f.mock.calls[0]![0]).toBe("http://api/v1/console/session?v=1");
    expect((f.mock.calls[0]![1]?.headers as Record<string, string>).authorization).toBe("Bearer k");
    t = 4_999;
    await check(1);
    expect(f).toHaveBeenCalledTimes(1);
    await check(2);
    expect(f).toHaveBeenCalledTimes(2);
    t = 5_000;
    await check(1);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("throws on a non-2xx response, and only valid: true counts", async () => {
    await expect(consoleSessionChecker({ url: "http://api", key: "k", fetch: reply({}, 503) as unknown as typeof fetch })(1)).rejects.toThrow(/503/);
    const odd = consoleSessionChecker({ url: "http://api", key: "k", fetch: reply({ email: "a@b.co", valid: "true" }) as unknown as typeof fetch });
    expect((await odd(1)).valid).toBe(false);
  });
});

describe("login helpers", () => {
  it("uses the first x-forwarded-for hop", () => {
    expect(clientIp("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(clientIp(" 2001:db8::1 ")).toBe("2001:db8::1");
    expect(clientIp(null)).toBe("unknown");
    expect(clientIp("")).toBe("unknown");
    expect(clientIp("x".repeat(65))).toBe("unknown");
  });
  it("maps API statuses to messages", () => {
    expect(loginError(401)).toBe("Wrong email or password");
    expect(loginError(429, 900)).toBe("Too many attempts. Try again in 15 minutes.");
    expect(loginError(429, 61)).toBe("Too many attempts. Try again in 2 minutes.");
    expect(loginError(429, 5)).toBe("Too many attempts. Try again in 1 minute.");
    expect(loginError(503)).toMatch(/unavailable/);
    expect(loginError(500)).toMatch(/unavailable/);
  });
});

describe("safeNext", () => {
  it("rejects off-site and malformed targets", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", null, "/a\\b", "/a\nb", "/login", "/login?next=/x"]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
  it("keeps same-site paths", () => {
    expect(safeNext("/sessions")).toBe("/sessions");
    expect(safeNext("/sessions/ses_1")).toBe("/sessions/ses_1");
  });
});
