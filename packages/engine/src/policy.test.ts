import { describe, expect, it } from "vitest";
import { Policy, RULE_STAGE } from "./policy";

const valid = {
  policy_id: "refund-standard",
  version: 1,
  type: "REFUND",
  approved_text: "Unused items can be refunded within 30 days of delivery.",
  rules: [
    { rule: "max_amount_le_captured_minus_refunded" },
    { rule: "within_days_of", field: "delivered_at", days: 30 },
    { rule: "auto_approve_le", amount: "50.00" },
  ],
};

describe("Policy schema", () => {
  it("accepts a valid refund policy", () => {
    expect(Policy.parse(valid).rules).toHaveLength(3);
  });

  it("rejects an unknown rule type", () => {
    expect(Policy.safeParse({ ...valid, rules: [{ rule: "always_allow" }] }).success).toBe(false);
  });

  it("rejects a malformed money limit", () => {
    expect(Policy.safeParse({ ...valid, rules: [{ rule: "auto_approve_le", amount: "50.001" }] }).success).toBe(false);
  });

  it("rejects a non-positive window", () => {
    expect(
      Policy.safeParse({ ...valid, rules: [{ rule: "within_days_of", field: "delivered_at", days: 0 }] }).success,
    ).toBe(false);
  });

  it("orders stages hard < budget < auto-approve", () => {
    expect(RULE_STAGE.payer_verified).toBeLessThan(RULE_STAGE.session_budget_le);
    expect(RULE_STAGE.session_budget_le).toBeLessThan(RULE_STAGE.auto_approve_le);
  });
});
