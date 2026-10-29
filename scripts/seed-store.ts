// Seeds the demo store: a catalog from Channel3 product data and one
// card-funded PayPal Sandbox order per demo scenario. Safe to re-run: existing
// catalog items are updated and existing scenarios are skipped.
//
//   npm run seed:store                    # local (.env)
//   npm run seed:store -- --fresh in-policy   # new order for a spent scenario
import { catalogItems, createDb } from "@keel/db";
import { fromCents } from "@keel/engine";
import { PayPalClient, configFromEnv } from "@keel/paypal";
import { seedOrder } from "./lib/seed-orders.ts";

const QUERIES = ["running shoes", "rain jacket", "water bottle"];

const SCENARIOS = [
  { scenario: "in-policy", payer: "maya@gmail.com", total: "42.00", deliveredDaysAgo: 5 },
  { scenario: "out-of-window", payer: "maya@gmail.com", total: "35.00", deliveredDaysAgo: 45 },
  { scenario: "large-order", payer: "maya@gmail.com", total: "120.00", deliveredDaysAgo: 3 },
  { scenario: "other-customer", payer: "sam@gmail.com", total: "60.00", deliveredDaysAgo: 2 },
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
  const forceNew = fresh === s.scenario;
  const spec = { ...s, scenario: forceNew ? `${s.scenario}-${Date.now()}` : s.scenario };
  const item = catalog[i % catalog.length];
  if (!item) throw new Error("Catalog is empty");
  console.log(await seedOrder(db, paypal, spec, item, forceNew));
}

await db.$client.end();
