import { describe, expect, it } from "vitest";
import { DOCUMENT_MAX_BYTES, documentProblem, isPolicyId, policyErrorMessage, ruleSummary } from "./policies-view";

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
});
