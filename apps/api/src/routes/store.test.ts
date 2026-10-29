import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { OrderDetails } from "@keel/paypal";
import { capturedOrder, category, mountStore, priceCheckout } from "./store";

const merchantKey = "m".repeat(32);

function setup() {
  const ordersFor = vi.fn(async () => []);
  const item = { sku: "SKU-1", title: "Torrent Rain Jacket", image_url: null, price: "39.95", currency: "USD", category: "Jackets" as const };
  const catalog = vi.fn(async () => [item]);
  const checkout = {
    create: vi.fn(async () => ({ id: "O1" })),
    details: vi.fn(async (): Promise<OrderDetails | null> => null),
    capture: vi.fn(async (): Promise<OrderDetails> => paid("O1", "tidewell:maya@gmail.com")),
    record: vi.fn(async () => {}),
  };
  const app = new Hono();
  mountStore(app, { merchantKey, ordersFor, catalog, checkout, newId: (p) => `${p}_1` });
  return { app, ordersFor, catalog, item, checkout };
}

describe("GET /v1/store/orders", () => {
  it("requires the merchant key", async () => {
    const { app, ordersFor } = setup();
    expect((await app.request("/v1/store/orders?customer_email=a@b.test")).status).toBe(401);
    expect(ordersFor).not.toHaveBeenCalled();
  });

  it("lists a customer's orders by normalized email", async () => {
    const { app, ordersFor } = setup();
    const res = await app.request("/v1/store/orders?customer_email=Maya@demo.keel.test", {
      headers: { authorization: `Bearer ${merchantKey}` },
    });
    expect(res.status).toBe(200);
    expect(ordersFor).toHaveBeenCalledWith("maya@demo.keel.test");
  });

  it("rejects a missing or invalid email", async () => {
    const { app } = setup();
    const res = await app.request("/v1/store/orders?customer_email=nope", { headers: { authorization: `Bearer ${merchantKey}` } });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/store/catalog", () => {
  it("requires the merchant key", async () => {
    const { app, catalog } = setup();
    expect((await app.request("/v1/store/catalog")).status).toBe(401);
    expect(catalog).not.toHaveBeenCalled();
  });

  it("lists the catalog", async () => {
    const { app, item } = setup();
    const res = await app.request("/v1/store/catalog", { headers: { authorization: `Bearer ${merchantKey}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [item] });
  });
});

describe("category", () => {
  it("puts each seeded product in its aisle", () => {
    expect(category("Classic Rain Jacket Men's")).toBe("Jackets");
    expect(category("adidas Response 2 Running Shoes")).toBe("Footwear");
    expect(category("WATER BOTTLE 500ml 17oz")).toBe("Bottles");
    expect(category("Gift card")).toBe("Other");
  });
});

const usd = (value: string) => ({ currency_code: "USD", value });
const unitItem = { name: "Torrent Rain Jacket (L)", sku: "SKU-1", quantity: "2", unit_amount: usd("39.95") };
function paid(id: string, custom_id: string, status = "COMPLETED"): OrderDetails {
  return {
    id,
    status,
    purchase_units: [{ custom_id, items: [unitItem], payments: status === "COMPLETED" ? { captures: [{ id: "CAP1", status: "COMPLETED", amount: usd("79.90"), create_time: "" }] } : undefined }],
  };
}
const auth = { authorization: `Bearer ${merchantKey}`, "content-type": "application/json" };
const postJson = (app: Hono, path: string, body: unknown) => app.request(path, { method: "POST", headers: auth, body: JSON.stringify(body) });

describe("priceCheckout", () => {
  const catalog = [
    { sku: "SKU-1", title: "Torrent Rain Jacket", image_url: null, price: "39.95", currency: "USD", category: "Jackets" as const },
    { sku: "SKU-2", title: "Classic Water Bottle", image_url: null, price: "13.99", currency: "USD", category: "Bottles" as const },
  ];

  it("prices from the catalog and adds $4 shipping under $50", () => {
    const unit = priceCheckout(catalog, "a@b.test", [{ sku: "SKU-2", qty: 2, size: null }])!;
    expect(unit.custom_id).toBe("tidewell:a@b.test");
    expect(unit.items).toEqual([{ name: "Classic Water Bottle", sku: "SKU-2", quantity: "2", unit_amount: usd("13.99") }]);
    expect(unit.amount).toEqual({ ...usd("31.98"), breakdown: { item_total: usd("27.98"), shipping: usd("4.00") } });
  });

  it("ships free from $50 and names the size", () => {
    const unit = priceCheckout(catalog, "a@b.test", [{ sku: "SKU-1", qty: 2, size: "L" }])!;
    expect(unit.items[0]!.name).toBe("Torrent Rain Jacket (L)");
    expect(unit.amount.value).toBe("79.90");
    expect(unit.amount.breakdown.shipping.value).toBe("0.00");
  });

  it("refuses a product that isn't in the catalog", () => {
    expect(priceCheckout(catalog, "a@b.test", [{ sku: "SKU-9", qty: 1, size: null }])).toBeNull();
  });
});

describe("capturedOrder", () => {
  it("records one item entry per unit and the captured total", () => {
    expect(capturedOrder(paid("O1", "x"), "maya@gmail.com")).toEqual({
      orderId: "O1",
      captureId: "CAP1",
      payerEmail: "maya@gmail.com",
      currency: "USD",
      total: "79.90",
      items: [
        { sku: "SKU-1", title: "Torrent Rain Jacket (L)", price: "39.95" },
        { sku: "SKU-1", title: "Torrent Rain Jacket (L)", price: "39.95" },
      ],
    });
  });

  it("is null until the payment is captured", () => {
    expect(capturedOrder(paid("O1", "x", "APPROVED"), "maya@gmail.com")).toBeNull();
  });
});

describe("POST /v1/store/checkout", () => {
  it("creates the PayPal order from catalog prices, ignoring anything else the client sends", async () => {
    const { app, checkout } = setup();
    const res = await postJson(app, "/v1/store/checkout", { customer_email: "Maya@gmail.com", items: [{ sku: "SKU-1", qty: 1, size: "M", price: "0.01" }] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ order_id: "O1", total: { value: "43.95", currency: "USD" } });
    expect(checkout.create).toHaveBeenCalledWith(expect.objectContaining({ custom_id: "tidewell:maya@gmail.com" }), "chk_1");
  });

  it("rejects unknown products, bad quantities and a missing key", async () => {
    const { app, checkout } = setup();
    expect((await postJson(app, "/v1/store/checkout", { customer_email: "a@b.test", items: [{ sku: "SKU-9", qty: 1, size: null }] })).status).toBe(400);
    expect((await postJson(app, "/v1/store/checkout", { customer_email: "a@b.test", items: [{ sku: "SKU-1", qty: 11, size: null }] })).status).toBe(400);
    expect((await postJson(app, "/v1/store/checkout", { customer_email: "a@b.test", items: [] })).status).toBe(400);
    expect((await app.request("/v1/store/checkout", { method: "POST", body: "{}" })).status).toBe(401);
    expect(checkout.create).not.toHaveBeenCalled();
  });
});

describe("POST /v1/store/checkout/:id/capture", () => {
  it("captures an approved order created for this shopper and records it", async () => {
    const { app, checkout } = setup();
    checkout.details.mockResolvedValueOnce(paid("O1", "tidewell:maya@gmail.com", "APPROVED"));
    const res = await postJson(app, "/v1/store/checkout/O1/capture", { customer_email: "maya@gmail.com" });
    expect(res.status).toBe(200);
    expect(checkout.capture).toHaveBeenCalledWith("O1", "cap_O1");
    expect(checkout.record).toHaveBeenCalledWith(expect.objectContaining({ orderId: "O1", total: "79.90", payerEmail: "maya@gmail.com" }));
  });

  it("records an already captured order again without capturing twice", async () => {
    const { app, checkout } = setup();
    checkout.details.mockResolvedValueOnce(paid("O1", "tidewell:maya@gmail.com"));
    expect((await postJson(app, "/v1/store/checkout/O1/capture", { customer_email: "maya@gmail.com" })).status).toBe(200);
    expect(checkout.capture).not.toHaveBeenCalled();
    expect(checkout.record).toHaveBeenCalledOnce();
  });

  it("refuses another shopper's order, a foreign order and an unknown one alike", async () => {
    const { app, checkout } = setup();
    checkout.details.mockResolvedValueOnce(paid("O1", "tidewell:sam@gmail.com", "APPROVED"));
    expect((await postJson(app, "/v1/store/checkout/O1/capture", { customer_email: "maya@gmail.com" })).status).toBe(404);
    checkout.details.mockResolvedValueOnce(paid("O1", "someone-else", "APPROVED"));
    expect((await postJson(app, "/v1/store/checkout/O1/capture", { customer_email: "maya@gmail.com" })).status).toBe(404);
    expect((await postJson(app, "/v1/store/checkout/O1/capture", { customer_email: "maya@gmail.com" })).status).toBe(404);
    expect((await postJson(app, "/v1/store/checkout/O..1/capture", { customer_email: "maya@gmail.com" })).status).toBe(400);
    expect(checkout.capture).not.toHaveBeenCalled();
    expect(checkout.record).not.toHaveBeenCalled();
  });

  it("does not record an order the buyer hasn't approved", async () => {
    const { app, checkout } = setup();
    checkout.details.mockResolvedValueOnce(paid("O1", "tidewell:maya@gmail.com", "CREATED"));
    expect((await postJson(app, "/v1/store/checkout/O1/capture", { customer_email: "maya@gmail.com" })).status).toBe(409);
    expect(checkout.record).not.toHaveBeenCalled();
  });
});
