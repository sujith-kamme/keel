import type { Extraction } from "@keel/core";
import { describe, expect, it } from "vitest";
import { FREE_TEXT_FALLBACK, SAFE_FALLBACK, type ReplyInput, decideReply, policyRewrite, replayReply } from "./reply";

const BEREAVEMENT = "We don't offer special bereavement refunds; our standard refund policy applies to every order.";
const policies = { "policy-bereavement": { approved_text: BEREAVEMENT } };

type C = Extraction["reply_commitments"][number];
const ext = (...c: C[]): Extraction => ({ reply_commitments: c, injection_signals: [], pii_mentions: [] });
const input = (over: Partial<ReplyInput>): ReplyInput => ({
  draft: "Hello",
  extraction: ext(),
  turn_decisions: [],
  policies: {},
  ...over,
});
const refund = (amount?: string, order_id?: string): C => ({
  type: "REFUND",
  quoted_text: "refund",
  ...(amount ? { amount: { value: amount, currency: "USD" } } : {}),
  ...(order_id ? { order_id } : {}),
});
const offerRefund = (verdict: "ALLOW" | "BLOCK" | "HOLD", amount = "42.00", order_id = "O-1") => ({
  tool: "offer_refund",
  verdict,
  args: { order_id, amount },
});
const policyClaim = (policy_id?: string): C => ({ type: "POLICY_CLAIM", quoted_text: "claim", ...(policy_id ? { policy_id } : {}) });

describe("decideReply", () => {
  it("blocks with the safe fallback when the extractor failed", () => {
    expect(decideReply(input({ extraction: null }))).toEqual({
      verdict: "BLOCK", reason_codes: ["EXTRACTOR_UNAVAILABLE"], final_reply: SAFE_FALLBACK,
    });
  });

  it("allows a reply with no commitments unchanged", () => {
    expect(decideReply(input({ draft: "Hi there" }))).toEqual({ verdict: "ALLOW", reason_codes: ["OK"], final_reply: "Hi there" });
  });

  it("blocks a free-text refund with no tool decision", () => {
    const r = decideReply(input({ extraction: ext(refund("42.00")) }));
    expect(r).toEqual({ verdict: "BLOCK", reason_codes: ["FREE_TEXT_COMMITMENT"], final_reply: FREE_TEXT_FALLBACK });
  });

  it("allows a refund backed by an ALLOW offer_refund, comparing money as cents", () => {
    const r = decideReply(input({ draft: "Refunding $42", extraction: ext(refund("42", "O-1")), turn_decisions: [offerRefund("ALLOW")] }));
    expect(r.verdict).toBe("ALLOW");
    expect(r.final_reply).toBe("Refunding $42");
  });

  it("blocks a refund whose tool decision was BLOCK or HOLD (DP-7)", () => {
    for (const verdict of ["BLOCK", "HOLD"] as const) {
      const r = decideReply(input({ extraction: ext(refund("42.00")), turn_decisions: [offerRefund(verdict)] }));
      expect(r.verdict).toBe("BLOCK");
    }
  });

  it("blocks a refund with a mismatched amount or order", () => {
    expect(decideReply(input({ extraction: ext(refund("50.00")), turn_decisions: [offerRefund("ALLOW")] })).verdict).toBe("BLOCK");
    expect(decideReply(input({ extraction: ext(refund("42.00", "O-2")), turn_decisions: [offerRefund("ALLOW")] })).verdict).toBe("BLOCK");
  });

  it("fails closed on a malformed amount", () => {
    const bad = { type: "REFUND", quoted_text: "r", amount: { value: "4x", currency: "USD" } } as C;
    expect(decideReply(input({ extraction: ext(bad), turn_decisions: [offerRefund("ALLOW")] })).verdict).toBe("BLOCK");
  });

  it("backs a discount only by an ALLOW offer_discount with the same percent", () => {
    const d: C = { type: "DISCOUNT", quoted_text: "10% off", percent: 10 };
    const dec = (verdict: "ALLOW" | "BLOCK", percent: number) => ({ tool: "offer_discount", verdict, args: { percent } });
    expect(decideReply(input({ extraction: ext(d), turn_decisions: [dec("ALLOW", 10)] })).verdict).toBe("ALLOW");
    expect(decideReply(input({ extraction: ext(d) })).verdict).toBe("BLOCK");
    expect(decideReply(input({ extraction: ext(d), turn_decisions: [dec("ALLOW", 20)] })).verdict).toBe("BLOCK");
    expect(decideReply(input({ extraction: ext(d), turn_decisions: [dec("BLOCK", 10)] })).verdict).toBe("BLOCK");
  });

  it("rewrites an invented policy claim to the approved text", () => {
    const r = decideReply(input({
      draft: "Bereavement refunds are available within 90 days.",
      extraction: ext(policyClaim("policy-bereavement")),
      policies,
    }));
    expect(r).toEqual({ verdict: "REWRITE", reason_codes: ["POLICY_UNAPPROVED_CLAIM"], final_reply: policyRewrite(BEREAVEMENT) });
  });

  it("allows a policy claim quoting the approved text despite whitespace differences", () => {
    const draft = `Sure.  ${BEREAVEMENT.replace(/ /g, "  ").replace("refunds;", "refunds;\n")}  `;
    const r = decideReply(input({ draft, extraction: ext(policyClaim("policy-bereavement")), policies }));
    expect(r.verdict).toBe("ALLOW");
    expect(r.final_reply).toBe(draft);
  });

  it("blocks a policy claim with an unknown, null or missing policy id", () => {
    for (const [id, p] of [["nope", policies], [undefined, policies], ["policy-x", { "policy-x": null }]] as const) {
      const r = decideReply(input({ extraction: ext(policyClaim(id)), policies: p }));
      expect(r).toEqual({ verdict: "BLOCK", reason_codes: ["FREE_TEXT_COMMITMENT"], final_reply: FREE_TEXT_FALLBACK });
    }
  });

  it("blocks PRICE, CANCELLATION and RETENTION_OFFER, ignores DELIVERY_PROMISE", () => {
    for (const type of ["PRICE", "CANCELLATION", "RETENTION_OFFER"] as const) {
      expect(decideReply(input({ extraction: ext({ type, quoted_text: "x" }) })).verdict).toBe("BLOCK");
    }
    expect(decideReply(input({ extraction: ext({ type: "DELIVERY_PROMISE", quoted_text: "x" }) })).verdict).toBe("ALLOW");
    expect(decideReply(input({ extraction: ext({ type: "DATA_DISCLOSURE", quoted_text: "x" }) })).verdict).toBe("ALLOW");
  });

  it("lets BLOCK beat REWRITE and the first REWRITE win", () => {
    const p2 = { "policy-b": { approved_text: "Second." }, ...policies };
    const rewrite = ext(policyClaim("policy-bereavement"), policyClaim("policy-b"));
    expect(decideReply(input({ draft: "invented", extraction: rewrite, policies: p2 })).final_reply).toBe(policyRewrite(BEREAVEMENT));
    const mixed = ext(policyClaim("policy-bereavement"), refund("42.00"));
    expect(decideReply(input({ draft: "invented", extraction: mixed, policies })).verdict).toBe("BLOCK");
  });
});

describe("replayReply", () => {
  const i = input({ draft: "invented", extraction: ext(policyClaim("policy-bereavement")), policies });
  it("agrees with a recorded result and disagrees with a tampered one", () => {
    const result = decideReply(i);
    expect(replayReply({ input: i, result }).same).toBe(true);
    expect(replayReply({ input: i, result: { ...result, verdict: "ALLOW" } }).same).toBe(false);
  });
});
