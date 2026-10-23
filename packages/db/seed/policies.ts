// Seeds the demo store's approved policies. Safe to re-run: existing
// (policy_id, version) pairs are left untouched.
import { Policy } from "@keel/engine";
import { createDb, policies } from "../src/index";

const demoPolicies: Policy[] = [
  {
    policy_id: "refund-standard",
    version: 1,
    type: "REFUND",
    approved_text: "Unused items can be refunded within 30 days of delivery, up to the amount you paid.",
    rules: [
      { rule: "max_amount_le_captured_minus_refunded" },
      { rule: "within_days_of", field: "delivered_at", days: 30 },
      { rule: "payer_verified" },
      { rule: "session_budget_le", amount: "100.00" },
      { rule: "daily_budget_le", amount: "500.00" },
      { rule: "auto_approve_le", amount: "50.00" },
    ],
  },
  {
    policy_id: "discount-goodwill",
    version: 1,
    type: "DISCOUNT",
    approved_text: "We can offer a goodwill discount of up to 10% on your next order.",
    rules: [{ rule: "discount_percent_le", percent: 10 }],
  },
  {
    policy_id: "price-catalog",
    version: 1,
    type: "PRICE",
    approved_text: "Prices are as listed in our catalog.",
    rules: [{ rule: "price_ge_min" }],
  },
  {
    policy_id: "policy-returns",
    version: 1,
    type: "POLICY_CLAIM",
    approved_text: "Returns are accepted within 30 days of delivery for unused items in their original packaging.",
    rules: [],
  },
  {
    policy_id: "policy-bereavement",
    version: 1,
    type: "POLICY_CLAIM",
    approved_text: "We don't offer special bereavement refunds; our standard refund policy applies to every order.",
    rules: [],
  },
  {
    policy_id: "policy-shipping",
    version: 1,
    type: "POLICY_CLAIM",
    approved_text: "Standard shipping takes 3 to 7 business days.",
    rules: [],
  },
];

const db = createDb();
const rows = demoPolicies.map((p) => {
  const valid = Policy.parse(p);
  return {
    policyId: valid.policy_id,
    version: valid.version,
    type: valid.type,
    approvedText: valid.approved_text,
    rules: valid.rules,
    status: "APPROVED",
  };
});
const inserted = await db.insert(policies).values(rows).onConflictDoNothing().returning({ id: policies.policyId });
console.log(`Seeded ${inserted.length} new policies (${rows.length - inserted.length} already present).`);
await db.$client.end();
