import { describe, expect, it } from "vitest";
import { seal } from "./seal";
import { CONSOLE_TTL_MS, checkLogin, consoleSession, isConsoleSession, safeNext } from "./console-auth";

const secret = "s".repeat(48);
const now = new Date("2026-01-01T00:00:00Z");
const expected = { user: "judge", password: "test-pass-123" };

describe("checkLogin", () => {
  it("accepts the right credentials", () => expect(checkLogin("judge", "test-pass-123", expected)).toBe(true));
  it("rejects wrong user, wrong password, empty strings", () => {
    expect(checkLogin("other", "test-pass-123", expected)).toBe(false);
    expect(checkLogin("judge", "nope", expected)).toBe(false);
    expect(checkLogin("", "", expected)).toBe(false);
  });
  it("rejects when expected values are empty", () => {
    expect(checkLogin("judge", "", { user: "judge", password: "" })).toBe(false);
    expect(checkLogin("", "x", { user: "", password: "x" })).toBe(false);
  });
});

describe("console session", () => {
  it("round trips", () => expect(isConsoleSession(consoleSession(secret, now), secret, now)).toBe(true));
  it("rejects other purposes", () => {
    const chat = seal({ sub: "demo" }, secret, "chat", new Date(now.getTime() + CONSOLE_TTL_MS));
    expect(isConsoleSession(chat, secret, now)).toBe(false);
  });
  it("rejects expired", () => {
    const later = new Date(now.getTime() + CONSOLE_TTL_MS + 1);
    expect(isConsoleSession(consoleSession(secret, now), secret, later)).toBe(false);
  });
  it("rejects undefined and garbage", () => {
    expect(isConsoleSession(undefined, secret, now)).toBe(false);
    expect(isConsoleSession("garbage", secret, now)).toBe(false);
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
