import type { Commitment, ReasonCode, Verdict } from "@keel/core";
import { type Capability, type DecisionInput, type LedgerContent, checkScope, decide } from "@keel/engine";
import type { OrderDetails } from "@keel/paypal";
import { gatherFacts } from "@keel/verifiers";
import { maskEmail, refusalMessage } from "./messages";

export type ToolCall =
  | { tool: "get_order"; args: { order_id: string } }
  | { tool: "offer_refund"; args: { order_id: string; amount: string; reason: string; policy_id: string } }
  | { tool: "offer_discount"; args: { percent: number; policy_id: string; order_id?: string } }
  | { tool: "state_policy"; args: { policy_id: string } }
  | { tool: "escalate_to_human"; args: { reason: string } };

export interface StoreOrder {
  orderId: string;
  captureId: string;
  payerEmail: string;
  currency: string;
  total: string;
  items: { sku: string; title: string; price: string }[];
  deliveredAt: Date | null;
}

export interface GatewayDeps {
  getOrderDetails: (orderId: string) => Promise<OrderDetails>;
  refundCapture: (
    captureId: string,
    amount: { value: string; currency: string },
    requestId: string,
  ) => Promise<{ id: string; status: string }>;
  store: (orderId: string) => Promise<StoreOrder | null>;
  refundTotals: (sessionId: string, now: Date) => Promise<{ session_refunded: string; daily_refunded: string }>;
  policy: (policyId: string) => Promise<unknown>;
  appendLedger: (content: LedgerContent) => Promise<unknown>;
  escalate: (sessionId: string) => Promise<void>;
  withOrderLock: <T>(orderId: string, fn: () => Promise<T>) => Promise<T>;
  now: () => Date;
  newId: (prefix: string) => string;
}

export interface ToolResult {
  decision: Verdict;
  reason_code: ReasonCode;
  decision_id: string;
  message: string;
  data?: Record<string, unknown>;
}

interface Outcome {
  verdict: Verdict;
  reason: ReasonCode;
  message?: string;
  data?: Record<string, unknown>;
  order_id?: string;
  capture_id?: string;
  record?: Record<string, unknown>;
}

const ok = (message: string, data?: Record<string, unknown>): Outcome => ({ verdict: "ALLOW", reason: "OK", message, data });
const refuse = (verdict: "BLOCK" | "HOLD", reason: ReasonCode): Outcome => ({ verdict, reason });

/**
 * One agent tool call: scope → facts → decide → execute (ALLOW only) → record.
 * Every call, reads included, appends exactly one ledger entry (FR-MCP-4).
 */
export async function handleTool(deps: GatewayDeps, cap: Capability, call: ToolCall): Promise<ToolResult> {
  const decisionId = deps.newId("dec");
  const now = deps.now();
  const orderId = "order_id" in call.args ? call.args.order_id : undefined;
  const amount = call.tool === "offer_refund" ? call.args.amount : undefined;

  let outcome: Outcome;
  if (!checkScope(cap, { tool: call.tool, order_id: orderId, amount }, "0.00")) {
    outcome = refuse("BLOCK", "CAPABILITY_OUT_OF_SCOPE");
  } else if (call.tool === "offer_refund") {
    outcome = await deps.withOrderLock(call.args.order_id, () => offerRefund(deps, cap, call.args, decisionId, now));
  } else {
    outcome = await run(deps, cap, call, now);
  }
  if (orderId !== undefined) outcome.order_id ??= orderId;

  const message = outcome.message ?? refusalMessage(outcome.verdict as "BLOCK" | "HOLD", outcome.reason);
  await deps.appendLedger({
    decision_id: decisionId,
    session_id: cap.session_id,
    order_id: outcome.order_id ?? null,
    capture_id: outcome.capture_id ?? null,
    dispute_id: null,
    mode: "LIVE",
    verdict: outcome.verdict,
    reason_codes: [outcome.reason],
    payload: { tool: call.tool, args: call.args, ...outcome.record },
  });
  return { decision: outcome.verdict, reason_code: outcome.reason, decision_id: decisionId, message, data: outcome.data };
}

async function run(deps: GatewayDeps, cap: Capability, call: Exclude<ToolCall, { tool: "offer_refund" }>, now: Date) {
  switch (call.tool) {
    case "get_order":
      return getOrder(deps, cap, call.args.order_id, now);
    case "offer_discount":
      return offerDiscount(deps, cap, call.args, now);
    case "state_policy": {
      const policy = await loadPolicy(deps, call.args.policy_id);
      if (policy === "UNAVAILABLE") return refuse("HOLD", "VERIFIER_UNAVAILABLE");
      if (!policy) return refuse("BLOCK", "POLICY_NOT_FOUND");
      const text = (policy as { approved_text: string }).approved_text;
      return ok(text, { policy_id: call.args.policy_id, approved_text: text });
    }
    case "escalate_to_human":
      await deps.escalate(cap.session_id);
      return ok("I've asked a member of our team to join this conversation.");
  }
}

async function loadPolicy(deps: GatewayDeps, policyId: string): Promise<unknown> {
  try {
    return await deps.policy(policyId);
  } catch {
    return "UNAVAILABLE";
  }
}

