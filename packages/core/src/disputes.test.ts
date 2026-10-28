import { describe, expect, it } from "vitest";
import { type DisputeFacts, type RefundAttempt, classifyDispute } from "./disputes";

const usd = (value: string) => ({ value, currency: "USD" });

const base: DisputeFacts = {
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  amount: usd("35.00"),
  captureCurrency: "USD",
  ledgerRows: 4,
  injection: "none",
  refunds: [],
  refunded: usd("0.00"),
};

const attempt = (over: Partial<RefundAttempt>): RefundAttempt => ({
  decision_id: "d1",
  amount: usd("35.00"),
  verdict: "BLOCK",
  reason_codes: ["OUTSIDE_WINDOW"],
  review: null,
  ...over,
});

describe("classifyDispute", () => {
  it("reviews a dispute with no matching order", () => {
    expect(classifyDispute({ ...base, captureCurrency: null })).toEqual({ classification: "REVIEW", reason_codes: ["DISPUTE_NO_LEDGER_MATCH"] });
  });

  it("reviews a matched order that has no ledger rows", () => {
    expect(classifyDispute({ ...base, ledgerRows: 0 })).toEqual({ classification: "REVIEW", reason_codes: ["DISPUTE_NO_LEDGER_MATCH"] });
  });

  it("reviews when the buyer's text carries an injection", () => {
    expect(classifyDispute({ ...base, injection: "flagged" })).toEqual({ classification: "REVIEW", reason_codes: ["INJECTION_DETECTED"] });
  });

  it("reviews when the injection scan failed (fail closed)", () => {
    expect(classifyDispute({ ...base, injection: "scan_failed" })).toEqual({ classification: "REVIEW", reason_codes: ["EXTRACTOR_UNAVAILABLE"] });
  });

  it("reviews unauthorised-payment disputes", () => {
    expect(classifyDispute({ ...base, reason: "UNAUTHORISED" })).toEqual({ classification: "REVIEW", reason_codes: ["DISPUTE_UNSUPPORTED_REASON"] });
  });

  it("reviews a currency mismatch", () => {
    expect(classifyDispute({ ...base, amount: { value: "35.00", currency: "EUR" } })).toEqual({ classification: "REVIEW", reason_codes: ["CURRENCY_MISMATCH"] });
  });

  it("concedes an allowed refund that PayPal never paid", () => {
    const f = { ...base, refunds: [attempt({ verdict: "ALLOW", reason_codes: ["OK"] })] };
    expect(classifyDispute(f)).toEqual({ classification: "CONCEDE", reason_codes: ["DISPUTE_UNHONORED_COMMITMENT"] });
  });

  it("concedes a refund held only for approval that nobody actioned", () => {
    const f = { ...base, amount: usd("120.00"), refunds: [attempt({ amount: usd("120.00"), verdict: "HOLD", reason_codes: ["ABOVE_AUTO_APPROVE"] })] };
    expect(classifyDispute(f).classification).toBe("CONCEDE");
  });

  it("concedes a refund held only for the budget", () => {
    const f = { ...base, refunds: [attempt({ verdict: "HOLD", reason_codes: ["BUDGET_EXCEEDED"] })] };
    expect(classifyDispute(f).classification).toBe("CONCEDE");
  });

  it("defends a held refund that was approved and paid", () => {
    const f = { ...base, amount: usd("120.00"), refunded: usd("120.00"), refunds: [attempt({ amount: usd("120.00"), verdict: "HOLD", reason_codes: ["ABOVE_AUTO_APPROVE"], review: "approved" })] };
    expect(classifyDispute(f)).toEqual({ classification: "DEFEND", reason_codes: ["DISPUTE_WITHIN_POLICY"] });
  });

  it("defends a held-for-approval refund the reviewer denied", () => {
    const f = { ...base, refunds: [attempt({ verdict: "HOLD", reason_codes: ["ABOVE_AUTO_APPROVE"], review: "denied" })] };
    expect(classifyDispute(f).classification).toBe("DEFEND");
  });

  it("defends a refund held for a real policy reason", () => {
    const f = { ...base, refunds: [attempt({ verdict: "HOLD", reason_codes: ["ABOVE_AUTO_APPROVE", "OUTSIDE_WINDOW"] })] };
    expect(classifyDispute(f).classification).toBe("DEFEND");
  });

  it("defends a refund held by quarantine", () => {
    const f = { ...base, refunds: [attempt({ verdict: "HOLD", reason_codes: ["RISK_THRESHOLD"] })] };
    expect(classifyDispute(f).classification).toBe("DEFEND");
  });

  it("defends a blocked out-of-window refund", () => {
    expect(classifyDispute({ ...base, refunds: [attempt({})] })).toEqual({ classification: "DEFEND", reason_codes: ["DISPUTE_WITHIN_POLICY"] });
  });

  it("defends when an allowed refund was paid", () => {
    const f = { ...base, refunded: usd("20.00"), refunds: [attempt({ amount: usd("20.00"), verdict: "ALLOW", reason_codes: ["OK"] })] };
    expect(classifyDispute(f).classification).toBe("DEFEND");
  });

  it("concedes when only part of what was owed was paid", () => {
    const f = { ...base, refunded: usd("20.00"), refunds: [
      attempt({ decision_id: "d1", amount: usd("20.00"), verdict: "ALLOW", reason_codes: ["OK"] }),
      attempt({ decision_id: "d2", amount: usd("15.00"), verdict: "ALLOW", reason_codes: ["OK"] }),
    ] };
    expect(classifyDispute(f).classification).toBe("CONCEDE");
  });

  it("checks review reasons before concede reasons", () => {
    const f = { ...base, injection: "flagged" as const, refunds: [attempt({ verdict: "ALLOW", reason_codes: ["OK"] })] };
    expect(classifyDispute(f).classification).toBe("REVIEW");
  });
});
