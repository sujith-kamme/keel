import type { Money, ReasonCode, Verdict } from "./index";

// FSD §10.1: DEFEND / CONCEDE / REVIEW from ledger facts. Pure code; the
// buyer's free text only reaches this as the injection scan's result.

export type DisputeClassification = "DEFEND" | "CONCEDE" | "REVIEW";

/** One offer_refund ledger row for the disputed order, with its review outcome if it was held. */
export interface RefundAttempt {
  decision_id: string;
  amount: Money;
  verdict: Verdict;
  reason_codes: ReasonCode[];
  review: "approved" | "denied" | null;
}

export interface DisputeFacts {
  reason: string;
  amount: Money;
  /** Currency of the matched capture; null when no store order or ledger row matches it. */
  captureCurrency: string | null;
  /** Ledger rows found for the disputed order or capture. */
  ledgerRows: number;
  injection: "none" | "flagged" | "scan_failed";
  refunds: RefundAttempt[];
  /** Total PayPal has refunded on the capture. */
  refunded: Money;
}

// Holds that only wait on approval: every policy check passed, so the customer was owed it.
const APPROVAL_ONLY = new Set<ReasonCode>(["ABOVE_AUTO_APPROVE", "BUDGET_EXCEEDED"]);

// Same rule as @keel/engine's toCents (core can't depend on engine): integer cents, no floats.
function cents(m: Money): number {
  const [whole = "0", frac = ""] = m.value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

const owed = (r: RefundAttempt) =>
  r.verdict === "ALLOW" ||
  (r.verdict === "HOLD" && r.review !== "denied" && r.reason_codes.length > 0 && r.reason_codes.every((c) => APPROVAL_ONLY.has(c)));

export function classifyDispute(f: DisputeFacts): { classification: DisputeClassification; reason_codes: ReasonCode[] } {
  const review = (code: ReasonCode) => ({ classification: "REVIEW" as const, reason_codes: [code] });
  if (f.captureCurrency === null || f.ledgerRows === 0) return review("DISPUTE_NO_LEDGER_MATCH");
  if (f.injection === "flagged") return review("INJECTION_DETECTED");
  if (f.injection === "scan_failed") return review("EXTRACTOR_UNAVAILABLE");
  if (f.reason === "UNAUTHORISED") return review("DISPUTE_UNSUPPORTED_REASON");
  if (f.amount.currency !== f.captureCurrency) return review("CURRENCY_MISMATCH");

  const due = f.refunds.filter(owed).reduce((sum, r) => sum + cents(r.amount), 0);
  if (due > cents(f.refunded)) return { classification: "CONCEDE", reason_codes: ["DISPUTE_UNHONORED_COMMITMENT"] };
  return { classification: "DEFEND", reason_codes: ["DISPUTE_WITHIN_POLICY"] };
}