async function getOrder(deps: GatewayDeps, cap: Capability, orderId: string, now: Date): Promise<Outcome> {
  const [{ facts, verifier_errors }, store] = await Promise.all([
    gatherFacts(verifierDeps(deps), { session_id: cap.session_id, order_id: orderId, verified_payer: cap.verified_payer, now }),
    deps.store(orderId).catch(() => null),
  ]);
  if (!facts.order || !store) return { ...refuse("HOLD", "VERIFIER_UNAVAILABLE"), record: { verifier_errors } };
  // Details only for the verified payer (FR-MCP-2); anyone else learns nothing
  // beyond a masked email they can confirm by verifying.
  const owner = cap.verified_payer?.toLowerCase() === store.payerEmail.toLowerCase();
  if (!owner) {
    return {
      ...ok("I need to verify that you're the account holder before I can share this order's details."),
      capture_id: store.captureId,
      data: { order_id: orderId, payer_email: maskEmail(store.payerEmail), verified: false },
    };
  }
  return {
    ...ok("Here are the order details."),
    capture_id: store.captureId,
    data: {
      order_id: orderId,
      items: store.items,
      total: { value: store.total, currency: store.currency },
      refunded: facts.order.refunded,
      delivered_at: facts.order.delivered_at ?? null,
      payer_email: store.payerEmail,
    },
  };
}

async function offerRefund(
  deps: GatewayDeps,
  cap: Capability,
  args: Extract<ToolCall, { tool: "offer_refund" }>["args"],
  decisionId: string,
  now: Date,
): Promise<Outcome> {
  const [{ facts, verifier_errors }, store, policy] = await Promise.all([
    gatherFacts(verifierDeps(deps), {
      session_id: cap.session_id,
      order_id: args.order_id,
      verified_payer: cap.verified_payer,
      now,
    }),
    deps.store(args.order_id).catch(() => null),
    loadPolicy(deps, args.policy_id),
  ]);
  if (!store || !facts.budget || policy === "UNAVAILABLE") {
    return { ...refuse("HOLD", "VERIFIER_UNAVAILABLE"), record: { verifier_errors } };
  }
  // The capability cap counts what this session already refunded (FR-CAP-3).
  if (!checkScope(cap, { tool: "offer_refund", order_id: args.order_id, amount: args.amount }, facts.budget.session_refunded)) {
    return { ...refuse("BLOCK", "CAPABILITY_OUT_OF_SCOPE"), capture_id: store.captureId };
  }

  // Currency comes from Keel's order record, never from the agent.
  const money = { value: args.amount, currency: store.currency };
  const commitment: Commitment = {
    id: `${decisionId}:refund`,
    type: "REFUND",
    source: "TOOL_CALL",
    order_id: args.order_id,
    amount: money,
    policy_id: args.policy_id,
  };
  const input: DecisionInput = { commitment, policy, facts };
  const result = decide(input);
  const verdict = result.verdict;
  const reason = result.reason_codes[0] ?? "POLICY_INVALID";
  const record = { decision: { input, result }, verifier_errors };
  if (verdict !== "ALLOW") return { verdict, reason, capture_id: store.captureId, record };

  try {
    const refund = await deps.refundCapture(store.captureId, money, decisionId);
    return {
      ...ok(`I've issued a refund of ${args.amount} ${store.currency}. It can take a few days to appear.`, {
        refund_id: refund.id,
        amount: { value: args.amount, currency: store.currency },
        status: refund.status,
      }),
      capture_id: store.captureId,
      record: { ...record, execution: { status: refund.status, refund_id: refund.id, amount: args.amount } },
    };
  } catch {
    // The engine allowed it (kept in payload.decision for replay) but PayPal
    // didn't move the money, so the outcome is HOLD for a person to follow up.
    return {
      ...refuse("HOLD", "VERIFIER_UNAVAILABLE"),
      capture_id: store.captureId,
      record: { ...record, execution: { status: "FAILED", amount: args.amount } },
    };
  }
}

async function offerDiscount(
  deps: GatewayDeps,
  cap: Capability,
  args: Extract<ToolCall, { tool: "offer_discount" }>["args"],
  now: Date,
): Promise<Outcome> {
  const policy = await loadPolicy(deps, args.policy_id);
  if (policy === "UNAVAILABLE") return refuse("HOLD", "VERIFIER_UNAVAILABLE");
  const commitment: Commitment = {
    id: `${cap.session_id}:discount`,
    type: "DISCOUNT",
    source: "TOOL_CALL",
    order_id: args.order_id,
    percent: args.percent,
    policy_id: args.policy_id,
  };
  const input: DecisionInput = { commitment, policy, facts: { now: now.toISOString() } };
  const result = decide(input);
  const reason = result.reason_codes[0] ?? "POLICY_INVALID";
  const record = { decision: { input, result } };
  if (result.verdict !== "ALLOW") return { verdict: result.verdict, reason, record };
  const code = `KEEL-${deps.newId("code").replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase()}`;
  return {
    ...ok(`Here's a ${args.percent}% discount code for your next order: ${code}`, { code, percent: args.percent }),
    record: { ...record, execution: { status: "ISSUED", code } },
  };
}

function verifierDeps(deps: GatewayDeps) {
  return { getOrderDetails: deps.getOrderDetails, storeOrder: deps.store, refundTotals: deps.refundTotals };
}
