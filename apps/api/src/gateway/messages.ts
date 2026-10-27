import type { ReasonCode } from "@keel/core";

// Customer-safe wording the agent must use for HOLD and BLOCK results (FR-MCP-5).
// It never states policy terms the merchant hasn't approved.
export const HOLD_MESSAGE = "I've passed this to a member of our team, who will follow up with you.";

const BLOCK_MESSAGES: Partial<Record<ReasonCode, string>> = {
  CAPABILITY_OUT_OF_SCOPE: "I can't make changes to that order in this conversation.",
  PAYER_NOT_VERIFIED: "I need to verify that you're the account holder for this order before I can do that.",
  OUTSIDE_WINDOW: "This order is outside our refund window, so I can't refund it.",
  AMOUNT_EXCEEDS_CAPTURED: "That's more than the amount left to refund on this order.",
  CURRENCY_MISMATCH: "That refund doesn't match the currency of the order.",
  DISCOUNT_EXCEEDS_LIMIT: "I can't offer a discount that large.",
  PRICE_BELOW_MIN: "I can't offer that price.",
};

const FALLBACK_BLOCK = "I can't do that, but I can connect you with a member of our team.";

export function refusalMessage(verdict: "BLOCK" | "HOLD", reason: ReasonCode): string {
  return verdict === "HOLD" ? HOLD_MESSAGE : (BLOCK_MESSAGES[reason] ?? FALLBACK_BLOCK);
}

/** a***@example.com: enough for the customer to recognise, not enough to leak. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
