import { z } from "zod";

// Shapes from docs/FSD.md §5.2 and §5.6. Engine logic arrives in Phase 1.

export const CommitmentType = z.enum([
  "REFUND", "DISCOUNT", "PRICE", "POLICY_CLAIM",
  "CANCELLATION", "RETENTION_OFFER", "DATA_DISCLOSURE", "DELIVERY_PROMISE",
]);
export type CommitmentType = z.infer<typeof CommitmentType>;

export const Money = z.object({
  // Same bound as @keel/engine money parsing: at most 13 whole digits.
  value: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/),
  currency: z.string().length(3),
});

export const Commitment = z.object({
  id: z.string(),
  type: CommitmentType,
  source: z.enum(["TOOL_CALL", "FREE_TEXT"]),
  order_id: z.string().optional(),
  amount: Money.optional(),
  percent: z.number().optional(),
  policy_id: z.string().optional(),
  conditions: z.array(z.string()).optional(),
  quoted_text: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type Commitment = z.infer<typeof Commitment>;

export type Money = z.infer<typeof Money>;

export const Verdict =z.enum(["ALLOW", "REWRITE", "BLOCK", "HOLD"]);
export type Verdict = z.infer<typeof Verdict>;

export const ReasonCode = z.enum([
  "OK", "CAPABILITY_OUT_OF_SCOPE", "POLICY_NOT_FOUND", "POLICY_UNAPPROVED_CLAIM",
  "FREE_TEXT_COMMITMENT", "AMOUNT_EXCEEDS_CAPTURED", "CURRENCY_MISMATCH", "OUTSIDE_WINDOW", "PAYER_NOT_VERIFIED",
  "BUDGET_EXCEEDED", "ABOVE_AUTO_APPROVE", "DISCOUNT_EXCEEDS_LIMIT", "PRICE_BELOW_MIN",
  "INJECTION_DETECTED", "RISK_THRESHOLD", "EXTRACTOR_UNAVAILABLE", "VERIFIER_UNAVAILABLE",
  "POLICY_INVALID", "AGENT_FROZEN",
  "DISPUTE_NO_LEDGER_MATCH", "DISPUTE_UNHONORED_COMMITMENT", "DISPUTE_WITHIN_POLICY", "DISPUTE_UNSUPPORTED_REASON",
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const Mode = z.enum(["LIVE", "CONTEXT", "SHADOW", "QUARANTINE"]);
export type Mode = z.infer<typeof Mode>;

// Output of the Phase 3 reply extractor (the LLM proposes; engine code decides).
export const ExtractedCommitment = z.object({
  type: CommitmentType,
  quoted_text: z.string().max(500),
  order_id: z.string().max(64).optional(),
  amount: Money.optional(),
  percent: z.number().min(0).max(100).optional(),
  policy_id: z.string().max(64).optional(),
});
export type ExtractedCommitment = z.infer<typeof ExtractedCommitment>;

export const Extraction = z.object({
  reply_commitments: z.array(ExtractedCommitment).max(20),
  injection_signals: z.array(z.object({ source: z.enum(["customer", "reply"]), quoted_text: z.string().max(500) })).max(20),
  pii_mentions: z.array(z.object({ kind: z.enum(["email", "phone", "address", "card", "other"]), quoted_text: z.string().max(200) })).max(20),
});
export type Extraction = z.infer<typeof Extraction>;

export * from "./disputes";
