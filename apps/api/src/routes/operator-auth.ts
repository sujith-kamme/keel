import { createHash, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Checks `Authorization: Bearer <operator key>` without leaking timing. The
 * merchant key gets 403: an agent integration's key can't approve its own holds.
 */
export function operatorAuth(operatorKey: string, merchantKey: string): (c: Context) => "ok" | 401 | 403 {
  if (Buffer.byteLength(operatorKey) < 32) throw new Error("KEEL_OPERATOR_KEY must be at least 32 bytes");
  if (operatorKey === merchantKey) throw new Error("KEEL_OPERATOR_KEY must differ from KEEL_MERCHANT_KEY");
  const operator = digest(operatorKey);
  const merchant = digest(merchantKey);
  return (c) => {
    const given = /^Bearer (\S+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    if (given === undefined) return 401;
    const d = digest(given);
    if (timingSafeEqual(d, operator)) return "ok";
    return timingSafeEqual(d, merchant) ? 403 : 401;
  };
}
