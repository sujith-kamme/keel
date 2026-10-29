import { describe, expect, it } from "vitest";
import { amountText, buildRows, errorMessage, fromPolicy, isAgentId, isDecisionId, isSessionId, type ReviewItem } from "./review-view";

const held: ReviewItem = {
  kind: "held_action",
  decision_id: "dec_abc",
  session_id: "ses_1",
  tool: "offer_refund",
  args: { amount: "12.50", order_id: "5B2086" },
  reason_codes: ["ABOVE_AUTO_APPROVE", "NEW_CODE"],
  score: 45,
  session_state: "QUARANTINED",
  created_at: "2026-01-01T00:00:00Z",
};

describe("buildRows", () => {
  it("maps a held action", () => {
    const [r] = buildRows([held]);
    expect(r).toMatchObject({
      id: "dec_abc",
      tab: "held",
      action: "Refund",
      amount: "12.50",
      order: "5B2086",
      reasons: "Above the automatic approval limit, NEW_CODE",
      canRelease: false,
    });
  });

  it("shows percent for discounts", () => {
    expect(buildRows([{ ...held, args: { percent: 10 } }])[0].amount).toBe("10%");
  });

  it("maps flagged sessions to their tab with a release option", () => {
    const session = { kind: "session" as const, session_id: "ses_2", reason_codes: ["RISK_THRESHOLD"], score: null, session_state: "ESCALATED", created_at: "x" };
    const [esc, quar] = buildRows([session, { ...session, session_state: "QUARANTINED" }]);
    expect(esc).toMatchObject({ id: "session:ses_2", tab: "escalated", action: "Escalated session", amount: "", order: "", canRelease: true });
    expect(quar).toMatchObject({ tab: "quarantined", action: "Quarantined session", reasons: "Session quarantined" });
  });

  it("formats amounts and knows which reasons come from a policy", () => {
    expect(amountText("12.5")).toBe("$12.50");
    expect(amountText("10%")).toBe("10%");
    expect(amountText("")).toBe("—");
    expect(fromPolicy("ABOVE_AUTO_APPROVE")).toBe(true);
    expect(fromPolicy("RISK_THRESHOLD")).toBe(false);
  });
});

describe("errorMessage", () => {
  it("maps API errors", () => {
    expect(errorMessage(409, "already_resolved")).toBe("Already resolved.");
    expect(errorMessage(409, "payment_unconfirmed")).toMatch(/retry approve/);
    expect(errorMessage(422, "blocked", "OVER_BUDGET")).toBe("Blocked: OVER_BUDGET");
    expect(errorMessage(502)).toMatch(/PayPal failed/);
    expect(errorMessage(503)).toMatch(/Facts unavailable/);
    expect(errorMessage(500)).toBe("Request failed (500).");
  });
});

describe("id validation", () => {
  it("accepts and rejects", () => {
    expect(isDecisionId("dec_abc123")).toBe(true);
    expect(isDecisionId("dec_a/b")).toBe(false);
    expect(isDecisionId(5)).toBe(false);
    expect(isSessionId("ses_1-x")).toBe(true);
    expect(isSessionId("../x")).toBe(false);
    expect(isAgentId("*")).toBe(true);
    expect(isAgentId("agt_demo_store")).toBe(true);
    expect(isAgentId("agt_other")).toBe(false);
  });
});
