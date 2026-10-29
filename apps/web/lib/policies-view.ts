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

// Display names for the seeded policies; any other id shows as itself.
const NAMES: Record<string, string> = {
  "refund-standard": "Standard refunds",
  "discount-goodwill": "Goodwill discounts",
  "price-catalog": "Catalog prices",
  "policy-returns": "Returns",
  "policy-bereavement": "Bereavement",
  "policy-shipping": "Shipping",
};
export const policyName = (id: string) => NAMES[id] ?? id;

const TYPES: Record<string, { label: string; tone: string }> = {
  REFUND: { label: "Refund", tone: "info" },
  DISCOUNT: { label: "Discount", tone: "vio" },
  PRICE: { label: "Price", tone: "rose" },
  POLICY_CLAIM: { label: "Stated policy", tone: "" },
};
/** Badge wording and tone (a .bdg modifier) for a policy type. */
export const policyType = (type: string) => TYPES[type] ?? { label: type, tone: "" };

/** What a policy's active version enforces, in one line. */
export const enforces = (rules: Rule[]) => (rules.length === 0 ? "Reply text only" : rules.map(ruleSummary).join(" · "));

/** The rule's name and its one parameter, as the engine stores them. */
export function ruleParams(r: Rule): string {
  switch (r.rule) {
    case "within_days_of":
      return `${r.rule} · ${r.field} · ${r.days}`;
    case "discount_percent_le":
      return `${r.rule} · ${r.percent}`;
    case "session_budget_le":
    case "daily_budget_le":
    case "auto_approve_le":
      return `${r.rule} · ${r.amount}`;
    default:
      return r.rule;
  }
}

/** The verdict when a rule fails, as packages/engine/src/rules.ts returns it: budgets and approval limits hold, the rest block. */
export function ruleOnFailure(r: Rule): "Block" | "Hold" {
  return r.rule === "session_budget_le" || r.rule === "daily_budget_le" || r.rule === "auto_approve_le" ? "Hold" : "Block";
}

// One diff row per rule kind (within_days_of per field), named for the operator.
const RULE_NAMES: Record<Rule["rule"], string> = {
  max_amount_le_captured_minus_refunded: "No more than was paid",
  within_days_of: "Refund window",
  payer_verified: "Verified buyer only",
  discount_percent_le: "Discount limit",
  price_ge_min: "Catalog minimum price",
  session_budget_le: "Per conversation",
  daily_budget_le: "Per day",
  auto_approve_le: "Auto-approve up to",
};
const ruleKey = (r: Rule) => (r.rule === "within_days_of" ? `${r.rule}:${r.field}` : r.rule);
function ruleValue(r: Rule): string {
  switch (r.rule) {
    case "within_days_of":
      return `${plural(r.days, "day")} of ${r.field === "delivered_at" ? "delivery" : "payment"}`;
    case "discount_percent_le":
      return `${r.percent}%`;
    case "session_budget_le":
    case "daily_budget_le":
    case "auto_approve_le":
      return `$${r.amount}`;
    default:
      return "On";
  }
}

export interface DiffRow {
  label: string;
  before: string | null;
  after: string | null;
  changed: boolean;
}

/** Active vs draft: the customer-facing text, then each rule kind in either version (null where a version lacks it). */
export function policyDiff(active: Pick<PolicyRow, "approved_text" | "rules"> | null, draft: Pick<PolicyRow, "approved_text" | "rules">): DiffRow[] {
  const rows: DiffRow[] = [];
  const text = active?.approved_text ?? null;
  rows.push({ label: "Customer-facing text", before: text, after: draft.approved_text, changed: text !== draft.approved_text });
  const was = new Map((active?.rules ?? []).map((r) => [ruleKey(r), r]));
  const now = new Map(draft.rules.map((r) => [ruleKey(r), r]));
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(key);
    const b = now.get(key);
    const before = a ? ruleValue(a) : null;
    const after = b ? ruleValue(b) : null;
    rows.push({ label: RULE_NAMES[(a ?? b)!.rule], before, after, changed: before !== after });
  }
  return rows;
}

/** "Oct 28" in UTC; the input when it isn't a date. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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
