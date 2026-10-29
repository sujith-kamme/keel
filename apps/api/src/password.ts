import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;

const derive = (password: string, salt: Buffer, keylen: number, p: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) =>
    // scrypt needs about 128 * N * r bytes; Node's 32 MiB default is exactly 2^15 * 8 * 128, so allow headroom.
    scrypt(password, salt, keylen, { ...p, maxmem: 256 * p.N * p.r * p.p }, (e, key) => (e ? reject(e) : resolve(key))),
  );

/** `scrypt$N$r$p$<salt b64>$<key b64>`: the params travel with the hash, so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

const int = (s: string | undefined) => (s !== undefined && /^\d{1,7}$/.test(s) ? Number(s) : NaN);

/** False for a wrong password or a malformed stored value; never throws on bad input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt64, key64, ...rest] = stored.split("$");
  const params = { N: int(n), r: int(r), p: int(p) };
  const salt = Buffer.from(salt64 ?? "", "base64");
  const expected = Buffer.from(key64 ?? "", "base64");
  const valid =
    scheme === "scrypt" &&
    rest.length === 0 &&
    params.N >= 2 && params.N <= 2 ** 20 && (params.N & (params.N - 1)) === 0 &&
    params.r >= 1 && params.r <= 32 &&
    params.p >= 1 && params.p <= 16 &&
    salt.length >= 8 &&
    expected.length >= 16 && expected.length <= 128;
  if (!valid) return false;
  try {
    return timingSafeEqual(await derive(password, salt, expected.length, params), expected);
  } catch {
    return false;
  }
}
