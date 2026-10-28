import { type Capability, type DecisionPayload, type LedgerContent, replay } from "@keel/engine";
import type { OrderDetails } from "@keel/paypal";
import { describe, expect, it, vi } from "vitest";
import { HOLD_MESSAGE } from "./messages";
import { type GatewayDeps, type StoreOrder, handleTool } from "./handle";

const NOW = new Date("2026-10-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const refundPolicy = {
  policy_id: "refund-standard",
  version: 1,
  type: "REFUND",
  approved_text: "Unused items can be refunded within 30 days of delivery, up to the amount you paid.",
  rules: [
    { rule: "max_amount_le_captured_minus_refunded" },
    { rule: "within_days_of", field: "delivered_at", days: 30 },
    { rule: "payer_verified" },
    { rule: "session_budget_le", amount: "100.00" },
    { rule: "daily_budget_le", amount: "500.00" },
    { rule: "auto_approve_le", amount: "50.00" },
  ],
};
const discountPolicy = {
  policy_id: "discount-goodwill",
  version: 1,
  type: "DISCOUNT",
  approved_text: "Up to 10% off your next order.",
  rules: [{ rule: "discount_percent_le", percent: 10 }],
};

const orders: Record<string, { store: StoreOrder; total: string }> = {
  "IN-POLICY": { total: "42.00", store: storeOrder("IN-POLICY", "maya@demo.keel.test", "42.00", daysAgo(5)) },
  "OLD": { total: "35.00", store: storeOrder("OLD", "maya@demo.keel.test", "35.00", daysAgo(45)) },
  "LARGE": { total: "120.00", store: storeOrder("LARGE", "maya@demo.keel.test", "120.00", daysAgo(3)) },
};

function storeOrder(orderId: string, payerEmail: string, total: string, deliveredAt: Date): StoreOrder {
  return { orderId, captureId: `CAP-${orderId}`, payerEmail, currency: "USD", total, items: [], deliveredAt };
}

function paypalOrder(orderId: string): OrderDetails {
  const o = orders[orderId]!;
  return {
    id: orderId,
    status: "COMPLETED",
    purchase_units: [
      {
        payments: {
          captures: [
            { id: `CAP-${orderId}`, status: "COMPLETED", amount: { value: o.total, currency_code: "USD" }, create_time: daysAgo(10).toISOString() },
          ],
        },
      },
    ],
  };
}

const cap = (overrides: Partial<Capability> = {}): Capability => ({
  session_id: "ses_1",
  agent_id: "agt_demo",
  verified_payer: "maya@demo.keel.test",
  orders: ["IN-POLICY", "OLD", "LARGE"],
  allow: ["get_order", "offer_refund", "offer_discount", "state_policy", "escalate_to_human"],
  max_refund_total: "100.00",
  expires_at: "2026-10-27T12:30:00Z",
  ...overrides,
});

function fakes(overrides: Partial<GatewayDeps> = {}) {
  const ledger: LedgerContent[] = [];
  let n = 0;
  const deps: GatewayDeps = {
    getOrderDetails: vi.fn(async (id: string) => paypalOrder(id)),
    refundCapture: vi.fn(async () => ({ id: "REFUND-1", status: "COMPLETED" })),
    store: async (id) => orders[id]?.store ?? null,
    refundTotals: async () => ({ session_refunded: "0.00", daily_refunded: "0.00" }),
    policy: async (id) => ({ "refund-standard": refundPolicy, "discount-goodwill": discountPolicy })[id] ?? null,
    appendLedger: async (entry) => {
      ledger.push(entry);
    },
    escalate: vi.fn(async () => {}),
    withOrderLock: (_id, fn) => fn(),
    control: vi.fn(async () => ({ state: "ACTIVE", agent_frozen: false, score: 0 })),
    assess: vi.fn(async () => ({ score: 0, quarantined: false })),
    notifyHeld: vi.fn(async () => {}),
    now: () => NOW,
    newId: (prefix) => `${prefix}_${++n}abcdefgh`,
    ...overrides,
  };
  return { deps, ledger };
}

const refundCall = (order_id: string, amount: string) =>
  ({ tool: "offer_refund", args: { order_id, amount, reason: "damaged", policy_id: "refund-standard" } }) as const;

