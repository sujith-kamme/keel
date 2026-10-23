import type { Commitment } from "@keel/core";
import { describe, expect, it } from "vitest";
import { decide } from "./decide";
import type { Facts } from "./facts";

const refundPolicy = {
  policy_id: "refund-standard",
  version: 1,
  type: "REFUND",
  approved_text: "Unused items can be refunded within 30 days of delivery.",
  rules: [
    { rule: "max_amount_le_captured_minus_refunded" },
    { rule: "within_days_of", field: "delivered_at", days: 30 },
    { rule: "payer_verified" },
    { rule: "session_budget_le", amount: "100.00" },
    { rule: "daily_budget_le", amount: "500.00" },
    { rule: "auto_approve_le", amount: "50.00" },
  ],
};

const facts: Facts = {
  now: "2026-10-23T12:00:00Z",
  order: {
    id: "O-1",
    payer_email: "buyer@example.com",
    currency: "USD",
    captured: "120.00",
    refunded: "0.00",
    captured_at: "2026-10-01T12:00:00Z",
    delivered_at: "2026-10-05T12:00:00Z",
  },
  identity: { verified_payer: "buyer@example.com" },
  budget: { session_refunded: "0.00", daily_refunded: "0.00" },
};

function refund(value: string, extra: Partial<Commitment> = {}): Commitment {
  return { id: "c1", type: "REFUND", source: "TOOL_CALL", order_id: "O-1", amount: { value, currency: "USD" }, ...extra };
}

