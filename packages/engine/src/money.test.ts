import { describe, expect, it } from "vitest";
import { toCents } from "./money";

describe("toCents", () => {
  it.each([
    ["45", 4500],
    ["45.5", 4550],
    ["45.50", 4550],
    ["0.07", 7],
    ["1200.99", 120099],
  ])("converts %s to %d cents", (value, cents) => {
    expect(toCents(value)).toBe(cents);
  });

  it.each(["45.001", "-1", "abc", "", "1e3", " 45"])("rejects %j", (value) => {
    expect(() => toCents(value)).toThrow("Invalid money value");
  });
});
