import { describe, expect, it } from "vitest";
import { orderStatus } from "./orders";

describe("orderStatus", () => {
  it("shows the delivery day in UTC, or Processing", () => {
    expect(orderStatus("2026-09-13T23:30:00Z")).toEqual({ label: "Delivered Sep 13", delivered: true });
    expect(orderStatus(null)).toEqual({ label: "Processing", delivered: false });
    expect(orderStatus("nope")).toEqual({ label: "Processing", delivered: false });
  });
});
