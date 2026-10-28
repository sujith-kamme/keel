// Shapes from GET /v1/disputes and GET /v1/disputes/:id, and how the console shows them.

export interface DisputeItem {
  id: string;
  reason: string;
  amount: string;
  currency: string;
  status: string;
  stage: string | null;
  classification: string | null;
  reason_codes: string[];
  action: string | null;
  action_error: string | null;
  outcome: string;
  created_at: string;
  updated_at: string;
}

export interface DisputeLedgerView {
  decision_id: string;
  session_id: string | null;
  tool: string;
  verdict: string;
  reason_codes: string[];
  args: Record<string, unknown> | null;
  action: string | null;
  reviewer: string | null;
  hash: string;
  created_at: string;
}

export interface DisputeDetail extends DisputeItem {
  capture_id: string | null;
  order_id: string | null;
  injection: string | null;
  decision_id: string | null;
  evidence_type: string | null;
  evidence_notes: string | null;
  evidence_sha256: string | null;
  has_evidence: boolean;
  buyer_messages: string[];
  offered: string[];
  decisions: DisputeLedgerView[];
  evidence: DisputeLedgerView[];
  sandbox: boolean;
}

export interface DisputeRow {
  id: string;
  reason: string;
  amount: string;
  classification: string;
  action: string;
  outcome: string;
  updatedAt: string;
}

const DISPUTE_ID = /^[A-Za-z0-9-]{1,64}$/;
export const isDisputeId = (v: unknown): v is string => typeof v === "string" && DISPUTE_ID.test(v);

const REASONS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised payment",
  CREDIT_NOT_PROCESSED: "Refund not processed",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  INCORRECT_AMOUNT: "Incorrect amount",
  PAYMENT_BY_OTHER_MEANS: "Paid another way",
  CANCELED_RECURRING_BILLING: "Cancelled subscription",
  OTHER: "Other",
};
export const reasonLabel = (r: string) => REASONS[r] ?? r;

const ACTIONS: Record<string, string> = {
  WAITING_ON_PAYPAL: "Waiting on PayPal",
  SUBMITTING: "Submitting…",
  EVIDENCE_SUBMITTED: "Evidence submitted",
  CLAIM_ACCEPTED: "Claim accepted",
  AWAITING_OPERATOR: "Needs a decision",
  FAILED: "Failed",
};
export const actionLabel = (a: string | null) => (a ? (ACTIONS[a] ?? a) : "Classifying…");

const CODES: Record<string, string> = {
  DISPUTE_WITHIN_POLICY: "The agent acted within policy; the ledger backs the merchant.",
  DISPUTE_UNHONORED_COMMITMENT: "The ledger shows a refund the customer was owed and never got.",
  DISPUTE_NO_LEDGER_MATCH: "No order or conversation in the ledger matches this payment.",
  DISPUTE_UNSUPPORTED_REASON: "The ledger can't speak to this kind of claim (who made the payment).",
  INJECTION_DETECTED: "The buyer's text tries to give instructions; a person should look.",
  EXTRACTOR_UNAVAILABLE: "The buyer's text couldn't be checked, so Keel won't act alone.",
  CURRENCY_MISMATCH: "The disputed currency doesn't match the payment.",
  OUTSIDE_WINDOW: "Outside the refund window",
  ABOVE_AUTO_APPROVE: "Above the automatic approval limit",
  BUDGET_EXCEEDED: "Over the refund budget",
  AMOUNT_EXCEEDS_CAPTURED: "More than was paid",
  PAYER_NOT_VERIFIED: "Customer not verified",
  RISK_THRESHOLD: "Session quarantined",
  OK: "Within policy",
};
export const codeLabel = (c: string) => CODES[c] ?? c;

export const CLASS_STYLE: Record<string, string> = {
  DEFEND: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  CONCEDE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  REVIEW: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

export const OUTCOME_STYLE: Record<string, string> = {
  WON: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  CONCEDED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  LOST: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  OPEN: "bg-black/10 dark:bg-white/10",
};

export function buildDisputeRows(items: DisputeItem[]): DisputeRow[] {
  return items.map((d) => ({
    id: d.id,
    reason: reasonLabel(d.reason),
    amount: `${d.amount} ${d.currency}`,
    classification: d.classification ?? "",
    action: actionLabel(d.action),
    outcome: d.outcome,
    updatedAt: d.updated_at,
  }));
}

/** Operator buttons: only while open, not yet acted on (or failed), and only what PayPal offers now. */
export function operatorActions(d: Pick<DisputeDetail, "outcome" | "action" | "classification" | "offered" | "has_evidence">): ("evidence" | "accept")[] {
  if (d.outcome !== "OPEN" || !d.classification) return [];
  if (!["AWAITING_OPERATOR", "WAITING_ON_PAYPAL", "FAILED"].includes(d.action ?? "")) return [];
  const out: ("evidence" | "accept")[] = [];
  if (d.has_evidence && d.offered.includes("provide_evidence")) out.push("evidence");
  if (d.offered.includes("accept_claim")) out.push("accept");
  return out;
}

export function disputeErrorMessage(status: number, error?: string): string {
  if (status === 409 && error === "not_offered") return "PayPal doesn't allow that right now. Try again in a few minutes.";
  if (status === 409 && error === "no_evidence") return "No evidence pack: no order matched this dispute.";
  if (status === 409 && error === "already_resolved") return "The dispute is already resolved.";
  if (status === 409 && error?.startsWith("ACTION_NOT_ALLOWED")) return "PayPal doesn't allow that yet (it may still be reviewing).";
  if (status === 409) return "Already acted on.";
  if (status === 404) return "Not found.";
  if (status === 502) return "PayPal failed: see the error on the dispute.";
  return `Request failed (${status}).`;
}
