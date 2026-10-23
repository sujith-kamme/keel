import type { Commitment, ReasonCode } from "@keel/core";
import type { Facts } from "./facts";
import { toCents } from "./money";
import type { Rule } from "./policy";

export interface Outcome {
  verdict: "BLOCK" | "HOLD";
  reason: ReasonCode;
}

/** A fact the rule needs was not supplied or is malformed: fail closed with HOLD. */
export class MissingFact extends Error {}
/** The commitment lacks a field the rule needs: the request itself is invalid. */
export class InvalidInput extends Error {}

const DAY_MS = 86_400_000;

function fact<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new MissingFact();
  return value;
}

function input<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new InvalidInput();
  return value;
}

function cents(value: string): number {
  try {
    return toCents(value);
  } catch {
    throw new MissingFact();
  }
}

const block = (reason: ReasonCode): Outcome => ({ verdict: "BLOCK", reason });
const hold = (reason: ReasonCode): Outcome => ({ verdict: "HOLD", reason });

/** Returns null when the rule passes. */
export function evaluateRule(rule: Rule, c: Commitment, f: Facts): Outcome | null {
  switch (rule.rule) {
    case "max_amount_le_captured_minus_refunded": {
      const amount = input(c.amount);
      const order = fact(f.order);
      if (amount.currency !== order.currency) return block("CURRENCY_MISMATCH");
      const remaining = cents(order.captured) - cents(order.refunded);
      return toCents(amount.value) > remaining ? block("AMOUNT_EXCEEDS_CAPTURED") : null;
    }
    case "within_days_of": {
      const at = Date.parse(fact(fact(f.order)[rule.field]));
      const now = Date.parse(f.now);
      if (Number.isNaN(at) || Number.isNaN(now)) throw new MissingFact();
      return now - at > rule.days * DAY_MS ? block("OUTSIDE_WINDOW") : null;
    }
    case "payer_verified": {
      const order = fact(f.order);
      const verified = f.identity?.verified_payer;
      const matches = verified !== undefined && verified.toLowerCase() === order.payer_email.toLowerCase();
      return matches ? null : block("PAYER_NOT_VERIFIED");
    }
    case "discount_percent_le":
      return input(c.percent) > rule.percent ? block("DISCOUNT_EXCEEDS_LIMIT") : null;
    case "price_ge_min":
      return toCents(input(c.amount).value) < cents(fact(f.catalog).min_price) ? block("PRICE_BELOW_MIN") : null;
    case "session_budget_le": {
      const spent = cents(fact(f.budget).session_refunded);
      return spent + toCents(input(c.amount).value) > toCents(rule.amount) ? hold("BUDGET_EXCEEDED") : null;
    }
    case "daily_budget_le": {
      const spent = cents(fact(f.budget).daily_refunded);
      return spent + toCents(input(c.amount).value) > toCents(rule.amount) ? hold("BUDGET_EXCEEDED") : null;
    }
    case "auto_approve_le":
      return toCents(input(c.amount).value) > toCents(rule.amount) ? hold("ABOVE_AUTO_APPROVE") : null;
  }
}
