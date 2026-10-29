import { seal, unseal } from "./seal";

export const CONSOLE_COOKIE = "keel_console";
export const CONSOLE_TTL_MS = 8 * 60 * 60_000;

/** `v` is the account's session_version at sign-in: a password change or "sign out everywhere" bumps it. */
export function consoleSession(secret: string, now: Date, version: number): string {
  return seal({ sub: "console", v: version }, secret, "console", new Date(now.getTime() + CONSOLE_TTL_MS));
}

/** The console cookie's attributes (sign-in and the password change re-issue it). */
export const consoleCookieOptions = () =>
  ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: CONSOLE_TTL_MS / 1000 }) as const;

/** The session version a valid console cookie carries, else null. */
export function consoleSessionVersion(value: string | undefined, secret: string, now: Date): number | null {
  if (!value) return null;
  const s = unseal<{ sub?: unknown; v?: unknown }>(value, secret, "console", now);
  return s?.sub === "console" && Number.isSafeInteger(s.v) ? (s.v as number) : null;
}

/** Cookie check only (the proxy); requireConsole also asks the API whether the version is still current. */
export function isConsoleSession(value: string | undefined, secret: string, now: Date): boolean {
  return consoleSessionVersion(value, secret, now) !== null;
}

/** The first `x-forwarded-for` hop, the IP the login limiter counts against. */
export function clientIp(forwardedFor: string | null): string {
  const first = forwardedFor?.split(",")[0]?.trim() ?? "";
  return first && first.length <= 64 ? first : "unknown";
}

export function loginError(status: number, retryAfterS?: number): string {
  if (status === 401) return "Wrong email or password";
  if (status === 429) {
    const minutes = Math.max(1, Math.ceil((retryAfterS ?? 900) / 60));
    return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return "Sign-in is unavailable right now. Try again shortly.";
}

const TTL_MS = 5_000;

/** Asks the API whether a session version is current, caching each answer for 5 seconds. Failure throws. */
export function consoleSessionChecker(deps: { url: string; key: string; fetch?: typeof fetch; now?: () => number }) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const cache = new Map<number, { value: { email: string; valid: boolean }; at: number }>();
  return async (version: number): Promise<{ email: string; valid: boolean }> => {
    const hit = cache.get(version);
    if (hit && now() - hit.at < TTL_MS) return hit.value;
    const res = await doFetch(`${deps.url}/v1/console/session?v=${version}`, {
      headers: { authorization: `Bearer ${deps.key}` },
      signal: AbortSignal.timeout(TTL_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`console session check responded ${res.status}`);
    const body = (await res.json()) as { email?: unknown; valid?: unknown };
    const value = { email: String(body.email ?? ""), valid: body.valid === true };
    cache.set(version, { value, at: now() });
    return value;
  };
}

/** The signed-in email, or null when the cookie is missing, invalid, expired or from a revoked session version. */
export async function consoleUser(
  cookie: string | undefined,
  secret: string,
  now: Date,
  check: (version: number) => Promise<{ email: string; valid: boolean }>,
): Promise<string | null> {
  const version = consoleSessionVersion(cookie, secret, now);
  if (version === null) return null;
  const s = await check(version);
  return s.valid ? s.email : null;
}

/** Post-login redirect target: same-site paths only, else "/". */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return "/";
  return next;
}