describe("handleTool: offer_refund", () => {
  it("executes an in-policy refund once, with the decision id as request id, and records a replayable entry", async () => {
    const { deps, ledger } = fakes();
    const result = await handleTool(deps, cap(), refundCall("IN-POLICY", "42.00"));
    expect(result).toMatchObject({ decision: "ALLOW", reason_code: "OK", data: { refund_id: "REFUND-1" } });
    expect(deps.refundCapture).toHaveBeenCalledTimes(1);
    expect(deps.refundCapture).toHaveBeenCalledWith("CAP-IN-POLICY", { value: "42.00", currency: "USD" }, result.decision_id);
    expect(ledger).toHaveLength(1);
    const payload = ledger[0]!.payload as { execution: unknown; decision: DecisionPayload };
    expect(payload.execution).toEqual({ status: "COMPLETED", refund_id: "REFUND-1", amount: "42.00" });
    expect(replay(payload.decision).same).toBe(true);
    expect(ledger[0]).toMatchObject({ order_id: "IN-POLICY", capture_id: "CAP-IN-POLICY", verdict: "ALLOW" });
  });

  it.each([
    ["an order outside the session", cap({ orders: ["OLD"] }), refundCall("IN-POLICY", "10.00")],
    ["a tool outside allow", cap({ allow: ["get_order"] }), refundCall("IN-POLICY", "10.00")],
    ["a refund over the capability cap", cap({ max_refund_total: "20.00" }), refundCall("IN-POLICY", "30.00")],
  ])("blocks %s before touching PayPal", async (_label, capability, call) => {
    const { deps, ledger } = fakes();
    const result = await handleTool(deps, capability, call);
    expect(result).toMatchObject({ decision: "BLOCK", reason_code: "CAPABILITY_OUT_OF_SCOPE" });
    expect(deps.refundCapture).not.toHaveBeenCalled();
    expect(ledger).toHaveLength(1);
  });

  it("counts what the session already refunded against the cap", async () => {
    const { deps } = fakes({ refundTotals: async () => ({ session_refunded: "90.00", daily_refunded: "90.00" }) });
    const result = await handleTool(deps, cap(), refundCall("IN-POLICY", "20.00"));
    expect(result.reason_code).toBe("CAPABILITY_OUT_OF_SCOPE");
    expect(deps.getOrderDetails).toHaveBeenCalled();
    expect(deps.refundCapture).not.toHaveBeenCalled();
  });

  it.each([
    ["outside the window", "OLD", "10.00", "BLOCK", "OUTSIDE_WINDOW"],
    ["over the captured amount", "LARGE", "130.00", "BLOCK", "AMOUNT_EXCEEDS_CAPTURED"],
    ["above auto-approve", "LARGE", "80.00", "HOLD", "ABOVE_AUTO_APPROVE"],
  ])("does not refund %s", async (_label, orderId, amount, verdict, reason) => {
    const { deps, ledger } = fakes();
    const result = await handleTool(deps, cap({ max_refund_total: "200.00" }), refundCall(orderId, amount));
    expect(result).toMatchObject({ decision: verdict, reason_code: reason });
    expect(result.message).not.toMatch(/refund of/i);
    expect(deps.refundCapture).not.toHaveBeenCalled();
    expect(replay((ledger[0]!.payload as { decision: DecisionPayload }).decision).same).toBe(true);
  });

  it("blocks an unverified payer", async () => {
    const { deps } = fakes();
    const result = await handleTool(deps, cap({ verified_payer: null }), refundCall("IN-POLICY", "10.00"));
    expect(result).toMatchObject({ decision: "BLOCK", reason_code: "PAYER_NOT_VERIFIED" });
  });

  it("holds when PayPal is down while gathering facts", async () => {
    const { deps } = fakes({
      getOrderDetails: async () => {
        throw new Error("503");
      },
    });
    const result = await handleTool(deps, cap(), refundCall("IN-POLICY", "10.00"));
    expect(result).toMatchObject({ decision: "HOLD", reason_code: "VERIFIER_UNAVAILABLE" });
    expect(deps.refundCapture).not.toHaveBeenCalled();
  });

  it("holds when the budget or policy store is down", async () => {
    const down = async () => {
      throw new Error("db down");
    };
    for (const overrides of [{ refundTotals: down }, { policy: down }]) {
      const { deps } = fakes(overrides);
      expect((await handleTool(deps, cap(), refundCall("IN-POLICY", "10.00"))).decision).toBe("HOLD");
      expect(deps.refundCapture).not.toHaveBeenCalled();
    }
  });

  it("records a failed refund and tells the agent a person will follow up", async () => {
    const { deps, ledger } = fakes({
      refundCapture: async () => {
        throw new Error("PayPal 500");
      },
    });
    const result = await handleTool(deps, cap(), refundCall("IN-POLICY", "42.00"));
    expect(result).toMatchObject({ decision: "HOLD", reason_code: "VERIFIER_UNAVAILABLE" });
    expect(result.message).toMatch(/team/);
    const payload = ledger[0]!.payload as { execution: unknown; decision: DecisionPayload };
    expect(payload.execution).toEqual({ status: "FAILED", amount: "42.00" });
    expect(payload.decision.result.verdict).toBe("ALLOW");
  });

  it("runs inside the per-order lock", async () => {
    const withOrderLock = vi.fn((_id: string, fn: () => Promise<unknown>) => fn()) as GatewayDeps["withOrderLock"];
    const { deps } = fakes({ withOrderLock });
    await handleTool(deps, cap(), refundCall("IN-POLICY", "10.00"));
    expect(withOrderLock).toHaveBeenCalledWith("IN-POLICY", expect.any(Function));
  });
});

