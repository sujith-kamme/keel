import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** Purpose-bound key: a cookie sealed for one purpose never opens as another. */
function key(secret: string, purpose: string): Buffer {
  if (Buffer.byteLength(secret) < 32) throw new Error("STORE_COOKIE_SECRET must be at least 32 bytes");
  return Buffer.from(hkdfSync("sha256", secret, "tidewell-store", purpose, 32));
}

/** AES-256-GCM over JSON `{ v: value, exp }`; output is base64url(iv | tag | ciphertext). */
export function seal(value: unknown, secret: string, purpose: string, expiresAt: Date): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ v: value, exp: expiresAt.getTime() })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** null on any tampering, wrong purpose, wrong secret, malformed input or expiry. */
export function unseal<T>(sealed: string, secret: string, purpose: string, now: Date): T | null {
  const k = key(secret, purpose);
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const { v, exp } = JSON.parse(json) as { v: T; exp: number };
    return exp > now.getTime() ? v : null;
  } catch {
    return null;
  }
}