describe("decide", () => {
  it("allows an in-policy refund under the auto-approve limit", () => {
    expect(decide({ commitment: refund("40.00"), policy: refundPolicy, facts })).toEqual({
      verdict: "ALLOW",
      reason_codes: ["OK"],
    });
  });

  it("blocks when no policy exists", () => {
    expect(decide({ commitment: refund("40.00"), policy: null, facts })).toEqual({
      verdict: "BLOCK",
      reason_codes: ["POLICY_NOT_FOUND"],
    });
  });

  it.each([
    ["unknown rule", { ...refundPolicy, rules: [{ rule: "always_allow" }] }],
    ["type mismatch", { ...refundPolicy, type: "DISCOUNT" }],
    ["not an object", "refund everything"],
  ])("blocks an invalid policy (%s)", (_label, policy) => {
    expect(decide({ commitment: refund("40.00"), policy, facts })).toEqual({
      verdict: "BLOCK",
      reason_codes: ["POLICY_INVALID"],
    });
  });

  it("blocks when the commitment cites a different policy", () => {
    const result = decide({ commitment: refund("40.00", { policy_id: "refund-vip" }), policy: refundPolicy, facts });
    expect(result).toEqual({ verdict: "BLOCK", reason_codes: ["POLICY_INVALID"] });
  });

  it("rewrites a free-text refund promise even when it would be in policy", () => {
    expect(decide({ commitment: refund("40.00", { source: "FREE_TEXT" }), policy: refundPolicy, facts })).toEqual({
      verdict: "REWRITE",
      reason_codes: ["FREE_TEXT_COMMITMENT"],
    });
  });

  it.each([
    ["more than captured", refund("130.00"), facts, "BLOCK", "AMOUNT_EXCEEDS_CAPTURED"],
    [
      "already partly refunded",
      refund("90.00"),
      { ...facts, order: { ...facts.order!, refunded: "40.00" } },
      "BLOCK",
      "AMOUNT_EXCEEDS_CAPTURED",
    ],
    ["wrong currency", refund("40.00", { amount: { value: "40.00", currency: "EUR" } }), facts, "BLOCK", "CURRENCY_MISMATCH"],
    ["outside window", refund("40.00"), { ...facts, now: "2026-11-30T12:00:00Z" }, "BLOCK", "OUTSIDE_WINDOW"],
    ["payer not verified", refund("40.00"), { ...facts, identity: {} }, "BLOCK", "PAYER_NOT_VERIFIED"],
    [
      "verified as someone else",
      refund("40.00"),
      { ...facts, identity: { verified_payer: "attacker@example.com" } },
      "BLOCK",
      "PAYER_NOT_VERIFIED",
    ],
    [
      "session budget exceeded",
      refund("40.00"),
      { ...facts, budget: { session_refunded: "70.00", daily_refunded: "70.00" } },
      "HOLD",
      "BUDGET_EXCEEDED",
    ],
    [
      "daily budget exceeded",
      refund("40.00"),
      { ...facts, budget: { session_refunded: "0.00", daily_refunded: "480.00" } },
      "HOLD",
      "BUDGET_EXCEEDED",
    ],
    ["above auto-approve", refund("60.00"), facts, "HOLD", "ABOVE_AUTO_APPROVE"],
  ])("%s → %s %s", (_label, commitment, f, verdict, reason) => {
    expect(decide({ commitment, policy: refundPolicy, facts: f })).toEqual({ verdict, reason_codes: [reason] });
  });

  it("matches the verified payer case-insensitively", () => {
    const f = { ...facts, identity: { verified_payer: "Buyer@Example.com" } };
    expect(decide({ commitment: refund("40.00"), policy: refundPolicy, facts: f }).verdict).toBe("ALLOW");
  });

  it("applies hard rules before budgets and auto-approve regardless of listed order", () => {
    const reversed = { ...refundPolicy, rules: [...refundPolicy.rules].reverse() };
    expect(decide({ commitment: refund("130.00"), policy: reversed, facts })).toEqual({
      verdict: "BLOCK",
      reason_codes: ["AMOUNT_EXCEEDS_CAPTURED"],
    });
  });

  it.each([
    ["missing order", { ...facts, order: undefined }],
    ["malformed captured amount", { ...facts, order: { ...facts.order!, captured: "lots" } }],
    ["malformed delivery date", { ...facts, order: { ...facts.order!, delivered_at: "last week" } }],
    ["missing budget", { ...facts, budget: undefined }],
  ])("fails closed with HOLD when facts are bad (%s)", (_label, f) => {
    expect(decide({ commitment: refund("40.00"), policy: refundPolicy, facts: f })).toEqual({
      verdict: "HOLD",
      reason_codes: ["VERIFIER_UNAVAILABLE"],
    });
  });

  it("blocks a refund request with no amount", () => {
    const commitment: Commitment = { id: "c1", type: "REFUND", source: "TOOL_CALL", order_id: "O-1" };
    expect(decide({ commitment, policy: refundPolicy, facts })).toEqual({
      verdict: "BLOCK",
      reason_codes: ["POLICY_INVALID"],
    });
  });

  describe("discounts, prices and policy claims", () => {
    const discountPolicy = {
      policy_id: "discount-goodwill",
      version: 1,
      type: "DISCOUNT",
      approved_text: "We can offer a goodwill discount of up to 10% on your next order.",
      rules: [{ rule: "discount_percent_le", percent: 10 }],
    };
    const pricePolicy = {
      policy_id: "price-catalog",
      version: 1,
      type: "PRICE",
      approved_text: "Prices are as listed in our catalog.",
      rules: [{ rule: "price_ge_min" }],
    };
    const claimPolicy = {
      policy_id: "policy-bereavement",
      version: 1,
      type: "POLICY_CLAIM",
      approved_text: "We don't offer bereavement refunds; our standard refund policy applies.",
      rules: [],
    };
    const discount = (percent: number): Commitment => ({ id: "d1", type: "DISCOUNT", source: "TOOL_CALL", percent });
    const price = (value: string): Commitment => ({
      id: "p1",
      type: "PRICE",
      source: "TOOL_CALL",
      amount: { value, currency: "USD" },
    });
    const withCatalog: Facts = { ...facts, catalog: { list_price: "89.00", min_price: "79.00" } };

    it("allows a discount at the limit", () => {
      expect(decide({ commitment: discount(10), policy: discountPolicy, facts }).verdict).toBe("ALLOW");
    });

    it("blocks a discount above the limit", () => {
      expect(decide({ commitment: discount(15), policy: discountPolicy, facts })).toEqual({
        verdict: "BLOCK",
        reason_codes: ["DISCOUNT_EXCEEDS_LIMIT"],
      });
    });

    it("blocks a price below the catalog minimum", () => {
      expect(decide({ commitment: price("1.00"), policy: pricePolicy, facts: withCatalog })).toEqual({
        verdict: "BLOCK",
        reason_codes: ["PRICE_BELOW_MIN"],
      });
    });

    it("allows a price at or above the minimum", () => {
      expect(decide({ commitment: price("79.00"), policy: pricePolicy, facts: withCatalog }).verdict).toBe("ALLOW");
    });

    it("allows a tool-made policy statement", () => {
      const claim: Commitment = { id: "q1", type: "POLICY_CLAIM", source: "TOOL_CALL", policy_id: "policy-bereavement" };
      expect(decide({ commitment: claim, policy: claimPolicy, facts }).verdict).toBe("ALLOW");
    });

    it("rewrites a free-text policy statement", () => {
      const claim: Commitment = { id: "q2", type: "POLICY_CLAIM", source: "FREE_TEXT" };
      expect(decide({ commitment: claim, policy: claimPolicy, facts }).verdict).toBe("REWRITE");
    });
  });
});
