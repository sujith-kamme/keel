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
