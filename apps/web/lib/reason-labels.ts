// Short labels for @keel/core's ReasonCode enum. A drift test (apps/api/src/web-mirror.test.ts) keeps the keys in step.
export const REASON_LABELS: Record<string, string> = {
  OK: "Within policy",
  CAPABILITY_OUT_OF_SCOPE: "Capability out of scope",
  POLICY_NOT_FOUND: "No policy covers it",
  POLICY_UNAPPROVED_CLAIM: "Policy claim not in approved wording",
  FREE_TEXT_COMMITMENT: "Promise made in free text",
  AMOUNT_EXCEEDS_CAPTURED: "More than was paid",
  CURRENCY_MISMATCH: "Currency mismatch",
  OUTSIDE_WINDOW: "Outside the refund window",
  PAYER_NOT_VERIFIED: "Customer not verified",
  BUDGET_EXCEEDED: "Over the refund budget",
  ABOVE_AUTO_APPROVE: "Above the automatic approval limit",
  DISCOUNT_EXCEEDS_LIMIT: "Discount over the limit",
  PRICE_BELOW_MIN: "Below the minimum price",
  INJECTION_DETECTED: "Prompt injection detected",
  RISK_THRESHOLD: "Session quarantined",
  EXTRACTOR_UNAVAILABLE: "Reply check unavailable",
  VERIFIER_UNAVAILABLE: "Verifier unavailable",
  POLICY_INVALID: "Invalid policy",
  AGENT_FROZEN: "Agent frozen",
  DISPUTE_NO_LEDGER_MATCH: "No ledger match for the dispute",
  DISPUTE_UNHONORED_COMMITMENT: "Refund owed and never paid",
  DISPUTE_WITHIN_POLICY: "Agent acted within policy",
  DISPUTE_UNSUPPORTED_REASON: "Dispute reason the ledger can't answer",
};

/** Friendly label for a reason code; the raw code when it isn't known. */
export const reasonLabel = (code: string) => REASON_LABELS[code] ?? code;
