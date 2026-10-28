import type { Extraction, ReasonCode, Verdict } from "@keel/core";
import { canonicalJson } from "./canonical";
import { toCents } from "./money";

// Deterministic word-path decision (docs/FSD.md FR-EXT-3, FR-EXT-4). The extractor
// only proposes commitments; a promise is allowed only when this turn's tool
// decisions back it (DP-2) and an ALLOW tool verdict is the only backing, so a
// held or blocked action is never described as done (DP-7).

export interface TurnDecision {
  tool: string;
  verdict: Verdict;
  args: Record<string, unknown>;
  /** The customer-safe message Keel returned for this call, when recorded. */
  message?: string;
  /** Figures Keel's own order lookup returned (owner-verified get_order only); absent in old rows. */
  order_facts?: { order_id: string; total: string; currency: string; refunded: string; item_prices: string[] };
}

export interface ReplyInput {
  draft: string;
  extraction: Extraction | null; // null = extractor failed or timed out
  turn_decisions: TurnDecision[];
  /** Executed money ALLOWs from earlier in the same session; restating one is truthful. Absent in old rows. */
  session_decisions?: TurnDecision[];
  policies: Record<string, { approved_text: string } | null>;
}

export interface ReplyResult {
  verdict: "ALLOW" | "REWRITE" | "BLOCK";
  reason_codes: ReasonCode[];
  final_reply: string;
}

export const SAFE_FALLBACK = "I'm sorry, I can't help with that right now. A member of our team can follow up with you.";
export const FREE_TEXT_FALLBACK = "I can't promise that here, but I can submit a request for you or pass this to a member of our team.";
export const QUARANTINE_TEMPLATE = "Your request has been passed to our team for review. You'll hear back within 24 hours.";
export const policyRewrite = (t: string) => `Our policy is: ${t} If you'd like, I can pass this to a member of our team for review.`;

type Commitment = Extraction["reply_commitments"][number];

// NFKC + no zero-width characters, so invisible or compatibility characters can't
// make two visually identical texts compare differently.
const normalise = (s: string) =>
  s.normalize("NFKC").replace(/[​-‍⁠﻿­]/g, "").replace(/\s+/g, " ").trim();

// policy_id comes from the extractor (LLM output), so only own keys count: "constructor" must not resolve.
const policyFor = (input: ReplyInput, id: string | undefined) =>
  id !== undefined && Object.hasOwn(input.policies, id) ? input.policies[id] : null;

function sameMoney(a: string, b: unknown): boolean {
  try {
    return typeof b === "string" && toCents(a) === toCents(b);
  } catch {
    return false; // malformed amount: fail closed
  }
}

// The agent repeating Keel's own wording is not a free-text promise: the commitment
// span must lie inside a Keel message the draft quotes verbatim, and must not appear
// anywhere else in the draft (otherwise one real confirmation could cover a copy of it
// attached to a different order).
function quotesKeel(c: Commitment, input: ReplyInput): boolean {
  const span = normalise(c.quoted_text);
  // The extractor's quote must really be in the draft; a tidied-up quote earns no credit.
  if (span === "" || !normalise(input.draft).includes(span)) return false;
  const quoted = input.turn_decisions
    .map((d) => (d.message ? normalise(d.message) : ""))
    .filter((m) => m !== "" && normalise(input.draft).includes(m));
  // The backing message must come from a decision about the same order, amount and percent.
  const backing = input.turn_decisions.filter(
    (d) => d.message && normalise(d.message).includes(span) && quoted.includes(normalise(d.message)) && sameArgs(c, d),
  );
  if (backing.length === 0) return false;
  // One removal per Keel message: a second copy of the same words is the agent's own text.
  const rest = quoted.reduce((draft, m) => draft.replace(m, " "), normalise(input.draft));
  return !normalise(rest).includes(span);
}

const sameArgs = (c: Commitment, d: TurnDecision) =>
  (!c.amount || sameMoney(c.amount.value, d.args.amount)) &&
  (!c.order_id || c.order_id === d.args.order_id) &&
  (c.percent === undefined || c.percent === d.args.percent);

