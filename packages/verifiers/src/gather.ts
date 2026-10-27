import type { Facts } from "@keel/engine";
import { type OrderSources, orderFacts } from "./order";

export interface VerifierDeps extends OrderSources {
  refundTotals: (sessionId: string, now: Date) => Promise<NonNullable<Facts["budget"]>>;
}

export interface GatherRequest {
  session_id: string;
  order_id?: string;
  verified_payer: string | null;
  now: Date;
}

/**
 * Runs the verifiers for one decision. A verifier that fails is left out of the
 * facts and named in `verifier_errors`; the engine then HOLDs any rule that
 * needed it (fail closed, docs/FSD.md FR-VER-2).
 */
export async function gatherFacts(deps: VerifierDeps, req: GatherRequest) {
  const [order, budget] = await Promise.allSettled([
    req.order_id === undefined ? Promise.resolve(undefined) : orderFacts(deps, req.order_id),
    deps.refundTotals(req.session_id, req.now),
  ]);
  const facts: Facts = { now: req.now.toISOString() };
  const verifier_errors: string[] = [];
  if (order.status === "fulfilled") facts.order = order.value;
  else verifier_errors.push("order");
  if (budget.status === "fulfilled") facts.budget = budget.value;
  else verifier_errors.push("budget");
  if (req.verified_payer !== null) facts.identity = { verified_payer: req.verified_payer };
  return { facts, verifier_errors };
}
