import { describe, expect, it } from "vitest";
import { buildRows, errorMessage, isAgentId, isDecisionId, isSessionId, type ReviewItem } from "./review-view";

const held: ReviewItem = {
  kind: "held_action",
  decision_id: "dec_abc",
  session_id: "ses_1",
  tool: "offer_refund",
  args: { amount: "12.50" },
  reason_codes: ["OVER_LIMIT", "RISK"],
  score: 45,
  session_state: "QUARANTINED",
  created_at: "2026-01-01T00:00:00Z",
};

describe("buildRows", () => {
  it("maps a held action", () => {
    const [r] = buildRows([held]);
    expect(r).toMatchObject({ id: "dec_abc", kindLabel: "Held action", amount: "12.50", reasons: "OVER_LIMIT, RISK", canRelease: false });
  });

  it("shows percent for discounts", () => {
    expect(buildRows([{ ...held, args: { percent: 10 } }])[0].amount).toBe("10%");
  });

  it("maps a flagged session with a release option", () => {
    const [r] = buildRows([{ kind: "session", session_id: "ses_2", reason_codes: [], score: null, session_state: "ESCALATED", created_at: "x" }]);
    expect(r).toMatchObject({ id: "session:ses_2", kindLabel: "Session", amount: "", tool: "", canRelease: true, score: null });
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
