// Demo orders that can be disputed (FR-DSP-7). PayPal only lets a buyer account
// open a dispute on a payment it made, so these orders are paid by the sandbox
// personal account through a normal approval, unlike the card-funded store orders.
//
//   npm run dispute:orders -- create                       # prints an approval link per missing order
//     Pay with the account's PayPal balance or card, not its bank: a bank (eCheck)
//     capture stays PENDING for days and Keel's order check won't vouch for it.
//   npm run dispute:orders -- capture <scenario> <orderId>  # after approving as the personal account
//   npm run dispute:orders -- create --fresh dispute-defend # a new order for a spent scenario
//
// Demo prep, once both are captured:
//   1. In the store, as maya@demo.keel.test, ask for a refund on each order. The $35.00
//      one is refused (outside the 30-day window); the $80.00 one is held for approval
//      (above the $50 auto-approve limit, under the $100 a session may refund at all).
//      Leave the hold in the review queue.
//   2. As the sandbox personal account, open a dispute on each payment from the
//      Resolution Center ("I didn't receive an item", full amount).
//   3. Keel classifies them within a few minutes of PayPal opening them; see /disputes.
import { randomUUID } from "node:crypto";
import { catalogItems, createDb, eq, storeOrders } from "@keel/db";
import { toCents } from "@keel/engine";
import { PayPalClient, configFromEnv } from "@keel/paypal";

const DAY_MS = 86_400_000;
const SCENARIOS = {
  "dispute-defend": { total: "35.00", deliveredDaysAgo: 45 },
  "dispute-concede": { total: "80.00", deliveredDaysAgo: 3 },
} as const;
type Scenario = keyof typeof SCENARIOS;
const PAYER = "maya@demo.keel.test";

const db = createDb();
const paypal = new PayPalClient(configFromEnv());
const [cmd, ...rest] = process.argv.slice(2);
const isScenario = (s: string | undefined): s is Scenario => s !== undefined && s in SCENARIOS;

async function item() {
  const [first] = await db.select({ sku: catalogItems.sku, title: catalogItems.title }).from(catalogItems).limit(1);
  if (!first) throw new Error("Catalog is empty: run npm run seed:store first");
  return first;
}

if (cmd === "create") {
  const freshAt = rest.indexOf("--fresh");
  const fresh = freshAt === -1 ? null : rest[freshAt + 1];
  if (fresh !== null && !isScenario(fresh)) throw new Error(`--fresh takes one of ${Object.keys(SCENARIOS).join(", ")}`);
  const { title } = await item();
  const returnUrl = `${process.env.CONSOLE_URL ?? "http://localhost:3000"}/store`;
  for (const [scenario, spec] of Object.entries(SCENARIOS) as [Scenario, (typeof SCENARIOS)[Scenario]][]) {
    if (fresh !== scenario) {
      const [existing] = await db.select().from(storeOrders).where(eq(storeOrders.scenario, scenario));
      if (existing) {
        console.log(`${scenario}: exists (order ${existing.orderId}, capture ${existing.captureId})`);
        continue;
      }
    }
    const order = await paypal.request<{ id: string; links: { rel: string; href: string }[] }>("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{ description: title.slice(0, 127), amount: { currency_code: "USD", value: spec.total } }],
      payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: returnUrl, user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING" } } },
    }, `dispute-order-${randomUUID()}`);
    const link = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    console.log(`${scenario} (${spec.total} USD): approve as the sandbox personal account at\n  ${link}\nthen: npm run dispute:orders -- capture ${scenario} ${order.id}`);
  }
} else if (cmd === "capture" && isScenario(rest[0]) && rest[1]) {
  const scenario = rest[0];
  const spec = SCENARIOS[scenario];
  const orderId = rest[1];
  const captured = await paypal.request<{ status: string; purchase_units: { payments?: { captures?: { id: string; status: string; amount: { value: string } }[] } }[] }>(
    "POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `dispute-capture-${orderId}`,
  );
  const capture = captured.purchase_units[0]?.payments?.captures?.[0];
  if (captured.status !== "COMPLETED" || !capture) throw new Error(`${scenario}: order ${orderId} did not capture`);
  if (capture.status !== "COMPLETED") throw new Error(`${scenario}: capture ${capture.id} is ${capture.status} (paid by bank?); approve a fresh order with balance or card`);
  if (toCents(capture.amount.value) !== toCents(spec.total)) throw new Error(`${scenario}: captured ${capture.amount.value}`);
  const { sku, title } = await item();
  // A re-created scenario keeps its name; the older row is renamed out of the way.
  await db.update(storeOrders).set({ scenario: `${scenario}-${Date.now()}` }).where(eq(storeOrders.scenario, scenario));
  await db.insert(storeOrders).values({
    orderId,
    captureId: capture.id,
    scenario,
    payerEmail: PAYER,
    currency: "USD",
    total: spec.total,
    items: [{ sku, title, price: spec.total }],
    deliveredAt: new Date(Date.now() - spec.deliveredDaysAgo * DAY_MS),
  });
  console.log(`${scenario}: ${orderId} (capture ${capture.id}) ${spec.total} USD for ${PAYER}`);
} else {
  console.log("usage: create [--fresh <scenario>] | capture <dispute-defend|dispute-concede> <orderId>");
  process.exitCode = 1;
}

await db.$client.end();
