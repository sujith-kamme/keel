import type { Commitment, CommitmentType, ReasonCode, Verdict } from "@keel/core";
import type { Facts } from "./facts";
import { Policy, RULE_STAGE } from "./policy";
import { InvalidInput, evaluateRule } from "./rules";

export interface DecisionInput {
  commitment: Commitment;
  /** Raw stored policy JSON, or null when none exists. Validated here. */
  policy: unknown;
  facts: Facts;
}

export interface DecisionResult {
  verdict: Verdict;
  reason_codes: ReasonCode[];
}

// Promises must be commands (docs/FSD.md FR-EXT-4): these types are never
// accepted as free text, even when they would be in policy.
const COMMAND_ONLY: ReadonlySet<CommitmentType> = new Set([
  "REFUND",
  "DISCOUNT",
  "PRICE",
  "POLICY_CLAIM",
  "CANCELLATION",
  "RETENTION_OFFER",
]);

const result = (verdict: Verdict, reason: ReasonCode): DecisionResult => ({ verdict, reason_codes: [reason] });

/** Pure and deterministic: the same input always yields the same result (DP-6). */
export function decide({ commitment, policy, facts }: DecisionInput): DecisionResult {
  if (policy === null || policy === undefined) return result("BLOCK", "POLICY_NOT_FOUND");

  const parsed = Policy.safeParse(policy);
  if (
    !parsed.success ||
    parsed.data.type !== commitment.type ||
    (commitment.policy_id !== undefined && commitment.policy_id !== parsed.data.policy_id)
  ) {
    return result("BLOCK", "POLICY_INVALID");
  }

  if (commitment.source === "FREE_TEXT" && COMMAND_ONLY.has(commitment.type)) {
    return result("REWRITE", "FREE_TEXT_COMMITMENT");
  }

  // Array.prototype.sort is stable, so rules keep policy order within a stage.
  const rules = [...parsed.data.rules].sort((a, b) => RULE_STAGE[a.rule] - RULE_STAGE[b.rule]);
  for (const rule of rules) {
    try {
      const outcome = evaluateRule(rule, commitment, facts);
      if (outcome) return result(outcome.verdict, outcome.reason);
    } catch (error) {
      // Fail closed (DP-4): a bad request blocks; any missing or broken fact holds.
      return error instanceof InvalidInput ? result("BLOCK", "POLICY_INVALID") : result("HOLD", "VERIFIER_UNAVAILABLE");
    }
  }
  return result("ALLOW", "OK");
}
