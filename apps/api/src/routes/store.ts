import type { Hono } from "hono";
import { z } from "zod";
import { merchantAuth } from "./merchant-auth";

export interface StoreOrderSummary {
  order_id: string;
  scenario: string;
  total: { value: string; currency: string };
  items: { sku: string; title: string; price: string }[];
  delivered_at: string | null;
}

export interface StoreOptions {
  merchantKey: string;
  ordersFor: (email: string) => Promise<StoreOrderSummary[]>;
}

const Query = z.object({ customer_email: z.email().max(254) });

/**
 * The demo merchant's order list. In a real deployment this is the merchant's
 * own system; Keel hosts it here only because the demo store lives in Keel.
 */
export function mountStore(app: Hono, opts: StoreOptions): void {
  const authorized = merchantAuth(opts.merchantKey);
  app.get("/v1/store/orders", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const query = Query.safeParse({ customer_email: c.req.query("customer_email") });
    if (!query.success) return c.json({ error: "invalid_request" }, 400);
    return c.json({ orders: await opts.ordersFor(query.data.customer_email.toLowerCase()) });
  });
}
