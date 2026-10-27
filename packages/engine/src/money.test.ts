import { describe, expect, it } from "vitest";
import { fromCents, toCents } from "./money";

describe("toCents", () => {
  it.each([
    ["45", 4500],
    ["45.5", 4550],
    ["45.50", 4550],
    ["0.07", 7],
    ["1200.99", 120099],
    ["9999999999999.99", 999999999999999],
  ])("converts %s to %d cents", (value, cents) => {
    expect(toCents(value)).toBe(cents);
  });

  it.each(["45.001", "-1", "abc", "", "1e3", " 45", "90071992547409.93"])("rejects %j", (value) => {
    expect(() => toCents(value)).toThrow("Invalid money value");
  });
});

describe("fromCents", () => {
  it.each([
    [0, "0.00"],
    [7, "0.07"],
    [4550, "45.50"],
    [120099, "1200.99"],
  ])("formats %d cents as %s", (cents, value) => {
    expect(fromCents(cents)).toBe(value);
    expect(toCents(fromCents(cents))).toBe(cents);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects %d", (cents) => {
    expect(() => fromCents(cents)).toThrow("Invalid cents");
  });
});
