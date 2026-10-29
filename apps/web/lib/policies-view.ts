// Mirrors the engine's Rule schema (packages/engine/src/policy.ts); the API validates every edit with it.
export type Rule =
  | { rule: "max_amount_le_captured_minus_refunded" }
  | { rule: "within_days_of"; field: "captured_at" | "delivered_at"; days: number }
  | { rule: "payer_verified" }
  | { rule: "discount_percent_le"; percent: number }
  | { rule: "price_ge_min" }
  | { rule: "session_budget_le"; amount: string }
  | { rule: "daily_budget_le"; amount: string }
  | { rule: "auto_approve_le"; amount: string };

export interface PolicyRow {
  policy_id: string;
  version: number;
  type: string;
  approved_text: string;
  rules: Rule[];
  status: "DRAFT" | "APPROVED" | "DISCARDED";
  created_at: string;
}
export type PolicyVersion = PolicyRow & { approved_by: string | null; approved_at: string | null };
export interface PolicySummary {
  policy_id: string;
  type: string;
  active: PolicyRow | null;
  draft: PolicyRow | null;
}

/** The API takes up to 50,000 characters; capping bytes keeps both that and the 64 KB body limit. */
export const DOCUMENT_MAX_BYTES = 50_000;

export const isPolicyId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9-]{1,64}$/.test(v);

export function documentProblem(text: string): string | null {
  if (text.trim().length === 0) return "Paste or upload a policy document.";
  if (new TextEncoder().encode(text).length > DOCUMENT_MAX_BYTES) return "The document is over 50 KB.";
  return null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ruleSummary(r: Rule): string {
  switch (r.rule) {
    case "max_amount_le_captured_minus_refunded":
      return "No more than was paid, minus earlier refunds";
    case "within_days_of":
      return `Within ${plural(r.days, "day")} of ${r.field === "delivered_at" ? "delivery" : "payment"}`;
    case "payer_verified":
      return "Only to the verified buyer";
    case "discount_percent_le":
      return `Discounts up to ${r.percent}%`;
    case "price_ge_min":
      return "Never below the catalog minimum price";
    case "session_budget_le":
      return `Up to $${r.amount} per conversation`;
    case "daily_budget_le":
      return `Up to $${r.amount} per day`;
    case "auto_approve_le":
      return `Over $${r.amount} needs a person to approve`;
  }
}

export function policyErrorMessage(status: number, error?: string): string {
  if (status === 422 || error === "not_understood") return "Couldn't turn that document into a policy.";
  if (status === 504) return "Drafting took too long. Try a shorter document.";
  if (status === 502) return "The drafting model is unavailable. Try again.";
  if (status === 413) return "The document is too large.";
  if (status === 409) return "This version is no longer a draft.";
  if (status === 404) return "Not found.";
  if (status === 400) return "Invalid request: check every rule's values.";
  return `Request failed (${status}).`;
}
