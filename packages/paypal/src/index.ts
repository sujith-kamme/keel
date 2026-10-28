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
export function resourceId(id: string): string {
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

  /** Sandbox-only endpoints (dispute adjudication) refuse to run anywhere else. */
  get isSandbox(): boolean {
    return new URL(this.config.baseUrl).hostname === "api-m.sandbox.paypal.com";
  }

  request<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
    return this.send<T>(method, path, body === undefined ? undefined : JSON.stringify(body), requestId);
  }

  /** A pre-serialised JSON string, or FormData (fetch then sets the multipart boundary). */
  async send<T>(method: string, path: string, body?: string | FormData, requestId?: string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken()}` };
    if (typeof body === "string") headers["Content-Type"] = "application/json";
    // PayPal-Request-Id makes POSTs idempotent (docs/FSD.md NFR-4).
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    const res = await fetch(`${this.config.baseUrl}${path}`, { method, headers, body });
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

  async getOrderDetails(orderId: string) {
    return this.request<OrderDetails>("GET", `/v2/checkout/orders/${resourceId(orderId)}`);
  }

  async getCapture(captureId: string) {
    return this.request<Capture>("GET", `/v2/payments/captures/${resourceId(captureId)}`);
  }

  /**
   * Seeding only: a card-funded order with intent CAPTURE completes in one call
   * in the sandbox (no buyer approval), returning the capture.
   */
  createCardOrder(amount: { value: string; currency: string }, description: string, requestId: string) {
    return this.request<OrderDetails>(
      "POST",
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [{ description, amount: { currency_code: amount.currency, value: amount.value } }],
        payment_source: { card: SANDBOX_CARD },
      },
      requestId,
    );
  }

  /** PayPal-Request-Id = Keel decision id, so a retried decision never refunds twice. */
  async refundCapture(captureId: string, amount: { value: string; currency: string }, requestId: string) {
    return this.request<{ id: string; status: string }>(
      "POST",
      `/v2/payments/captures/${resourceId(captureId)}/refund`,
      { amount: { value: amount.value, currency_code: amount.currency } },
      requestId,
    );
  }
}

export interface PayPalAmount {
  value: string;
  currency_code: string;
}

export interface Capture {
  id: string;
  status: string;
  amount: PayPalAmount;
  create_time: string;
}

export interface Refund {
  id: string;
  status: string;
  amount: PayPalAmount;
}

export interface OrderDetails {
  id: string;
  status: string;
  purchase_units: { payments?: { captures?: Capture[]; refunds?: Refund[] } }[];
}

// PayPal's published sandbox test Visa; it only works against the sandbox.
const SANDBOX_CARD = {
  number: "4032039317984658",
  expiry: "2030-12",
  security_code: "123",
  name: "Keel Demo Buyer",
  billing_address: { country_code: "US", postal_code: "95131" },
};
