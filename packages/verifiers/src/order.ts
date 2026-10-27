import { type Facts, fromCents, toCents } from "@keel/engine";
import type { OrderDetails } from "@keel/paypal";

export interface StoreOrderFacts {
  payerEmail: string;
  deliveredAt: Date | null;
}

export interface OrderSources {
  getOrderDetails: (orderId: string) => Promise<OrderDetails>;
  storeOrder: (orderId: string) => Promise<StoreOrderFacts | null>;
}

// A capture's status moves to PARTIALLY_REFUNDED / REFUNDED after refunds; the
// money was still captured. Pending refunds count as refunded so the same
// money can't be refunded twice while one settles.
const CAPTURED = new Set(["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"]);
const REFUNDED = new Set(["COMPLETED", "PENDING"]);

/** `order` verifier (docs/FSD.md §5.4). Throws on anything it can't vouch for. */
export async function orderFacts(sources: OrderSources, orderId: string): Promise<NonNullable<Facts["order"]>> {
  const [details, store] = await Promise.all([sources.getOrderDetails(orderId), sources.storeOrder(orderId)]);
  if (details.id !== orderId) throw new Error("PayPal returned a different order");
  if (!store) throw new Error("Order is not in the store");

  const payments = details.purchase_units.map((unit) => unit.payments ?? {});
  const captures = payments.flatMap((p) => p.captures ?? []).filter((c) => CAPTURED.has(c.status));
  const refunds = payments.flatMap((p) => p.refunds ?? []).filter((r) => REFUNDED.has(r.status));
  const first = captures[0];
  if (!first) throw new Error("Order has no capture");

  const currency = first.amount.currency_code;
  if ([...captures, ...refunds].some((m) => m.amount.currency_code !== currency)) {
    throw new Error("Order mixes currencies");
  }
  const total = (items: { amount: { value: string } }[]) =>
    fromCents(items.reduce((sum, item) => sum + toCents(item.amount.value), 0));

  return {
    id: orderId,
    payer_email: store.payerEmail,
    currency,
    captured: total(captures),
    refunded: total(refunds),
    captured_at: captures.map((c) => c.create_time).sort()[0],
    delivered_at: store.deliveredAt?.toISOString(),
  };
}
