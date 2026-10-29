import { fromCents, toCents } from "@keel/engine";
import type { CheckoutUnit, OrderDetails } from "@keel/paypal";
import type { Hono } from "hono";
import { z } from "zod";
import { merchantAuth } from "./merchant-auth";

export interface StoreOrderSummary {
  order_id: string;
  scenario: string | null;
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

export interface NewStoreOrder {
  orderId: string;
  captureId: string;
  payerEmail: string;
  currency: string;
  total: string;
  items: { sku: string; title: string; price: string }[];
}

export interface StoreOptions {
  merchantKey: string;
  ordersFor: (email: string) => Promise<StoreOrderSummary[]>;
  catalog: () => Promise<CatalogItem[]>;
  checkout: {
    create: (unit: CheckoutUnit, requestId: string) => Promise<{ id: string }>;
    /** null when PayPal has no such order. */
    details: (orderId: string) => Promise<OrderDetails | null>;
    capture: (orderId: string, requestId: string) => Promise<OrderDetails>;
    /** Records a paid order; a second call for the same order is a no-op. */
    record: (order: NewStoreOrder) => Promise<void>;
  };
  newId: (prefix: string) => string;
}

export const SHIPPING_CENTS = 400;
export const FREE_SHIPPING_FROM_CENTS = 5000;
const CHECKOUT_TAG = "tidewell:";

const CheckoutBody = z.object({
  customer_email: z.email().max(254),
  items: z
    .array(z.object({ sku: z.string().min(1).max(64), qty: z.number().int().min(1).max(10), size: z.string().regex(/^[A-Z0-9]{1,4}$/).nullable() }))
    .min(1)
    .max(20),
});
const CaptureBody = z.object({ customer_email: z.email().max(254) });

/**
 * The PayPal purchase unit for a bag, priced from the catalog only (never from the shopper's browser).
 * Shipping is $4 under $50, free from $50. null when a line names no catalog product.
 */
export function priceCheckout(catalog: CatalogItem[], email: string, lines: z.infer<typeof CheckoutBody>["items"]): CheckoutUnit | null {
  const bySku = new Map(catalog.map((c) => [c.sku, c]));
  const items = [];
  let itemCents = 0;
  for (const l of lines) {
    const product = bySku.get(l.sku);
    if (!product || product.currency !== "USD") return null;
    itemCents += toCents(product.price) * l.qty;
    const name = l.size ? `${product.title} (${l.size})` : product.title;
    items.push({ name: name.slice(0, 127), sku: product.sku, quantity: String(l.qty), unit_amount: { currency_code: "USD", value: product.price } });
  }
  const shipping = itemCents >= FREE_SHIPPING_FROM_CENTS ? 0 : SHIPPING_CENTS;
  const usd = (cents: number) => ({ currency_code: "USD", value: fromCents(cents) });
  return {
    custom_id: `${CHECKOUT_TAG}${email}`,
    items,
    amount: { ...usd(itemCents + shipping), breakdown: { item_total: usd(itemCents), shipping: usd(shipping) } },
  };
}

/** The store order to record from a captured PayPal order: one item entry per unit bought, the total as captured. */
export function capturedOrder(order: OrderDetails, email: string): NewStoreOrder | null {
  const unit = order.purchase_units[0];
  const capture = unit?.payments?.captures?.[0];
  if (order.status !== "COMPLETED" || !unit || capture?.status !== "COMPLETED") return null;
  return {
    orderId: order.id,
    captureId: capture.id,
    payerEmail: email,
    currency: capture.amount.currency_code,
    total: capture.amount.value,
    items: (unit.items ?? []).flatMap((i) => Array.from({ length: Number(i.quantity) }, () => ({ sku: i.sku, title: i.name, price: i.unit_amount.value }))),
  };
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

  app.post("/v1/store/checkout", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const body = CheckoutBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const email = body.data.customer_email.toLowerCase();
    const unit = priceCheckout(await opts.catalog(), email, body.data.items);
    if (!unit) return c.json({ error: "unknown_item" }, 400);
    const order = await opts.checkout.create(unit, opts.newId("chk"));
    return c.json({ order_id: order.id, total: { value: unit.amount.value, currency: unit.amount.currency_code } }, 201);
  });

  app.post("/v1/store/checkout/:id/capture", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.param("id");
    const body = CaptureBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success || !/^[A-Za-z0-9]{1,64}$/.test(id)) return c.json({ error: "invalid_request" }, 400);
    const email = body.data.customer_email.toLowerCase();
    let order = await opts.checkout.details(id);
    // Only orders this store created for this shopper can be captured here.
    if (!order || order.purchase_units[0]?.custom_id !== `${CHECKOUT_TAG}${email}`) return c.json({ error: "not_found" }, 404);
    if (order.status === "APPROVED") order = await opts.checkout.capture(id, `cap_${id}`);
    const paid = capturedOrder(order, email);
    if (!paid) return c.json({ error: "not_paid", status: order.status }, 409);
    await opts.checkout.record(paid);
    return c.json({ order_id: paid.orderId, total: { value: paid.total, currency: paid.currency } });
  });
}
