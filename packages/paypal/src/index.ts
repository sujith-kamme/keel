export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly debugId: string | null,
  ) {
    super(`PayPal request failed with ${status}${debugId ? ` (debug_id ${debugId})` : ""}`);
  }
}

export function configFromEnv(env = process.env): PayPalConfig {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_BASE_URL } = env;
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  }
  return {
    clientId: PAYPAL_CLIENT_ID,
    clientSecret: PAYPAL_CLIENT_SECRET,
    baseUrl: PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com",
  };
}

// PayPal resource IDs are alphanumeric with dashes/underscores. Anything else is
// rejected so caller-supplied IDs (ultimately from an AI agent) can't rewrite the
// request path and reach other PayPal endpoints with Keel's credentials.
function resourceId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`Invalid PayPal resource id: ${JSON.stringify(id)}`);
  return id;
}

export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: PayPalConfig) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await fetch(`${this.config.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) throw new PayPalError(res.status, body, res.headers.get("paypal-debug-id"));
    // Refresh a minute early so in-flight requests never carry an expired token.
    this.token = { value: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 0) - 60) * 1000 };
    return this.token.value;
  }

  async request<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      "Content-Type": "application/json",
    };
    // PayPal-Request-Id makes POSTs idempotent (docs/FSD.md NFR-4).
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) throw new PayPalError(res.status, parsed, res.headers.get("paypal-debug-id"));
    return parsed as T;
  }

  createOrder(amount: { value: string; currency: string }, requestId?: string) {
    return this.request<{ id: string; status: string }>(
      "POST",
      "/v2/checkout/orders",
      { intent: "CAPTURE", purchase_units: [{ amount: { currency_code: amount.currency, value: amount.value } }] },
      requestId,
    );
  }

  async getOrder(orderId: string) {
    return this.request<{ id: string; status: string }>("GET", `/v2/checkout/orders/${resourceId(orderId)}`);
  }
}
