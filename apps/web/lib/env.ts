import "server-only";

export interface Env {
  keelApiUrl: string;
  merchantKey: string;
  operatorKey: string;
  anthropicKey: string;
  webSecret: string;
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
  const webSecret = required("KEEL_WEB_SECRET");
  if (Buffer.byteLength(webSecret) < 32) throw new Error("KEEL_WEB_SECRET must be at least 32 bytes");
  cached = {
    keelApiUrl: required("KEEL_API_URL"),
    merchantKey: required("KEEL_MERCHANT_KEY"),
    operatorKey: required("KEEL_OPERATOR_KEY"),
    anthropicKey: required("ANTHROPIC_API_KEY"),
    webSecret,
  };
  return cached;
}

/** The API's rule for its PayPal client (unset means sandbox), for pages that render before sign-in. */
export const paypalSandbox = (): boolean =>
  new URL(process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").hostname === "api-m.sandbox.paypal.com";