const centsEqual = (a: string, b: string) => sameMoney(a, b);

// Reporting a figure Keel's lookup returned this turn is a statement of fact, not a promise.
// Only this turn's decisions count, and a commitment without an amount is never backed.
function factsBack(c: Commitment, input: ReplyInput, figures: (f: NonNullable<TurnDecision["order_facts"]>) => string[]): boolean {
  const amount = c.amount;
  if (!amount) return false;
  return input.turn_decisions.some((d) => {
    const f = d.order_facts;
    if (d.tool !== "get_order" || d.verdict !== "ALLOW" || !f) return false;
    if (c.order_id && c.order_id !== f.order_id) return false;
    if (amount.currency && amount.currency !== f.currency) return false;
    return figures(f).some((v) => centsEqual(amount.value, v));
  });
}

function isBacked(c: Commitment, input: ReplyInput): boolean {
  if (quotesKeel(c, input)) return true;
  const allowed = (tool: string) => [...input.turn_decisions, ...(input.session_decisions ?? [])].filter((d) => d.tool === tool && d.verdict === "ALLOW");
  switch (c.type) {
    case "REFUND":
      return allowed("offer_refund").some((d) => sameArgs(c, d)) ||
        factsBack(c, input, (f) => (sameMoney(f.refunded, "0.00") ? [] : [f.refunded]));
    case "DISCOUNT":
      return allowed("offer_discount").some((d) => sameArgs(c, d));
    case "POLICY_CLAIM": {
      const draft = normalise(input.draft);
      const quotes = (text: unknown) => typeof text === "string" && draft.includes(normalise(text));
      if (quotes(policyFor(input, c.policy_id)?.approved_text)) return true;
      // The extractor may leave policy_id out: any approved text quoted in full that contains the claim backs it.
      const span = normalise(c.quoted_text);
      return span !== "" && Object.entries(input.policies).some(
        ([id, p]) => Object.hasOwn(input.policies, id) && quotes(p?.approved_text) && normalise(p!.approved_text).includes(span),
      );
    }
    case "PRICE":
      return factsBack(c, input, (f) => [f.total, ...f.item_prices]);
    case "CANCELLATION":
    case "RETENTION_OFFER":
      return false;
    default:
      return true; // DATA_DISCLOSURE, DELIVERY_PROMISE are ignored
  }
}

export function decideReply(input: ReplyInput): ReplyResult {
  if (!input.extraction) return { verdict: "BLOCK", reason_codes: ["EXTRACTOR_UNAVAILABLE"], final_reply: SAFE_FALLBACK };
  // A reply that tries to instruct an AI is never sent. Customer-side signals feed risk scoring (Phase 4).
  if (input.extraction.injection_signals.some((s) => s.source === "reply")) {
    return { verdict: "BLOCK", reason_codes: ["INJECTION_DETECTED"], final_reply: SAFE_FALLBACK };
  }

  let rewrite: ReplyResult | undefined;
  for (const c of input.extraction.reply_commitments) {
    if (isBacked(c, input)) continue;
    const approved = c.type === "POLICY_CLAIM" ? policyFor(input, c.policy_id) : null;
    if (!approved) return { verdict: "BLOCK", reason_codes: ["FREE_TEXT_COMMITMENT"], final_reply: FREE_TEXT_FALLBACK };
    rewrite ??= { verdict: "REWRITE", reason_codes: ["POLICY_UNAPPROVED_CLAIM"], final_reply: policyRewrite(approved.approved_text) };
  }
  return rewrite ?? { verdict: "ALLOW", reason_codes: ["OK"], final_reply: input.draft };
}

/** Re-runs a stored reply decision and reports whether the engine still agrees (DP-6). */
export function replayReply(payload: { input: ReplyInput; result: ReplyResult }): { same: boolean; replayed: ReplyResult } {
  const replayed = decideReply(payload.input);
  return { same: canonicalJson(replayed) === canonicalJson(payload.result), replayed };
}
