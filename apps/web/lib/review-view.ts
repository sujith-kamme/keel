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

export interface ReviewRow {
  id: string;
  kind: ReviewItem["kind"];
  kindLabel: string;
  decisionId: string | null;
  sessionId: string;
  tool: string;
  amount: string;
  reasons: string;
  score: number | null;
  state: string;
  createdAt: string;
  canRelease: boolean;
}

const FLAGGED = ["QUARANTINED", "ESCALATED"];

export const canRelease = (state: string) => FLAGGED.includes(state);

const DECISION_ID = /^dec_[A-Za-z0-9]{1,64}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isDecisionId = (v: unknown): v is string => typeof v === "string" && DECISION_ID.test(v);
export const isSessionId = (v: unknown): v is string => typeof v === "string" && SESSION_ID.test(v);
export const isAgentId = (v: unknown): v is "agt_demo_store" | "*" => v === "agt_demo_store" || v === "*";

function amountOf(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  if (typeof args.amount === "string" || typeof args.amount === "number") return String(args.amount);
  if (typeof args.percent === "string" || typeof args.percent === "number") return `${args.percent}%`;
  return "";
}

export function buildRows(items: ReviewItem[]): ReviewRow[] {
  return items.map((i) => ({
    id: i.kind === "held_action" && i.decision_id ? i.decision_id : `session:${i.session_id}`,
    kind: i.kind,
    kindLabel: i.kind === "held_action" ? "Held action" : "Session",
    decisionId: i.decision_id ?? null,
    sessionId: i.session_id,
    tool: i.tool ?? "",
    amount: amountOf(i.args),
    reasons: i.reason_codes.join(", "),
    score: i.score,
    state: i.session_state,
    createdAt: i.created_at,
    canRelease: i.kind === "session" && canRelease(i.session_state),
  }));
}

/** Short inline message for a failed operator call. */
export function errorMessage(status: number, error?: string, reasonCode?: string): string {
  if (status === 409 && error === "payment_unconfirmed") return "Payment unconfirmed: retry approve.";
  if (status === 409 && error === "not_flagged") return "Session is no longer flagged.";
  if (status === 409) return "Already resolved.";
  if (status === 404) return "Not found.";
  if (status === 422) return `Blocked: ${reasonCode ?? "refused"}`;
  if (status === 502) return "PayPal failed: retry.";
  if (status === 503) return "Facts unavailable: retry.";
  return `Request failed (${status}).`;
}
