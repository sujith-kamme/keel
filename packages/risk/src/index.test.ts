import { describe, expect, it } from "vitest";
import { type RiskRow, RISK_WEIGHTS, riskConfig, score, shouldQuarantine, signals } from "./index";

const T0 = "2026-01-01T00:00:00.000Z";
const row = (o: Partial<RiskRow> = {}): RiskRow => ({
  tool: "offer_discount", verdict: "ALLOW", reason_codes: ["OK"], order_id: "O-1",
  injection_from_customer: false, created_at: T0, ...o,
});
const blocked = (o: Partial<RiskRow> = {}) => row({ verdict: "BLOCK", reason_codes: ["DISCOUNT_EXCEEDS_LIMIT"], ...o });
const cfg = { threshold: 60, half_life_min: 30 };

describe("signals", () => {
  it("none for no rows", () => {
    expect(signals([], ["O-1"])).toEqual([]);
    expect(score([], new Date(T0), cfg)).toBe(0);
  });

  it("customer injection on a guard row is one INJECTION", () => {
    const s = signals([row({ tool: "guard", injection_from_customer: true })], []);
    expect(s).toEqual([{ kind: "INJECTION", weight: 40, at: T0 }]);
  });

  it("guard row without customer injection is nothing", () => {
    expect(signals([row({ tool: "guard" })], [])).toEqual([]);
  });

  it("first blocked money call counts nothing, later ones count", () => {
    expect(signals([blocked()], ["O-1"])).toEqual([]);
    const s = signals([blocked(), blocked(), blocked()], ["O-1"]);
    expect(s.map((x) => x.kind)).toEqual(["REPEATED_AFTER_BLOCK", "REPEATED_AFTER_BLOCK"]);
    expect(s[0]?.weight).toBe(15);
  });

  it("an ALLOW in between does not reset", () => {
    const s = signals([blocked(), row(), row({ tool: "offer_refund", verdict: "HOLD" })], ["O-1"]);
    expect(s.map((x) => x.kind)).toEqual(["REPEATED_AFTER_BLOCK"]);
  });

  it("out-of-scope on a foreign order is FOREIGN_ORDER", () => {
    const r = row({ verdict: "BLOCK", reason_codes: ["CAPABILITY_OUT_OF_SCOPE"], order_id: "O-9" });
    expect(signals([r], ["O-1"]).map((x) => x.kind)).toEqual(["FOREIGN_ORDER"]);
    expect(signals([r], ["O-1"])[0]?.weight).toBe(30);
  });

  it("out-of-scope on an in-session order is nothing", () => {
    const r = row({ verdict: "BLOCK", reason_codes: ["CAPABILITY_OUT_OF_SCOPE"], order_id: "O-1" });
    expect(signals([r], ["O-1"])).toEqual([]);
  });

  it("rows before the last release are ignored", () => {
    const inj = row({ tool: "guard", injection_from_customer: true });
    expect(signals([inj, row({ tool: "release" })], [])).toEqual([]);
    expect(signals([inj, row({ tool: "release" }), inj], []).length).toBe(1);
  });
});

describe("score", () => {
  const sig = [{ kind: "INJECTION" as const, weight: RISK_WEIGHTS.INJECTION, at: T0 }];
  it("decays by half-life", () => {
    expect(score(sig, new Date(T0), cfg)).toBe(40);
    expect(score(sig, new Date(Date.parse(T0) + 30 * 60_000), cfg)).toBe(20);
  });
});

describe("score with bad timestamps", () => {
  it("counts an unparseable timestamp at full weight", () => {
    expect(score([{ kind: "INJECTION", weight: 40, at: "not-a-date" }], new Date(T0), cfg)).toBe(40);
  });
});

describe("shouldQuarantine", () => {
  it("scripted attack crosses the threshold", () => {
    const rows = [row({ tool: "guard", injection_from_customer: true }), blocked(), blocked(), blocked()];
    const s = score(signals(rows, ["O-1"]), new Date(T0), cfg);
    expect(s).toBe(70);
    expect(shouldQuarantine(s, "ACTIVE", cfg)).toBe(true);
    expect(shouldQuarantine(s, "ESCALATED", cfg)).toBe(true);
    expect(shouldQuarantine(s, "QUARANTINED", cfg)).toBe(false);
    expect(shouldQuarantine(59, "ACTIVE", cfg)).toBe(false);
  });
});

describe("riskConfig", () => {
  it("defaults", () => expect(riskConfig({})).toEqual({ threshold: 60, half_life_min: 30 }));
  it("treats blank values as unset", () => expect(riskConfig({ RISK_THRESHOLD: "  ", RISK_HALF_LIFE_MIN: "" })).toEqual({ threshold: 60, half_life_min: 30 }));
  it("parses set values", () => expect(riskConfig({ RISK_THRESHOLD: "80", RISK_HALF_LIFE_MIN: "10" })).toEqual({ threshold: 80, half_life_min: 10 }));
  it("rejects bad values", () => {
    expect(() => riskConfig({ RISK_THRESHOLD: "abc" })).toThrow();
    expect(() => riskConfig({ RISK_HALF_LIFE_MIN: "0" })).toThrow();
  });
});
