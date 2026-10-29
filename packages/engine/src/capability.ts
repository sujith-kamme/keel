import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./canonical";
import { MONEY, toCents } from "./money";

export const TOOLS = ["get_order", "offer_refund", "offer_discount", "state_policy", "escalate_to_human", "handoff_to_refund"] as const;
export type Tool = (typeof TOOLS)[number];

// Per-session capability (docs/FSD.md §7): what the agent may do, signed by Keel.
export const Capability = z.object({
  session_id: z.string().min(1),
  agent_id: z.string().min(1),
  verified_payer: z.string().nullable(),
  orders: z.array(z.string()),
  allow: z.array(z.enum(TOOLS)),
  max_refund_total: z.string().regex(MONEY),
  expires_at: z.iso.datetime(),
});
export type Capability = z.infer<typeof Capability>;

const MIN_KEY_BYTES = 32;

function checkKey(key: string): void {
  if (Buffer.byteLength(key) < MIN_KEY_BYTES) throw new Error(`Signing key must be at least ${MIN_KEY_BYTES} bytes`);
}

function sign(payload: string, key: string): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

/** Token = base64url(canonical claims) "." base64url(HMAC-SHA256). */
export function issueToken(claims: Capability, key: string): string {
  checkKey(key);
  const payload = Buffer.from(canonicalJson(claims)).toString("base64url");
  return `${payload}.${sign(payload, key).toString("base64url")}`;
}

/** Returns the claims, or null if the token is malformed, forged, invalid or expired. */
export function verifyToken(token: string, key: string, now: Date): Capability | null {
  checkKey(key);
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts as [string, string];
  const given = Buffer.from(signature, "base64url");
  const actual = sign(payload, key);
  if (given.length !== actual.length || !timingSafeEqual(given, actual)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const claims = Capability.safeParse(raw);
  if (!claims.success) return null;
  return Date.parse(claims.data.expires_at) > now.getTime() ? claims.data : null;
}

/** Scope check (FR-CAP-2), run before any policy evaluation. */
export function checkScope(
  cap: Capability,
  call: { tool: string; order_id?: string; amount?: string },
  sessionRefunded: string,
): boolean {
  if (!(cap.allow as string[]).includes(call.tool)) return false;
  if (call.order_id !== undefined && !cap.orders.includes(call.order_id)) return false;
  if (call.tool === "offer_refund") {
    if (call.amount === undefined || !MONEY.test(call.amount) || toCents(call.amount) === 0) return false;
    return toCents(sessionRefunded) + toCents(call.amount) <= toCents(cap.max_refund_total);
  }
  return true;
}
