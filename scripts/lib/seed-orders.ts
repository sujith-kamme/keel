// Shared by the seed scripts: one card-funded PayPal Sandbox order per spec,
// recorded in store_orders. Idempotent per scenario name.
import { randomUUID } from "node:crypto";
import { createDb, eq, storeOrders } from "@keel/db";
import { toCents } from "@keel/engine";
import type { PayPalClient } from "@keel/paypal";

const DAY_MS = 86_400_000;

export interface OrderSpec {
  scenario: string;
  payer: string;
  total: string;
  deliveredDaysAgo: number;
}

export interface CatalogPick {
  sku: string;
  title: string;
}

// Returns the line to print. With forceNew the existing-scenario check is skipped.
export async function seedOrder(
  db: ReturnType<typeof createDb>,
  paypal: PayPalClient,
  spec: OrderSpec,
  item: CatalogPick,
  forceNew = false,
): Promise<string> {
  const { scenario, payer, total, deliveredDaysAgo } = spec;
  if (!forceNew) {
    const [existing] = await db.select().from(storeOrders).where(eq(storeOrders.scenario, scenario));
    if (existing) return `${scenario}: exists (${existing.orderId})`;
  }
  const order = await paypal.createCardOrder({ value: total, currency: "USD" }, item.title.slice(0, 127), `seed-${randomUUID()}`);
  const capture = order.purchase_units[0]?.payments?.captures?.[0];
  if (order.status !== "COMPLETED" || !capture) throw new Error(`${scenario}: order ${order.id} did not capture`);
  if (toCents(capture.amount.value) !== toCents(total)) throw new Error(`${scenario}: captured ${capture.amount.value}`);

  await db.insert(storeOrders).values({
    orderId: order.id,
    captureId: capture.id,
    scenario,
    payerEmail: payer,
    currency: "USD",
    total,
    // One line per order; its price is the scenario total so the demo amounts stay fixed.
    items: [{ sku: item.sku, title: item.title, price: total }],
    deliveredAt: new Date(Date.now() - deliveredDaysAgo * DAY_MS),
  });
  return `${scenario}: ${order.id} (capture ${capture.id}) ${total} USD for ${payer}`;
}