describe("handleTool: other tools", () => {
  it("get_order returns details to the verified payer and redacts them otherwise", async () => {
    const { deps, ledger } = fakes();
    const verified = await handleTool(deps, cap(), { tool: "get_order", args: { order_id: "IN-POLICY" } });
    expect(verified).toMatchObject({ decision: "ALLOW", data: { payer_email: "maya@demo.keel.test", refunded: "0.00" } });
    for (const verified_payer of [null, "sam@demo.keel.test"]) {
      const other = await handleTool(deps, cap({ verified_payer }), { tool: "get_order", args: { order_id: "IN-POLICY" } });
      expect(other.data).toEqual({ order_id: "IN-POLICY", payer_email: "m***@demo.keel.test", verified: false });
    }
    expect(ledger).toHaveLength(3);
  });

  it("get_order blocks an order outside the session", async () => {
    const { deps } = fakes();
    const result = await handleTool(deps, cap({ orders: [] }), { tool: "get_order", args: { order_id: "IN-POLICY" } });
    expect(result.reason_code).toBe("CAPABILITY_OUT_OF_SCOPE");
    expect(deps.getOrderDetails).not.toHaveBeenCalled();
  });

  it("offer_discount issues a code within policy and blocks above it", async () => {
    const { deps, ledger } = fakes();
    const allowed = await handleTool(deps, cap(), { tool: "offer_discount", args: { percent: 10, policy_id: "discount-goodwill" } });
    expect(allowed).toMatchObject({ decision: "ALLOW", data: { percent: 10 } });
    expect(allowed.data?.code).toMatch(/^KEEL-[A-Z0-9]{8}$/);
    const blocked = await handleTool(deps, cap(), { tool: "offer_discount", args: { percent: 25, policy_id: "discount-goodwill" } });
    expect(blocked).toMatchObject({ decision: "BLOCK", reason_code: "DISCOUNT_EXCEEDS_LIMIT" });
    expect(ledger).toHaveLength(2);
  });

  it("state_policy returns approved wording verbatim, or POLICY_NOT_FOUND", async () => {
    const { deps } = fakes();
    const found = await handleTool(deps, cap(), { tool: "state_policy", args: { policy_id: "refund-standard" } });
    expect(found.message).toBe(refundPolicy.approved_text);
    const missing = await handleTool(deps, cap(), { tool: "state_policy", args: { policy_id: "bereavement-90-days" } });
    expect(missing).toMatchObject({ decision: "BLOCK", reason_code: "POLICY_NOT_FOUND" });
  });

  it("escalate_to_human marks the session", async () => {
    const { deps, ledger } = fakes();
    const result = await handleTool(deps, cap(), { tool: "escalate_to_human", args: { reason: "angry" } });
    expect(result.decision).toBe("ALLOW");
    expect(deps.escalate).toHaveBeenCalledWith("ses_1");
    expect(ledger).toHaveLength(1);
  });
});

