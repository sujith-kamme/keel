// Sandbox-only dispute steps straight against PayPal (the console has the same buttons).
//
//   npm run dispute:sandbox -- escalate <caseId>
//   npm run dispute:sandbox -- adjudicate <caseId> seller|buyer
import { PayPalClient, configFromEnv } from "@keel/paypal";
import { adjudicate, escalate, getDispute } from "@keel/paypal/disputes";

const paypal = new PayPalClient(configFromEnv());
const [cmd, id, side] = process.argv.slice(2);

if (cmd === "escalate" && id) {
  await escalate(paypal, id, "Requesting PayPal review.");
} else if (cmd === "adjudicate" && id && (side === "seller" || side === "buyer")) {
  await adjudicate(paypal, id, side === "seller" ? "SELLER_FAVOR" : "BUYER_FAVOR");
} else if (!(cmd === "show" && id)) {
  console.log("usage: escalate <caseId> | adjudicate <caseId> seller|buyer | show <caseId>");
  process.exit(1);
}
const d = await getDispute(paypal, id);
console.log(`${d.dispute_id}: ${d.status} (${d.dispute_life_cycle_stage}); PayPal offers: ${(d.links ?? []).map((l) => l.rel).filter((r) => r !== "self").join(", ") || "nothing yet"}`);
