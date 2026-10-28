import { describe, expect, it } from "vitest";
import { certSummary, usd } from "./overview-view";

describe("overview view", () => {
  it("formats decimal-string dollars with separators, without floats", () => {
    expect(usd("155.00")).toBe("$155.00");
    expect(usd("1234567.5")).toBe("$1,234,567.50");
    expect(usd("0")).toBe("$0.00");
    expect(usd("12")).toBe("$12.00");
    expect(usd("bad")).toBe("—");
  });

  it("labels the certification and says why", () => {
    expect(certSummary({ status: "CERTIFIED", run_id: "run_1", reasons: [] })).toMatchObject({ label: "CERTIFIED", reason: "The latest guarded Gauntlet run passed on the versions running now." });
    const stale = certSummary({ status: "STALE", run_id: "run_1", reasons: ["policy refund-standard changed", "agent prompt changed"] });
    expect(stale.label).toBe("STALE");
    expect(stale.reason).toBe("policy refund-standard changed; agent prompt changed");
    expect(stale.style).toContain("amber");
    expect(certSummary(null)).toEqual({ label: "UNKNOWN", style: expect.stringContaining("gray"), reason: "Couldn't load certification." });
  });
});
