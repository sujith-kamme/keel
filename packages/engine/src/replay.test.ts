import type { Commitment } from "@keel/core";
import { describe, expect, it } from "vitest";
import { decide } from "./decide";
import type { Facts } from "./facts";
import { replay } from "./replay";

// Small seeded PRNG so the generated cases are the same on every run.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const money = (max: number) => (Math.floor(rand() * max * 100) / 100).toFixed(2);

const refundPolicy = {
  policy_id: "refund-standard",
  version: 1,
  type: "REFUND",
  approved_text: "Refunds within 30 days.",
  rules: [
    { rule: "max_amount_le_captured_minus_refunded" },
    { rule: "within_days_of", field: "delivered_at", days: 30 },
    { rule: "payer_verified" },
    { rule: "session_budget_le", amount: "100.00" },
    { rule: "auto_approve_le", amount: "50.00" },
  ],
};

// Weighted picks keep most cases inside the policy so every rule path is exercised.
function randomCase() {
  const commitment: Commitment = {
    id: `c${Math.floor(rand() * 1e6)}`,
    type: "REFUND",
    source: pick(["TOOL_CALL", "TOOL_CALL", "TOOL_CALL", "FREE_TEXT"] as const),
    order_id: "O-1",
    amount: { value: money(80), currency: pick(["USD", "USD", "USD", "EUR"]) },
  };
  const order = {
    id: "O-1",
    payer_email: "buyer@example.com",
    currency: "USD",
    captured: money(200),
    refunded: pick(["0.00", "20.00"]),
    delivered_at: "2026-10-05T12:00:00Z",
  };
  const facts: Facts = {
    now: pick(["2026-10-23T12:00:00Z", "2026-10-23T12:00:00Z", "2026-12-23T12:00:00Z"]),
    order: pick([undefined, order, order, order]),
    identity: { verified_payer: pick(["buyer@example.com", "buyer@example.com", "other@example.com"]) },
    budget: { session_refunded: pick(["0.00", "0.00", "80.00"]), daily_refunded: "0.00" },
  };
  return { commitment, policy: pick([null, refundPolicy, refundPolicy, refundPolicy, refundPolicy]), facts };
}

describe("replay", () => {
  it("reproduces 100 generated decisions exactly", () => {
    for (let i = 0; i < 100; i++) {
      const input = randomCase();
      expect(replay({ input, result: decide(input) }).same).toBe(true);
    }
  });

  it("reports a stored result that the engine would not produce", () => {
    const input = randomCase();
    const actual = decide(input);
    const forged = { verdict: actual.verdict === "ALLOW" ? "BLOCK" : "ALLOW", reason_codes: ["OK"] } as const;
    const outcome = replay({ input, result: { verdict: forged.verdict, reason_codes: [...forged.reason_codes] } });
    expect(outcome.same).toBe(false);
    expect(outcome.replayed).toEqual(actual);
  });
});
