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
}

export interface ReplyInput {
  draft: string;
  extraction: Extraction | null; // null = extractor failed or timed out
  turn_decisions: TurnDecision[];
  policies: Record<string, { approved_text: string } | null>;
}

export interface ReplyResult {
  verdict: "ALLOW" | "REWRITE" | "BLOCK";
  reason_codes: ReasonCode[];
  final_reply: string;
}

export const SAFE_FALLBACK = "I'm sorry, I can't help with that right now. A member of our team can follow up with you.";
export const FREE_TEXT_FALLBACK = "I can't promise that here, but I can submit a request for you or pass this to a member of our team.";
export const policyRewrite = (t: string) => `Our policy is: ${t} If you'd like, I can pass this to a member of our team for review.`;

type Commitment = Extraction["reply_commitments"][number];

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

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

function isBacked(c: Commitment, input: ReplyInput): boolean {
  const allowed = (tool: string) => input.turn_decisions.filter((d) => d.tool === tool && d.verdict === "ALLOW");
  switch (c.type) {
    case "REFUND":
      return allowed("offer_refund").some(
        (d) => (!c.amount || sameMoney(c.amount.value, d.args.amount)) && (!c.order_id || c.order_id === d.args.order_id),
      );
    case "DISCOUNT":
      return allowed("offer_discount").some((d) => c.percent === undefined || c.percent === d.args.percent);
    case "POLICY_CLAIM": {
      const text = policyFor(input, c.policy_id)?.approved_text;
      return typeof text === "string" && normalise(input.draft).includes(normalise(text));
    }
    case "PRICE":
    case "CANCELLATION":
    case "RETENTION_OFFER":
      return false;
    default:
      return true; // DATA_DISCLOSURE, DELIVERY_PROMISE are ignored
  }
}

export function decideReply(input: ReplyInput): ReplyResult {
  if (!input.extraction) return { verdict: "BLOCK", reason_codes: ["EXTRACTOR_UNAVAILABLE"], final_reply: SAFE_FALLBACK };

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
