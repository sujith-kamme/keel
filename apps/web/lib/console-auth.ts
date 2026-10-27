import { createHash, timingSafeEqual } from "node:crypto";
import { seal, unseal } from "./seal";

export const CONSOLE_COOKIE = "keel_console";
export const CONSOLE_TTL_MS = 8 * 60 * 60_000;

const digest = (value: string) => createHash("sha256").update(value).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** Constant-time check of both fields; hashing first gives equal-length buffers. */
export function checkLogin(user: string, password: string, expected: { user: string; password: string }): boolean {
  // Number() + bitwise & avoids short-circuiting, so timing does not reveal which field was wrong.
  const ok = Number(same(user, expected.user)) & Number(same(password, expected.password));
  return ok === 1 && expected.user !== "" && expected.password !== "";
}

export function consoleSession(secret: string, now: Date): string {
  return seal({ sub: "demo" }, secret, "console", new Date(now.getTime() + CONSOLE_TTL_MS));
}

export function isConsoleSession(value: string | undefined, secret: string, now: Date): boolean {
  return !!value && unseal<{ sub: string }>(value, secret, "console", now)?.sub === "demo";
}

/** Post-login redirect target: same-site paths only, else "/". */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return "/";
  return next;
}
