import { describe, expect, it } from "vitest";
import { type Capability, checkScope, issueToken, verifyToken } from "./capability";

const key = "k".repeat(32);
const now = new Date("2026-10-27T12:00:00Z");
const claims: Capability = {
  session_id: "ses_1",
  agent_id: "agt_demo",
  verified_payer: "maya@demo.keel.test",
  orders: ["ORDER-1"],
  allow: ["get_order", "offer_refund", "state_policy"],
  max_refund_total: "80.00",
  expires_at: "2026-10-27T12:30:00Z",
};

describe("capability tokens", () => {
  it("round-trips signed claims", () => {
    expect(verifyToken(issueToken(claims, key), key, now)).toEqual(claims);
  });

  it("rejects a tampered payload", () => {
    const [, sig] = issueToken(claims, key).split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, max_refund_total: "9999.00" })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, key, now)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = issueToken(claims, key);
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyToken(flipped, key, now)).toBeNull();
  });

  it("rejects a token signed with another key", () => {
    expect(verifyToken(issueToken(claims, "x".repeat(32)), key, now)).toBeNull();
  });

  it("rejects an expired token", () => {
    expect(verifyToken(issueToken(claims, key), key, new Date("2026-10-27T12:30:00Z"))).toBeNull();
  });

  it.each(["", "a", "a.b.c", "not-json.sig", "..", "e30."])("rejects malformed token %j", (token) => {
    expect(verifyToken(token, key, now)).toBeNull();
  });

  it("rejects validly signed claims that fail the schema", () => {
    const bad = issueToken({ ...claims, max_refund_total: "lots" } as Capability, key);
    expect(verifyToken(bad, key, now)).toBeNull();
  });

  it("refuses to sign or verify with a short key", () => {
    expect(() => issueToken(claims, "short")).toThrow();
    expect(() => verifyToken("a.b", "short", now)).toThrow();
  });
});

describe("checkScope", () => {
  it("allows an in-scope read", () => {
    expect(checkScope(claims, { tool: "get_order", order_id: "ORDER-1" }, "0.00")).toBe(true);
  });

  it("rejects a tool not in allow", () => {
    expect(checkScope(claims, { tool: "offer_discount" }, "0.00")).toBe(false);
  });

  it("rejects an order not in the session", () => {
    expect(checkScope(claims, { tool: "get_order", order_id: "ORDER-2" }, "0.00")).toBe(false);
  });

  it("caps refunds at max_refund_total including what the session already refunded", () => {
    expect(checkScope(claims, { tool: "offer_refund", order_id: "ORDER-1", amount: "30.00" }, "50.00")).toBe(true);
    expect(checkScope(claims, { tool: "offer_refund", order_id: "ORDER-1", amount: "30.01" }, "50.00")).toBe(false);
  });

  it("rejects a refund without a valid amount", () => {
    expect(checkScope(claims, { tool: "offer_refund", order_id: "ORDER-1" }, "0.00")).toBe(false);
    expect(checkScope(claims, { tool: "offer_refund", order_id: "ORDER-1", amount: "-1" }, "0.00")).toBe(false);
    expect(checkScope(claims, { tool: "offer_refund", order_id: "ORDER-1", amount: "0.00" }, "0.00")).toBe(false);
  });
});
