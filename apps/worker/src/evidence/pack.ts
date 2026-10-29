import type { DisputeClassification, Money } from "@keel/core";
import { redact } from "./redact";

// FR-DSP-1: the evidence pack, as plain data. pdf.ts draws it; the notes go to
// PayPal's provide-evidence call alongside the PDF.

export interface PackRow {
  seq: number;
  decision_id: string;
  at: string;
  tool: string;
  verdict: string;
  reason_codes: string[];
  detail: string;
  hash: string;
  prev_hash: string | null;
}

export interface PackInput {
  dispute: { id: string; reason: string; amount: Money; created_at: string };
  classification: DisputeClassification;
  reason_codes: string[];
  order: { order_id: string; capture_id: string; total: string; currency: string; delivered_at: string | null; items: { title: string; price: string }[] } | null;
  paypal: { capture: { id: string; status: string; amount: string } | null; refunds: { id: string; status: string; amount: string }[] };
  turns: { session_id: string; role: "customer" | "agent"; agent_id: string | null; text: string; at: string }[];
  rows: PackRow[];
  policies: { policy_id: string; version: number; approved_text: string }[];
}

export interface Pack {
  title: string;
  sections: { heading: string; lines: string[] }[];
  notes: string;
}

const WORDS: Record<string, string> = {
  OK: "within policy",
  OUTSIDE_WINDOW: "outside the refund window",
  AMOUNT_EXCEEDS_CAPTURED: "more than was paid",
  PAYER_NOT_VERIFIED: "customer not verified",
  BUDGET_EXCEEDED: "over the refund budget",
  ABOVE_AUTO_APPROVE: "above the automatic approval limit",
  DISCOUNT_EXCEEDS_LIMIT: "discount above the allowed limit",
  PRICE_BELOW_MIN: "price below the minimum",
  POLICY_UNAPPROVED_CLAIM: "stated a policy that doesn't exist",
  POLICY_NOT_FOUND: "unknown policy",
  FREE_TEXT_COMMITMENT: "unapproved promise in the reply",
  INJECTION_DETECTED: "prompt injection detected",
  RISK_THRESHOLD: "session quarantined",
  CAPABILITY_OUT_OF_SCOPE: "outside the agent's permissions",
  DISPUTE_WITHIN_POLICY: "the agent acted within policy",
  DISPUTE_UNHONORED_COMMITMENT: "an approved refund was not paid",
};

export const reasonWords = (codes: string[]) => codes.map((c) => WORDS[c] ?? c).join(", ");
const day = (iso: string) => iso.slice(0, 10);
const time = (iso: string) => iso.replace("T", " ").slice(0, 16);

export function buildPack(p: PackInput): Pack {
  const o = p.order;
  const refused = p.rows.filter((r) => r.tool === "offer_refund" && r.verdict !== "ALLOW");
  const notes = [
    `Keel decision record for dispute ${p.dispute.id} (${p.dispute.reason}, ${p.dispute.amount.value} ${p.dispute.amount.currency}).`,
    o ? `Order ${o.order_id}, capture ${o.capture_id}, ${o.total} ${o.currency}${o.delivered_at ? `, delivered ${day(o.delivered_at)}` : ""}.` : "",
    ...refused.map((r) => `On ${day(r.at)} the customer's request (${r.detail}) was refused: ${reasonWords(r.reason_codes)}.`),
    p.paypal.refunds.length ? `Refunds paid: ${p.paypal.refunds.map((r) => `${r.amount} (${r.status})`).join(", ")}.` : "",
    `Keel's finding: ${reasonWords(p.reason_codes)}. The attached PDF has the conversation, each decision with its reason, the policy text in force and a tamper-evident ledger excerpt.`,
  ].filter(Boolean).join(" ");

  return {
    title: `Dispute evidence: ${p.dispute.id}`,
    sections: [
      { heading: "Summary", lines: [
        `Dispute ${p.dispute.id}, reason ${p.dispute.reason}, opened ${day(p.dispute.created_at)}, amount ${p.dispute.amount.value} ${p.dispute.amount.currency}.`,
        `Keel classification: ${p.classification} (${reasonWords(p.reason_codes)}).`,
      ] },
      { heading: "Order and payment", lines: o ? [
        `Order ${o.order_id}, capture ${o.capture_id}, total ${o.total} ${o.currency}.`,
        ...o.items.map((i) => `Item: ${i.title}, ${i.price} ${o.currency}.`),
        o.delivered_at ? `Delivered ${day(o.delivered_at)}.` : "Delivery date not recorded.",
        p.paypal.capture ? `PayPal capture ${p.paypal.capture.id}: ${p.paypal.capture.status}, ${p.paypal.capture.amount}.` : "",
        ...p.paypal.refunds.map((r) => `PayPal refund ${r.id}: ${r.status}, ${r.amount}.`),
      ].filter(Boolean) : ["No matching order."] },
      { heading: "Decisions", lines: p.rows.map((r) => `${time(r.at)}  ${r.tool}  ${r.verdict}  ${reasonWords(r.reason_codes)}  (${r.detail})`) },
      { heading: "Policies in force", lines: p.policies.map((x) => `${x.policy_id} v${x.version}: ${x.approved_text}`) },
      { heading: "Conversation", lines: p.turns.map((t) => `${time(t.at)}  ${t.role === "customer" ? "Customer" : "Agent"}: ${redact(t.text)}`) },
      { heading: "Ledger hash chain", lines: p.rows.map((r) => `#${r.seq} ${r.decision_id} prev ${r.prev_hash ?? "-"} hash ${r.hash}`) },
    ],
    notes: redact(notes).slice(0, 2000),
  };
}
