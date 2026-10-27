import type { Commitment } from "@keel/core";
import { decide } from "@keel/engine";
import type { OrderDetails } from "@keel/paypal";
import { describe, expect, it } from "vitest";
import { type VerifierDeps, gatherFacts, orderFacts } from "./index";

const usd = (value: string) => ({ value, currency_code: "USD" });

const order: OrderDetails = {
  id: "ORDER-1",
  status: "COMPLETED",
  purchase_units: [
    {
      payments: {
        captures: [
          { id: "CAP-1", status: "PARTIALLY_REFUNDED", amount: usd("100.00"), create_time: "2026-10-20T10:00:00Z" },
          { id: "CAP-2", status: "DECLINED", amount: usd("500.00"), create_time: "2026-10-19T10:00:00Z" },
        ],
        refunds: [
          { id: "R-1", status: "COMPLETED", amount: usd("10.00") },
          { id: "R-2", status: "PENDING", amount: usd("5.50") },
          { id: "R-3", status: "FAILED", amount: usd("50.00") },
        ],
      },
    },
  ],
};

const deps = (overrides: Partial<VerifierDeps> = {}): VerifierDeps => ({
  getOrderDetails: async () => order,
  storeOrder: async () => ({ payerEmail: "maya@demo.keel.test", deliveredAt: new Date("2026-10-22T00:00:00Z") }),
  refundTotals: async () => ({ session_refunded: "0.00", daily_refunded: "0.00" }),
  ...overrides,
});

describe("orderFacts", () => {
  it("combines PayPal money facts with store facts", async () => {
    expect(await orderFacts(deps(), "ORDER-1")).toEqual({
      id: "ORDER-1",
      payer_email: "maya@demo.keel.test",
      currency: "USD",
      captured: "100.00",
      refunded: "15.50",
      captured_at: "2026-10-20T10:00:00Z",
      delivered_at: "2026-10-22T00:00:00.000Z",
    });
  });

  it("throws when the order is missing from the store", async () => {
    await expect(orderFacts(deps({ storeOrder: async () => null }), "ORDER-1")).rejects.toThrow();
  });

  it("throws when PayPal returns another order", async () => {
    await expect(orderFacts(deps(), "ORDER-2")).rejects.toThrow();
  });

  it("throws on mixed currencies", async () => {
    const mixed: OrderDetails = {
      ...order,
      purchase_units: [{ payments: { captures: order.purchase_units[0]!.payments!.captures, refunds: [{ id: "R", status: "COMPLETED", amount: { value: "1.00", currency_code: "EUR" } }] } }],
    };
    await expect(orderFacts(deps({ getOrderDetails: async () => mixed }), "ORDER-1")).rejects.toThrow();
  });

  it("throws when nothing was captured", async () => {
    const none: OrderDetails = { ...order, purchase_units: [{ payments: {} }] };
    await expect(orderFacts(deps({ getOrderDetails: async () => none }), "ORDER-1")).rejects.toThrow();
  });
});

describe("gatherFacts", () => {
  const refund: Commitment = {
    id: "c1",
    type: "REFUND",
    source: "TOOL_CALL",
    order_id: "ORDER-1",
    amount: { value: "20.00", currency: "USD" },
    policy_id: "refund-standard",
  };
  const policy = {
    policy_id: "refund-standard",
    version: 1,
    type: "REFUND",
    approved_text: "Refunds within 30 days.",
    rules: [{ rule: "max_amount_le_captured_minus_refunded" }, { rule: "payer_verified" }],
  };
  const req = { session_id: "ses_1", order_id: "ORDER-1", verified_payer: "maya@demo.keel.test", now: new Date("2026-10-27T00:00:00Z") };

  it("gathers order, budget and identity facts", async () => {
    const { facts, verifier_errors } = await gatherFacts(deps(), req);
    expect(verifier_errors).toEqual([]);
    expect(facts.identity).toEqual({ verified_payer: "maya@demo.keel.test" });
    expect(facts.budget).toEqual({ session_refunded: "0.00", daily_refunded: "0.00" });
    expect(decide({ commitment: refund, policy, facts })).toEqual({ verdict: "ALLOW", reason_codes: ["OK"] });
  });

  it("fails closed: PayPal down leaves order out and the engine HOLDs", async () => {
    const down = deps({
      getOrderDetails: async () => {
        throw new Error("503");
      },
    });
    const { facts, verifier_errors } = await gatherFacts(down, req);
    expect(verifier_errors).toEqual(["order"]);
    expect(facts.order).toBeUndefined();
    expect(decide({ commitment: refund, policy, facts })).toEqual({
      verdict: "HOLD",
      reason_codes: ["VERIFIER_UNAVAILABLE"],
    });
  });

  it("records a failed budget verifier", async () => {
    const down = deps({
      refundTotals: async () => {
        throw new Error("db down");
      },
    });
    expect((await gatherFacts(down, req)).verifier_errors).toEqual(["budget"]);
  });

  it("omits identity when the payer is not verified", async () => {
    const { facts } = await gatherFacts(deps(), { ...req, verified_payer: null });
    expect(facts.identity).toBeUndefined();
    expect(decide({ commitment: refund, policy, facts })).toEqual({
      verdict: "BLOCK",
      reason_codes: ["PAYER_NOT_VERIFIED"],
    });
  });
});
