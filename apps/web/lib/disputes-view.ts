// Shapes from GET /v1/disputes and GET /v1/disputes/:id, and how the console shows them.
import { usd } from "./overview-view";
import { relativeTime } from "./sessions-view";

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

export interface DisputeList {
  items: DisputeItem[];
  /** When a poll last reached PayPal; null before the first one. */
  last_synced_at: string | null;
}

export interface DisputeLedgerView {
  seq: number;
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
  createdAt: string;
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
/** No action yet reads "Classifying…" until Keel has classified the dispute, then "No action taken". */
export const actionLabel = (a: string | null, classification: string | null) => (a ? (ACTIONS[a] ?? a) : classification ? "No action taken" : "Classifying…");

type Tag = { label: string; tone: string };

const CLASSES: Record<string, Tag> = {
  DEFEND: { label: "Defend", tone: "info" },
  CONCEDE: { label: "Concede", tone: "warn" },
  REVIEW: { label: "Review", tone: "bad" },
};
/** Keel's classification as a badge; "Classifying…" before there is one. */
export const classTag = (c: string | null): Tag => (c ? (CLASSES[c] ?? { label: c, tone: "" }) : { label: "Classifying…", tone: "" });

const OUTCOMES: Record<string, Tag> = {
  WON: { label: "Won", tone: "ok" },
  CONCEDED: { label: "Conceded", tone: "" },
  LOST: { label: "Lost", tone: "bad" },
  OPEN: { label: "Open", tone: "info" },
};
export const outcomeTag = (o: string): Tag => OUTCOMES[o] ?? { label: o, tone: "" };

/** "$35.00" for USD, "35.00 EUR" otherwise. */
export const money = (amount: string, currency: string) => (currency === "USD" ? usd(amount) : `${amount} ${currency}`);

const cents = (amount: string) => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : 0;
};

/** The total of some disputes, one figure per currency. */
function total(items: DisputeItem[]): string {
  const by = new Map<string, number>();
  for (const d of items) by.set(d.currency, (by.get(d.currency) ?? 0) + cents(d.amount));
  if (by.size === 0) return usd("0");
  return [...by].map(([cur, c]) => money(`${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`, cur)).join(" + ");
}

/** Open disputes Keel left for a person, or whose action failed. */
export const needsOperator = (d: Pick<DisputeItem, "outcome" | "action">) => d.outcome === "OPEN" && (d.action === "AWAITING_OPERATOR" || d.action === "FAILED");

export interface DisputeKpis {
  won: { count: number; total: string };
  conceded: { count: number; total: string };
  lost: { count: number; total: string };
  needsYou: { count: number; total: string };
}

export function disputeKpis(items: DisputeItem[]): DisputeKpis {
  const pick = (f: (d: DisputeItem) => boolean) => {
    const xs = items.filter(f);
    return { count: xs.length, total: total(xs) };
  };
  return {
    won: pick((d) => d.outcome === "WON"),
    conceded: pick((d) => d.outcome === "CONCEDED"),
    lost: pick((d) => d.outcome === "LOST"),
    needsYou: pick(needsOperator),
  };
}

export const syncedText = (at: string | null, now: Date) => (at ? `PayPal synced ${relativeTime(at, now)}` : "Not synced with PayPal yet");

export function buildDisputeRows(items: DisputeItem[]): DisputeRow[] {
  return items.map((d) => ({
    id: d.id,
    reason: reasonLabel(d.reason),
    amount: money(d.amount, d.currency),
    classification: d.classification ?? "",
    action: actionLabel(d.action, d.classification),
    outcome: d.outcome,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));
}

export interface TimelineEvent {
  at: string;
  label: string;
  tone: string;
  note: string | null;
  /** The ledger entry behind the event, when there is one. */
  seq: number | null;
}

const OPERATOR_ACTIONS: Record<string, string> = { submit_evidence: "Operator submitted evidence", accept_claim: "Operator accepted the claim" };

/**
 * What Keel can date: when it first saw the dispute, its own ledger rows (the classification and any operator action),
 * and the last update. PayPal's own milestones aren't stored with times, so they aren't shown as events.
 */
export function disputeTimeline(d: Pick<DisputeDetail, "created_at" | "updated_at" | "decisions" | "evidence" | "outcome" | "status" | "stage" | "decision_id">): TimelineEvent[] {
  const events: TimelineEvent[] = [{ at: d.created_at, label: "First seen by Keel", tone: "", note: null, seq: null }];
  for (const r of d.decisions) {
    if (r.tool === "dispute") {
      const c = classTag(({ ALLOW: "CONCEDE", BLOCK: "DEFEND", HOLD: "REVIEW" } as Record<string, string>)[r.verdict] ?? null);
      const matched = r.decision_id === d.decision_id ? `matched ${d.evidence.length} ledger ${d.evidence.length === 1 ? "entry" : "entries"}` : null;
      events.push({ at: r.created_at, label: `Classified: ${c.label.toLowerCase()}`, tone: c.tone, note: matched, seq: r.seq });
    } else {
      const label = (r.action && OPERATOR_ACTIONS[r.action]) ?? (r.action ?? r.tool);
      events.push({ at: r.created_at, label, tone: "info", note: r.reviewer ? `by ${r.reviewer}` : null, seq: r.seq });
    }
  }
  const o = outcomeTag(d.outcome);
  events.push({ at: d.updated_at, label: d.outcome === "OPEN" ? "Last updated" : `Last updated · ${o.label.toLowerCase()}`, tone: o.tone, note: `PayPal: ${paypalStatus(d)}`, seq: null });
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/** PayPal's status and stage as the API gives them, e.g. "WAITING_FOR_SELLER_RESPONSE (INQUIRY)". */
export const paypalStatus = (d: Pick<DisputeItem, "status" | "stage">) => `${d.status}${d.stage ? ` (${d.stage})` : ""}`;

const INJECTION: Record<string, string> = { none: "Clean", flagged: "Flagged: treated as data only", scan_failed: "Scan failed" };
export const injectionText = (v: string | null) => (v ? (INJECTION[v] ?? v) : "Not scanned yet");

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