describe("handleTool: risk gate", () => {
  const quarantined = { state: "QUARANTINED", agent_frozen: false, score: 90 };
  const discountCall = { tool: "offer_discount", args: { percent: 5, policy_id: "discount-goodwill" } } as const;
  const orderCall = { tool: "get_order", args: { order_id: "IN-POLICY" } } as const;

  it("holds a quarantined session's refund without touching PayPal, and records it", async () => {
    const { deps, ledger } = fakes({ control: async () => quarantined });
    const r = await handleTool(deps, cap(), refundCall("IN-POLICY", "10.00"));
    expect(r).toMatchObject({ decision: "HOLD", reason_code: "RISK_THRESHOLD", message: HOLD_MESSAGE });
    expect(deps.getOrderDetails).not.toHaveBeenCalled();
    expect(deps.refundCapture).not.toHaveBeenCalled();
    expect(ledger[0]).toMatchObject({ mode: "QUARANTINE", verdict: "HOLD" });
    expect(ledger[0]!.payload).toMatchObject({ args: refundCall("IN-POLICY", "10.00").args, message: HOLD_MESSAGE });
  });

  it("holds a quarantined session's discount", async () => {
    const { deps } = fakes({ control: async () => quarantined });
    expect(await handleTool(deps, cap(), discountCall)).toMatchObject({ decision: "HOLD", reason_code: "RISK_THRESHOLD" });
  });

  it("holds for a frozen agent, ahead of quarantine", async () => {
    const { deps } = fakes({ control: async () => ({ ...quarantined, agent_frozen: true }) });
    expect(await handleTool(deps, cap(), refundCall("IN-POLICY", "10.00"))).toMatchObject({ decision: "HOLD", reason_code: "AGENT_FROZEN" });
  });

  it("fails closed for money when control throws, but reads still work", async () => {
    const { deps, ledger } = fakes({ control: async () => { throw new Error("db"); } });
    expect(await handleTool(deps, cap(), refundCall("IN-POLICY", "10.00"))).toMatchObject({ decision: "HOLD", reason_code: "VERIFIER_UNAVAILABLE" });
    expect(await handleTool(deps, cap(), orderCall)).toMatchObject({ decision: "ALLOW" });
    expect(ledger[0]!.payload).toMatchObject({ risk_score: null });
  });

  it("lets get_order through while quarantined", async () => {
    const { deps } = fakes({ control: async () => quarantined });
    expect(await handleTool(deps, cap(), orderCall)).toMatchObject({ decision: "ALLOW" });
  });

  it("records the pre-decision risk score", async () => {
    const { deps, ledger } = fakes({ control: async () => ({ state: "ACTIVE", agent_frozen: false, score: 42 }) });
    await handleTool(deps, cap(), orderCall);
    expect(ledger[0]).toMatchObject({ mode: "LIVE", payload: { risk_score: 42 } });
  });

  it("assesses after every call, and an assess failure changes nothing", async () => {
    const { deps } = fakes();
    await handleTool(deps, cap(), orderCall);
    expect(deps.assess).toHaveBeenCalledTimes(1);
    expect(deps.assess).toHaveBeenCalledWith("ses_1");
    const failing = fakes({ assess: async () => { throw new Error("boom"); } });
    expect(await handleTool(failing.deps, cap(), orderCall)).toMatchObject({ decision: "ALLOW" });
  });

  it("notifies once on a money HOLD only; notify failure changes nothing", async () => {
    const held = fakes({ control: async () => quarantined });
    const r = await handleTool(held.deps, cap(), refundCall("IN-POLICY", "10.00"));
    expect(held.deps.notifyHeld).toHaveBeenCalledTimes(1);
    expect(held.deps.notifyHeld).toHaveBeenCalledWith({ session_id: "ses_1", decision_id: r.decision_id, reason_codes: ["RISK_THRESHOLD"] });

    const { deps } = fakes();
    await handleTool(deps, cap(), refundCall("IN-POLICY", "10.00"));
    await handleTool(deps, cap(), refundCall("OLD", "10.00"));
    await handleTool(deps, cap({ orders: [] }), refundCall("IN-POLICY", "10.00"));
    expect(deps.notifyHeld).not.toHaveBeenCalled();

    const failing = fakes({ control: async () => quarantined, notifyHeld: async () => { throw new Error("q"); } });
    expect(await handleTool(failing.deps, cap(), refundCall("IN-POLICY", "10.00"))).toMatchObject({ decision: "HOLD" });
  });
});
