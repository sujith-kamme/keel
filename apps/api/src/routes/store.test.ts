import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { category, mountStore } from "./store";

const merchantKey = "m".repeat(32);

function setup() {
  const ordersFor = vi.fn(async () => []);
  const item = { sku: "SKU-1", title: "Torrent Rain Jacket", image_url: null, price: "39.95", currency: "USD", category: "Jackets" as const };
  const catalog = vi.fn(async () => [item]);
  const app = new Hono();
  mountStore(app, { merchantKey, ordersFor, catalog });
  return { app, ordersFor, catalog, item };
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
