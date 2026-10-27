import { createHash, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Checks `Authorization: Bearer <merchant key>` without leaking timing. */
export function merchantAuth(merchantKey: string): (c: Context) => boolean {
  if (Buffer.byteLength(merchantKey) < 32) throw new Error("KEEL_MERCHANT_KEY must be at least 32 bytes");
  const expected = digest(merchantKey);
  // Digests have equal length, so timingSafeEqual never throws and leaks nothing about the key.
  return (c) => {
    const given = /^Bearer (\S+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    return given !== undefined && timingSafeEqual(digest(given), expected);
  };
}
