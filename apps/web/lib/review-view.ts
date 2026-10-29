import { type AgentId, isAgentId as isRegistryAgent } from "@keel/agent/agents";
import { toolLabel, usd } from "./overview-view";
import { reasonLabel } from "./reason-labels";

export interface ReviewItem {
  kind: "held_action" | "session";
  decision_id?: string;
  session_id: string;
  tool?: string;
  args?: Record<string, unknown>;
  reason_codes: string[];
  score: number | null;
  session_state: string;
  created_at: string;
}

export type ReviewTab = "held" | "quarantined" | "escalated";

export interface ReviewRow {
  id: string;
  kind: ReviewItem["kind"];
  tab: ReviewTab;
  decisionId: string | null;
  sessionId: string;
  /** "Refund", "Discount", or the flagged session's state. */
  action: string;
  /** Dollar amount as sent ("12.50"), "10%" for a discount, "" for a session. */
  amount: string;
  order: string;
  /** Reason labels, comma-separated. */
  reasons: string;
  createdAt: string;
  canRelease: boolean;
}

const FLAGGED = ["QUARANTINED", "ESCALATED"];

export const canRelease = (state: string) => FLAGGED.includes(state);

const DECISION_ID = /^dec_[A-Za-z0-9]{1,64}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isDecisionId = (v: unknown): v is string => typeof v === "string" && DECISION_ID.test(v);
export const isSessionId = (v: unknown): v is string => typeof v === "string" && SESSION_ID.test(v);
export const isAgentId = (v: unknown): v is AgentId | "*" => v === "*" || isRegistryAgent(v);

function amountOf(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  if (typeof args.amount === "string" || typeof args.amount === "number") return String(args.amount);
  if (typeof args.percent === "string" || typeof args.percent === "number") return `${args.percent}%`;
  return "";
}

/** "$12.50" for a dollar amount, the percent as is, "—" when there is none. */
export const amountText = (amount: string) => (amount === "" ? "—" : amount.endsWith("%") ? amount : usd(amount));

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function buildRows(items: ReviewItem[]): ReviewRow[] {
  return items.map((i) => {
    const held = i.kind === "held_action";
    return {
      id: held && i.decision_id ? i.decision_id : `session:${i.session_id}`,
      kind: i.kind,
      tab: held ? "held" : i.session_state === "ESCALATED" ? "escalated" : "quarantined",
      decisionId: i.decision_id ?? null,
      sessionId: i.session_id,
      action: held ? toolLabel(i.tool ?? "") : i.session_state === "ESCALATED" ? "Escalated conversation" : "Quarantined conversation",
      amount: amountOf(i.args),
      order: str(i.args?.order_id),
      reasons: i.reason_codes.map(reasonLabel).join(", "),
      createdAt: i.created_at,
      canRelease: !held && canRelease(i.session_state),
    };
  });
}

/** Reason codes a policy rule produces: the item page links these to the policy the action cited. */
const POLICY_REASONS = new Set([
  "AMOUNT_EXCEEDS_CAPTURED",
  "OUTSIDE_WINDOW",
  "PAYER_NOT_VERIFIED",
  "BUDGET_EXCEEDED",
  "ABOVE_AUTO_APPROVE",
  "DISCOUNT_EXCEEDS_LIMIT",
  "PRICE_BELOW_MIN",
]);
export const fromPolicy = (code: string) => POLICY_REASONS.has(code);

/** Short inline message for a failed operator call. */
/** GET /v1/review returns at most this many items (LIMIT in apps/api/src/routes/review.ts). */
export const REVIEW_LIMIT = 200;

export function errorMessage(status: number, error?: string, reasonCode?: string): string {
  if (status === 409 && error === "payment_unconfirmed") return "Payment unconfirmed: retry approve.";
  if (status === 409 && error === "not_flagged") return "Conversation is no longer flagged.";
  if (status === 409) return "Already resolved.";
  if (status === 404) return "Not found.";
  if (status === 422) return `Blocked: ${reasonCode ?? "refused"}`;
  if (status === 502) return "PayPal failed: retry.";
  if (status === 503) return "Facts unavailable: retry.";
  return `Request failed (${status}).`;
}
