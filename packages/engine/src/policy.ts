import { CommitmentType } from "@keel/core";
import { z } from "zod";

const MoneyValue = z.string().regex(/^\d+(\.\d{1,2})?$/);

export const Rule = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("max_amount_le_captured_minus_refunded") }),
  z.object({
    rule: z.literal("within_days_of"),
    field: z.enum(["captured_at", "delivered_at"]),
    days: z.number().int().positive(),
  }),
  z.object({ rule: z.literal("payer_verified") }),
  z.object({ rule: z.literal("discount_percent_le"), percent: z.number().min(0).max(100) }),
  z.object({ rule: z.literal("price_ge_min") }),
  z.object({ rule: z.literal("session_budget_le"), amount: MoneyValue }),
  z.object({ rule: z.literal("daily_budget_le"), amount: MoneyValue }),
  z.object({ rule: z.literal("auto_approve_le"), amount: MoneyValue }),
]);
export type Rule = z.infer<typeof Rule>;

export const Policy = z.object({
  policy_id: z.string().min(1),
  version: z.number().int().positive(),
  type: CommitmentType,
  approved_text: z.string().min(1),
  rules: z.array(Rule),
});
export type Policy = z.infer<typeof Policy>;

// Evaluation stage per rule (docs/FSD.md FR-POL-2): hard rules BLOCK first,
// then budgets HOLD, then auto-approve thresholds HOLD.
export const RULE_STAGE: Record<Rule["rule"], number> = {
  max_amount_le_captured_minus_refunded: 0,
  within_days_of: 0,
  payer_verified: 0,
  discount_percent_le: 0,
  price_ge_min: 0,
  session_budget_le: 1,
  daily_budget_le: 1,
  auto_approve_le: 2,
};
