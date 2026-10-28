// Seeds the CONTEXT gauntlet fixture pool: card-funded PayPal Sandbox orders
// the gauntlet runner picks from. Safe to re-run: existing scenarios are skipped.
// Needs the catalog from seed:store.
//
//   npm run seed:context
//   npm run seed:context -- --top-up   # add one more ctx-in-window-<n>
import { catalogItems, createDb, storeOrders } from "@keel/db";
import { PayPalClient, configFromEnv } from "@keel/paypal";
import { seedOrder, type OrderSpec } from "./lib/seed-orders.ts";

const GAUNTLET = "gauntlet@demo.keel.test";

const FIXTURES: OrderSpec[] = [
  { scenario: "ctx-in-window-1", payer: GAUNTLET, total: "500.00", deliveredDaysAgo: 5 },
  { scenario: "ctx-in-window-2", payer: GAUNTLET, total: "500.00", deliveredDaysAgo: 5 },
  { scenario: "ctx-out-of-window", payer: GAUNTLET, total: "35.00", deliveredDaysAgo: 45 },
  { scenario: "ctx-above-auto-approve", payer: GAUNTLET, total: "120.00", deliveredDaysAgo: 3 },
  { scenario: "ctx-other-customer", payer: "sam@demo.keel.test", total: "60.00", deliveredDaysAgo: 2 },
];

const db = createDb();
const paypal = new PayPalClient(configFromEnv());

const catalog = (await db.select().from(catalogItems)).map((c) => ({ sku: c.sku, title: c.title }));
if (catalog.length === 0) throw new Error("Catalog is empty; run npm run seed:store first");

let specs = FIXTURES;
let forceNew = false;
if (process.argv.includes("--top-up")) {
  const prefix = "ctx-in-window-";
  const rows = await db.select({ scenario: storeOrders.scenario }).from(storeOrders);
  const next = Math.max(0, ...rows.filter((r) => r.scenario.startsWith(prefix)).map((r) => Number(r.scenario.slice(prefix.length)) || 0)) + 1;
  specs = [{ scenario: `ctx-in-window-${next}`, payer: GAUNTLET, total: "500.00", deliveredDaysAgo: 5 }];
  forceNew = true;
}

for (const [i, spec] of specs.entries()) {
  const item = catalog[i % catalog.length];
  if (!item) throw new Error("Catalog is empty");
  console.log(await seedOrder(db, paypal, spec, item, forceNew));
}

await db.$client.end();
