import { describe, expect, it } from "vitest";
import { DOCUMENT_MAX_BYTES, documentProblem, enforces, isPolicyId, policyDiff, policyErrorMessage, policyName, policyType, ruleOnFailure, ruleParams, ruleSummary, shortDate } from "./policies-view";

describe("policies view", () => {
  it("words every rule type", () => {
    expect(ruleSummary({ rule: "within_days_of", field: "delivered_at", days: 30 })).toBe("Within 30 days of delivery");
    expect(ruleSummary({ rule: "within_days_of", field: "captured_at", days: 1 })).toBe("Within 1 day of payment");
    expect(ruleSummary({ rule: "max_amount_le_captured_minus_refunded" })).toBe("No more than was paid, minus earlier refunds");
    expect(ruleSummary({ rule: "payer_verified" })).toBe("Only to the verified buyer");
    expect(ruleSummary({ rule: "discount_percent_le", percent: 10 })).toBe("Discounts up to 10%");
    expect(ruleSummary({ rule: "price_ge_min" })).toBe("Never below the catalog minimum price");
    expect(ruleSummary({ rule: "session_budget_le", amount: "100.00" })).toBe("Up to $100.00 per conversation");
    expect(ruleSummary({ rule: "daily_budget_le", amount: "500.00" })).toBe("Up to $500.00 per day");
    expect(ruleSummary({ rule: "auto_approve_le", amount: "50.00" })).toBe("Over $50.00 needs a person to approve");
  });

  it("validates policy ids", () => {
    expect(isPolicyId("refund-standard")).toBe(true);
    for (const v of ["../x", "Refund", "", "a b", 7]) expect(isPolicyId(v)).toBe(false);
  });

  it("checks documents", () => {
    expect(documentProblem("Refunds within 45 days.")).toBeNull();
    expect(documentProblem("   ")).toBe("Paste or upload a policy document.");
    expect(documentProblem("x".repeat(DOCUMENT_MAX_BYTES + 1))).toBe("The document is over 50 KB.");
    // Bytes, not characters: 20,000 three-byte characters are 60 KB.
    expect(documentProblem("€".repeat(20_000))).toBe("The document is over 50 KB.");
  });

  it("explains API failures", () => {
    expect(policyErrorMessage(422)).toBe("Couldn't turn that document into a policy.");
    expect(policyErrorMessage(504)).toBe("Drafting took too long. Try a shorter document.");
    expect(policyErrorMessage(409)).toBe("This version is no longer a draft.");
    expect(policyErrorMessage(500)).toBe("Request failed (500).");
  });

  it("names policies and types, falling back to the raw value", () => {
    expect(policyName("refund-standard")).toBe("Standard refunds");
    expect(policyName("custom-x")).toBe("custom-x");
    expect(policyType("POLICY_CLAIM")).toEqual({ label: "Stated policy", tone: "" });
    expect(policyType("REFUND")).toEqual({ label: "Refund", tone: "info" });
    expect(policyType("NEW")).toEqual({ label: "NEW", tone: "" });
  });

  it("summarises rules, their parameters and what a failure does", () => {
    expect(enforces([])).toBe("Reply text only");
    expect(enforces([{ rule: "discount_percent_le", percent: 10 }, { rule: "price_ge_min" }])).toBe("Discounts up to 10% · Never below the catalog minimum price");
    expect(ruleParams({ rule: "within_days_of", field: "delivered_at", days: 30 })).toBe("within_days_of · delivered_at · 30");
    expect(ruleParams({ rule: "auto_approve_le", amount: "50.00" })).toBe("auto_approve_le · 50.00");
    expect(ruleParams({ rule: "payer_verified" })).toBe("payer_verified");
    expect(ruleOnFailure({ rule: "payer_verified" })).toBe("Block");
    expect(ruleOnFailure({ rule: "daily_budget_le", amount: "500.00" })).toBe("Hold");
  });

  it("diffs a draft against the active version", () => {
    const active = {
      approved_text: "Refunds within 30 days.",
      rules: [
        { rule: "within_days_of" as const, field: "delivered_at" as const, days: 30 },
        { rule: "auto_approve_le" as const, amount: "50.00" },
        { rule: "payer_verified" as const },
      ],
    };
    const draft = {
      approved_text: "Refunds within 30 days.",
      rules: [
        { rule: "within_days_of" as const, field: "delivered_at" as const, days: 45 },
        { rule: "auto_approve_le" as const, amount: "50.00" },
        { rule: "daily_budget_le" as const, amount: "500.00" },
      ],
    };
    expect(policyDiff(active, draft)).toEqual([
      { label: "Customer-facing text", before: "Refunds within 30 days.", after: "Refunds within 30 days.", changed: false },
      { label: "Refund window", before: "30 days of delivery", after: "45 days of delivery", changed: true },
      { label: "Auto-approve up to", before: "$50.00", after: "$50.00", changed: false },
      { label: "Verified buyer only", before: "On", after: null, changed: true },
      { label: "Per day", before: null, after: "$500.00", changed: true },
    ]);
    expect(policyDiff(null, { approved_text: "x", rules: [] })).toEqual([{ label: "Customer-facing text", before: null, after: "x", changed: true }]);
  });

  it("formats short dates in UTC", () => {
    expect(shortDate("2026-10-28T23:59:00Z")).toBe("Oct 28");
    expect(shortDate("bad")).toBe("bad");
  });
});
