import { createHash, randomInt, timingSafeEqual } from "node:crypto";

// Demo identity verification: a one-time code bound to the customer's claimed
// email. Only the hash is stored.
const TTL_MS = 10 * 60_000;
export const MAX_OTP_ATTEMPTS = 5;

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

export function newOtp(now: Date): { code: string; hash: string; expires_at: string } {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return { code, hash: hash(code), expires_at: new Date(now.getTime() + TTL_MS).toISOString() };
}

export function checkOtp(
  stored: { hash: string; expires_at: string; attempts: number },
  code: string,
  now: Date,
): "OK" | "WRONG" | "EXPIRED" | "LOCKED" {
  if (stored.attempts >= MAX_OTP_ATTEMPTS) return "LOCKED";
  if (now.getTime() >= Date.parse(stored.expires_at)) return "EXPIRED";
  const given = Buffer.from(hash(code), "hex");
  const expected = Buffer.from(stored.hash, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected) ? "OK" : "WRONG";
}
