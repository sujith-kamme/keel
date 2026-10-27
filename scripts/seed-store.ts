// Seeds the demo store: a catalog from Channel3 product data and one
// card-funded PayPal Sandbox order per demo scenario. Safe to re-run: existing
// catalog items are updated and existing scenarios are skipped.
//
//   npm run seed:store                    # local (.env)
//   npm run seed:store -- --fresh in-policy   # new order for a spent scenario
import { randomUUID } from "node:crypto";
import { catalogItems, createDb, eq, storeOrders } from "@keel/db";
import { fromCents, toCents } from "@keel/engine";
import { PayPalClient, configFromEnv } from "@keel/paypal";

const DAY_MS = 86_400_000;
const QUERIES = ["running shoes", "rain jacket", "water bottle"];

const SCENARIOS = [
  { scenario: "in-policy", payer: "maya@demo.keel.test", total: "42.00", deliveredDaysAgo: 5 },
  { scenario: "out-of-window", payer: "maya@demo.keel.test", total: "35.00", deliveredDaysAgo: 45 },
  { scenario: "large-order", payer: "maya@demo.keel.test", total: "120.00", deliveredDaysAgo: 3 },
  { scenario: "other-customer", payer: "sam@demo.keel.test", total: "60.00", deliveredDaysAgo: 2 },
];

interface Channel3Product {
  id: string;
  title: string;
  images?: { url: string; is_main_image?: boolean }[];
  offers?: { price?: { price: number; currency: string } }[];
}

async function searchChannel3(query: string): Promise<Channel3Product[]> {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) throw new Error("CHANNEL3_API_KEY must be set");
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Channel3 search failed with ${res.status}`);
  return ((await res.json()) as { products: Channel3Product[] }).products;
}

const db = createDb();
const paypal = new PayPalClient(configFromEnv());

// 1. Catalog
const catalog: { sku: string; title: string }[] = [];
for (const query of QUERIES) {
  const products = (await searchChannel3(query))
    .map((p) => ({ p, price: p.offers?.find((o) => o.price?.currency === "USD")?.price?.price }))
    .filter((x): x is { p: Channel3Product; price: number } => typeof x.price === "number" && x.price > 0)
    .slice(0, 4);
  for (const { p, price } of products) {
    const list = Math.round(price * 100);
    const row = {
      sku: `SKU-${p.id}`,
      channel3Id: p.id,
      title: p.title,
      imageUrl: (p.images?.find((i) => i.is_main_image) ?? p.images?.[0])?.url ?? null,
      listPrice: fromCents(list),
      minPrice: fromCents(Math.floor(list * 0.8)),
      currency: "USD",
    };
    await db.insert(catalogItems).values(row).onConflictDoUpdate({ target: catalogItems.channel3Id, set: row });
    catalog.push({ sku: row.sku, title: row.title });
  }
}
console.log(`Catalog: ${catalog.length} products from Channel3.`);

// 2. Orders
const freshIndex = process.argv.indexOf("--fresh");
const fresh = freshIndex === -1 ? null : process.argv[freshIndex + 1];

for (const [i, s] of SCENARIOS.entries()) {
  let scenario = s.scenario;
  if (fresh === s.scenario) scenario = `${s.scenario}-${Date.now()}`;
  else {
    const [existing] = await db.select().from(storeOrders).where(eq(storeOrders.scenario, scenario));
    if (existing) {
      console.log(`${scenario}: exists (${existing.orderId})`);
      continue;
    }
  }
  const item = catalog[i % catalog.length];
  if (!item) throw new Error("Catalog is empty");
  const order = await paypal.createCardOrder({ value: s.total, currency: "USD" }, item.title.slice(0, 127), `seed-${randomUUID()}`);
  const capture = order.purchase_units[0]?.payments?.captures?.[0];
  if (order.status !== "COMPLETED" || !capture) throw new Error(`${scenario}: order ${order.id} did not capture`);
  if (toCents(capture.amount.value) !== toCents(s.total)) throw new Error(`${scenario}: captured ${capture.amount.value}`);

  await db.insert(storeOrders).values({
    orderId: order.id,
    captureId: capture.id,
    scenario,
    payerEmail: s.payer,
    currency: "USD",
    total: s.total,
    // One line per order; its price is the scenario total so the demo amounts stay fixed.
    items: [{ sku: item.sku, title: item.title, price: s.total }],
    deliveredAt: new Date(Date.now() - s.deliveredDaysAgo * DAY_MS),
  });
  console.log(`${scenario}: ${order.id} (capture ${capture.id}) ${s.total} USD for ${s.payer}`);
}

await db.$client.end();
