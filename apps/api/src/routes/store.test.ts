import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { mountStore } from "./store";

const merchantKey = "m".repeat(32);

function setup() {
  const ordersFor = vi.fn(async () => []);
  const app = new Hono();
  mountStore(app, { merchantKey, ordersFor });
  return { app, ordersFor };
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
