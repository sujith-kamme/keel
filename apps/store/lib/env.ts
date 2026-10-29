import "server-only";

export interface Env {
  keelApiUrl: string;
  merchantKey: string;
  anthropicKey: string;
  cookieSecret: string;
}

let cached: Env | undefined;

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
};

/** Read and validated on first use, so `next build` does not need the environment. */
export function env(): Env {
  if (cached) return cached;
  const cookieSecret = required("STORE_COOKIE_SECRET");
  if (Buffer.byteLength(cookieSecret) < 32) throw new Error("STORE_COOKIE_SECRET must be at least 32 bytes");
  cached = {
    keelApiUrl: required("KEEL_API_URL"),
    merchantKey: required("KEEL_MERCHANT_KEY"),
    anthropicKey: required("ANTHROPIC_API_KEY"),
    cookieSecret,
  };
  return cached;
}
