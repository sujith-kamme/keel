import { afterEach, describe, expect, it, vi } from "vitest";
import { PayPalClient, PayPalError } from "./index";

const config = { clientId: "id", clientSecret: "secret", baseUrl: "https://paypal.test" };

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

afterEach(() => vi.unstubAllGlobals());

describe("PayPalClient", () => {
  it("fetches the OAuth token once and reuses it", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/v1/oauth2/token")
        ? json(200, { access_token: "tok", expires_in: 3600 })
        : json(200, { id: "O-1", status: "CREATED" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new PayPalClient(config);
    await client.getOrder("O-1");
    await client.getOrder("O-1");
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => url.endsWith("/v1/oauth2/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("sends PayPal-Request-Id for idempotent POSTs", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/v1/oauth2/token")
        ? json(200, { access_token: "tok", expires_in: 3600 })
        : json(201, { id: "O-2", status: "CREATED" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await new PayPalClient(config).createOrder({ value: "10.00", currency: "USD" }, "dec_1");
    const init = fetchMock.mock.calls[1]?.[1];
    expect((init?.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("dec_1");
  });

  it("creates a PayPal-approved checkout order and captures it idempotently", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/v1/oauth2/token") ? json(200, { access_token: "tok", expires_in: 3600 }) : json(201, { id: "O-3", status: "CREATED", purchase_units: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new PayPalClient(config);
    const usd = (value: string) => ({ currency_code: "USD", value });
    const unit = {
      custom_id: "tidewell:a@b.test",
      items: [{ name: "Jacket", sku: "SKU-1", quantity: "1", unit_amount: usd("10.00") }],
      amount: { ...usd("14.00"), breakdown: { item_total: usd("10.00"), shipping: usd("4.00") } },
    };
    await client.createCheckoutOrder(unit, "Tidewell", "chk_1");
    await client.captureOrder("O-3", "cap_O-3");
    const [, create, capture] = fetchMock.mock.calls;
    const body = JSON.parse(String(create?.[1]?.body));
    expect(body.purchase_units).toEqual([unit]);
    expect(body.payment_source.paypal.experience_context).toMatchObject({ brand_name: "Tidewell", shipping_preference: "NO_SHIPPING" });
    expect(capture?.[0]).toBe("https://paypal.test/v2/checkout/orders/O-3/capture");
    expect((capture?.[1]?.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("cap_O-3");
  });

  it("throws PayPalError with the debug id on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/v1/oauth2/token")
          ? json(200, { access_token: "tok", expires_in: 3600 })
          : json(404, { name: "RESOURCE_NOT_FOUND" }, { "paypal-debug-id": "dbg123" }),
      ),
    );
    const error = await new PayPalClient(config).getOrder("missing").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayPalError);
    expect((error as PayPalError).status).toBe(404);
    expect((error as PayPalError).debugId).toBe("dbg123");
  });

  it("refunds a capture with the decision id as PayPal-Request-Id", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/v1/oauth2/token")
        ? json(200, { access_token: "tok", expires_in: 3600 })
        : json(201, { id: "R-1", status: "COMPLETED" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const refund = await new PayPalClient(config).refundCapture("CAP-1", { value: "42.00", currency: "USD" }, "dec_9");
    expect(refund).toEqual({ id: "R-1", status: "COMPLETED" });
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe("https://paypal.test/v2/payments/captures/CAP-1/refund");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("dec_9");
    expect(JSON.parse(init?.body as string)).toEqual({ amount: { value: "42.00", currency_code: "USD" } });
  });

  it.each([
    ["getOrderDetails", (c: PayPalClient) => c.getOrderDetails("../x")],
    ["getCapture", (c: PayPalClient) => c.getCapture("../x")],
    ["refundCapture", (c: PayPalClient) => c.refundCapture("../x", { value: "1.00", currency: "USD" }, "dec_1")],
  ])("%s rejects unsafe ids before any request", async (_name, call) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(call(new PayPalClient(config))).rejects.toThrow("Invalid PayPal resource id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["../../v1/customer/disputes", "..", "O-1?x=1", "O 1", ""])(
    "rejects unsafe resource id %j before any request is made",
    async (id) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(new PayPalClient(config).getOrder(id)).rejects.toThrow("Invalid PayPal resource id");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
