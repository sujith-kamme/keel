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

export interface CatalogItem {
  sku: string;
  title: string;
  image_url: string | null;
  price: string;
  currency: string;
  category: "Jackets" | "Footwear" | "Bottles" | "Other";
}

export interface StoreOptions {
  merchantKey: string;
  ordersFor: (email: string) => Promise<StoreOrderSummary[]>;
  catalog: () => Promise<CatalogItem[]>;
}

/** The shop's aisle for a product, from its title (the catalog is seeded from jacket, shoe and bottle searches). */
export function category(title: string): CatalogItem["category"] {
  if (/jacket/i.test(title)) return "Jackets";
  if (/shoe/i.test(title)) return "Footwear";
  if (/bottle/i.test(title)) return "Bottles";
  return "Other";
}

const Query = z.object({ customer_email: z.email().max(254) });

/**
 * The demo merchant's catalog and order list. In a real deployment this is the merchant's
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
  app.get("/v1/store/catalog", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    return c.json({ items: await opts.catalog() });
  });
}
